import http from 'http'
import { Server as IOServer } from 'socket.io'

// NOTE: server expects `vectoriadb` to be installed in the environment.
// It forwards calls to the real VectoriaDB instance.
import { VectoriaDB } from 'vectoriadb'

export default class VectoriaDBServer {
  constructor(opts = {}) {
    this.port = opts.port || 3001
    this.host = opts.host || '0.0.0.0'
    this.cors = opts.cors || []
    this.apiKey = opts.apiKey || null
    this.vectoriadbConfig = opts.vectoriadbConfig || {}
    this.streamChunkSize = opts.streamChunkSize || 500

    // --- auto-save / burst-detection (configurable) ---
    this.autoSaveOnMutationBurst = opts.autoSaveOnMutationBurst !== undefined ? !!opts.autoSaveOnMutationBurst : true
    // when true the server will save after any inactivity period (see `mutationInactivityMs`) — useful for small apps
    this.autoSaveOnInactivity = opts.autoSaveOnInactivity !== undefined ? !!opts.autoSaveOnInactivity : false
    this.mutationBurstThreshold = Number(opts.mutationBurstThreshold) || 5
    this.mutationBurstWindowMs = Number(opts.mutationBurstWindowMs) || 2 * 60 * 1000 // 2 minutes
    this.mutationInactivityMs = Number(opts.mutationInactivityMs) || 30 * 1000 // 30s inactivity to trigger save
    this.minSaveIntervalMs = Number(opts.minSaveIntervalMs) || 10 * 1000 // minimum time between auto-saves

    // internal mutation-tracking state
    this._mutationMethods = new Set([
      'add',
      'addMany',
      'update',
      'remove',
      'removeMany',
      'clear',
      'insert',
      'upsert',
      'replace',
      'put',
      'delete',
    ])
    this._mutationTimestamps = []
    this._inactivityTimer = null
    this._lastBurstAt = 0
    this._savingInProgress = false
    this._lastSaveAt = 0

    this._http = null
    this._io = null
    this._vectoria = null
    this._sockets = new Set()
    this._started = false
    this._startPromise = null
  }

