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

    this._http = null
    this._io = null
    this._vectoria = null
    this._sockets = new Set()
    this._started = false
  }

  async listen() {
    if (this._started) return
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
        // detect serialized function marker
        if (p.__isFnString && typeof p.fn === 'string') {
          // create function from string - executed in server process (trusted usage only)
          // eslint-disable-next-line no-new-func
          const fn = new Function('return (' + p.fn + ')')()
          return fn
        }
        // also support options.filter as a string directly
        if (typeof p.filter === 'string' && p.filter.trim().startsWith('function')) {
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

  async close() {
    if (!this._started) return
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