  async listen() {
    // fast-path: already started
    if (this._started) return this

    // if a start is already in progress, return the same promise
    if (this._startPromise) return this._startPromise

    this._startPromise = (async () => {
      try {
        // Initialize VectoriaDB (loads models / storage as configured)
        this._vectoria = new VectoriaDB(this.vectoriadbConfig)
        if (typeof this._vectoria.initialize === 'function') {
          await this._vectoria.initialize()
        }

        this._http = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('VectoriaDB Server')
        })

        this._io = new IOServer(this._http, {
          cors: { origin: this.cors.length ? this.cors : '*', methods: ['GET', 'POST'] },
          maxHttpBufferSize: 1e7,
        })

        const nsp = this._io.of('/vectoriadb')

        nsp.use((socket, next) => {
          // simple API key auth if configured
          if (this.apiKey) {
            const provided = socket.handshake.auth?.apiKey || socket.handshake.query?.apiKey
            if (!provided || provided !== this.apiKey) {
              return next(new Error('Unauthorized'))
            }
          }
          next()
        })

        nsp.on('connection', socket => {
          this._sockets.add(socket)
          socket.on('disconnect', () => this._sockets.delete(socket))

          socket.on('request', async payload => {
            // payload: { id, method, params, collection, timestamp }
            try {
              await this._handleRequest(socket, payload)
            } catch (err) {
              socket.emit('response', { id: payload?.id ?? null, result: null, error: { message: err.message }, took: 0 })
            }
          })

          // allow ping from client
          socket.on('health', cb => cb && cb({ ok: true, ts: Date.now() }))
        })

        await new Promise((res, rej) => {
          this._http.listen(this.port, this.host, err => (err ? rej(err) : res()))
        })

        this._started = true
        console.log(`VectoriaDB Server listening on ${this.host}:${this.port}`)
        return this
      } catch (err) {
        // cleanup partial resources on failure
        try {
          if (this._io) await this._io.close()
        } catch (e) {}
        try {
          if (this._http) this._http.close(() => {})
        } catch (e) {}
        throw err
      }
    })()

    try {
      return await this._startPromise
    } finally {
      // ensure the in-progress marker is cleared after attempt completes
      this._startPromise = null
    }
  }

  async _handleRequest(socket, payload) {
    if (!payload || typeof payload !== 'object') {
      return socket.emit('response', { id: null, result: null, error: { message: 'Invalid payload' }, took: 0 })
    }

    const { id, method, params = [] } = payload
    const start = Date.now()

    if (!method || typeof method !== 'string') {
      return socket.emit('response', { id, result: null, error: { message: 'Missing method' }, took: Date.now() - start })
    }

    // Allow passing serialized functions from client: convert stringified functions back to real functions
    const reparsedParams = params.map(p => {
      if (p && typeof p === 'object') {
        // Top-level serialized function (client forwarded a function as a param)
        if (p.__isFnString && typeof p.fn === 'string') {
          // create function from string - executed in server process (trusted usage only)
          // eslint-disable-next-line no-new-func
          const fn = new Function('return (' + p.fn + ')')()
          return fn
        }

        // Support serialized `filter` nested inside an `options` object:
        // - { filter: { __isFnString: true, fn: 'function(m) { ... }' } }
        // - or `filter` as a raw function string
        if (p.filter && typeof p.filter === 'object' && p.filter.__isFnString && typeof p.filter.fn === 'string') {
          // eslint-disable-next-line no-new-func
          p.filter = new Function('return (' + p.filter.fn + ')')()
        } else if (typeof p.filter === 'string' && p.filter.trim().startsWith('function')) {
          // eslint-disable-next-line no-new-func
          p.filter = new Function('return (' + p.filter + ')')()
        }
      }
      return p
    })

    try {
      // dispatch to underlying VectoriaDB instance
      const fn = this._vectoria[method]
      if (typeof fn !== 'function') {
        throw new Error(`MethodNotFound: ${method}`)
      }

      // Run and capture result
      const result = await Promise.race([
        fn.apply(this._vectoria, reparsedParams),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ServerTimeout')), 30000)),
      ])

      // record mutation activity (used to auto-flush after a burst + inactivity)
      if (this.autoSaveOnMutationBurst && this._isMutationMethod(method)) {
        try {
          this._recordMutation()
        } catch (e) {
          /* swallow tracking errors */
        }
      }

      const took = Date.now() - start

      // streaming support for very large arrays
      if (Array.isArray(result) && result.length > this.streamChunkSize) {
        const total = result.length
        const chunkSize = this.streamChunkSize
        for (let i = 0; i < total; i += chunkSize) {
          const chunk = result.slice(i, i + chunkSize)
          socket.emit('response-chunk', { id, chunk, index: Math.floor(i / chunkSize), totalChunks: Math.ceil(total / chunkSize) })
        }
        // final response indicating stream finished
        return socket.emit('response', { id, result: { streamed: true, count: total }, error: null, took })
      }

      socket.emit('response', { id, result, error: null, took })
    } catch (err) {
      const took = Date.now() - start
      socket.emit('response', { id, result: null, error: { message: err.message, name: err.name }, took })
    }
  }

  // --- Auto-save on mutation bursts (configurable) ---
  _isMutationMethod(method) {
    return this._mutationMethods.has(method)
  }

  _recordMutation() {
    const now = Date.now()
    this._mutationTimestamps.push(now)
    // purge old timestamps outside the burst window
    const cutoff = now - this.mutationBurstWindowMs
    while (this._mutationTimestamps.length && this._mutationTimestamps[0] < cutoff) {
      this._mutationTimestamps.shift()
    }
    if (this._mutationTimestamps.length >= this.mutationBurstThreshold) {
      this._lastBurstAt = now
    }
    this._scheduleInactivityTimer()
  }

  _scheduleInactivityTimer() {
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer)
    }
    this._inactivityTimer = setTimeout(() => {
      // fire-and-forget async
      this._onInactivityTimeout().catch(err => console.warn('Inactivity flush error:', err.message))
    }, this.mutationInactivityMs)
    if (this._inactivityTimer.unref) this._inactivityTimer.unref()
  }

  async _onInactivityTimeout() {
    this._inactivityTimer = null
    const now = Date.now()

    // Simple "inactivity-only" mode: save after any inactivity period if enabled.
    if (this.autoSaveOnInactivity) {
      if (this._mutationTimestamps.length > 0) {
        await this._saveToStorage('inactivity')
      }
      // reset history and return early
      this._mutationTimestamps = []
      this._lastBurstAt = 0
      return
    }

    // count mutations within the burst window (existing burst-detection behavior)
    const cutoff = now - this.mutationBurstWindowMs
    const recentCount = this._mutationTimestamps.filter(ts => ts >= cutoff).length
    if (recentCount >= this.mutationBurstThreshold) {
      await this._saveToStorage('mutation-burst-inactivity')
    }
    // reset history (we only track bursts between inactivity windows)
    this._mutationTimestamps = []
    this._lastBurstAt = 0
  }

  async _saveToStorage(reason = 'manual') {
    if (!this._vectoria || typeof this._vectoria.saveToStorage !== 'function') return
    const now = Date.now()
    if (this._savingInProgress) return
    if (now - this._lastSaveAt < this.minSaveIntervalMs) return
    this._savingInProgress = true
    try {
      await this._vectoria.saveToStorage()
      this._lastSaveAt = Date.now()
      console.log(`[VectoriaDBServer] auto-saved storage (${reason})`)
    } catch (err) {
      console.warn('[VectoriaDBServer] auto-save failed:', err.message)
    } finally {
      this._savingInProgress = false
    }
  }

  async close() {
    if (!this._started) return
    // stop any pending auto-save timer
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer)
      this._inactivityTimer = null
    }
    // disconnect sockets
    for (const s of Array.from(this._sockets)) {
      try {
        s.disconnect(true)
      } catch (e) {}
    }
    this._sockets.clear()

    if (this._io) {
      try {
        await this._io.close()
      } catch (e) {}
    }

    if (this._http) {
      await new Promise(resolve => this._http.close(resolve))
    }

    // attempt to persist state if available
    try {
      if (this._vectoria && typeof this._vectoria.saveToStorage === 'function') {
        await this._vectoria.saveToStorage()
      }
    } catch (err) {
      console.warn('Error saving VectoriaDB state during shutdown:', err.message)
    }

    this._started = false
  }
}
