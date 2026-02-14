import { io } from 'socket.io-client'

function _makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

export default class SocketClient {
  constructor({ serverUrl, namespace = '/vectoriadb', apiKey = null, requestTimeout = 30000 } = {}) {
    if (!serverUrl) throw new Error('serverUrl is required')
    this.serverUrl = serverUrl.replace(/\/$/, '')
    this.namespace = namespace.startsWith('/') ? namespace : `/${namespace}`
    this.url = `${this.serverUrl}${this.namespace}`
    this.apiKey = apiKey
    this.requestTimeout = requestTimeout || 30000

    this.socket = io(this.url, {
      auth: { apiKey },
      path: '/socket.io',
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
    })

    this._pending = new Map() // id -> { resolve, reject, timer, chunks }
    this._offlineQueue = []

    this.socket.on('connect', () => {
      // flush queue
      while (this._offlineQueue.length) {
        const payload = this._offlineQueue.shift()
        this.socket.emit('request', payload)
      }
    })

    this.socket.on('connect_error', err => {
      // reject nothing here; pending requests will timeout or be retried
      // console.warn('connect_error', err.message)
    })

    this.socket.on('disconnect', reason => {
      // keep pending promises alive; they will timeout based on requestTimeout
    })

    this.socket.on('response', msg => {
      const { id, result, error } = msg || {}
      const pending = this._pending.get(id)
      if (!pending) return

      // If streamed chunks were received, assemble them in index order.
      if (pending.chunksMap) {
        const chunksMap = pending.chunksMap
        const indexes = Object.keys(chunksMap)
          .map(k => Number(k))
          .sort((a, b) => a - b)
        const assembled = indexes.flatMap(i => (Array.isArray(chunksMap[i]) ? chunksMap[i] : []))
        clearTimeout(pending.timer)
        pending.resolve(assembled)
        this._pending.delete(id)
        return
      }

      clearTimeout(pending.timer)
      if (error) pending.reject(new Error(error.message || 'ServerError'))
      else pending.resolve(result)
      this._pending.delete(id)
    })

    this.socket.on('response-chunk', msg => {
      const { id, chunk, index, totalChunks } = msg || {}
      const pending = this._pending.get(id)
      if (!pending) return

      if (!pending.chunksMap) pending.chunksMap = {}
      pending.chunksMap[index] = chunk
      pending.receivedChunks = (pending.receivedChunks || 0) + 1
      if (typeof totalChunks === 'number') pending.totalChunks = totalChunks

      // reset timeout so long streams don't prematurely fail
      if (pending.timer) {
        clearTimeout(pending.timer)
        pending.timer = setTimeout(() => {
          this._pending.delete(id)
          pending.reject(new Error('RequestTimeout'))
        }, pending.timeoutMs || this.requestTimeout)
      }
    })
  }

  sendRequest({ method, params = [], collection = undefined, timeout = undefined } = {}) {
    const id = _makeId()
    const payload = { id, method, params, collection, timestamp: Date.now() }
    const effectiveTimeout = typeof timeout === 'number' ? timeout : this.requestTimeout

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error('RequestTimeout'))
      }, effectiveTimeout)

      // store extra metadata so streaming chunks can reset the timer and be
      // assembled in order on final response
      this._pending.set(id, { resolve, reject, timer, timeoutMs: effectiveTimeout, chunksMap: null, receivedChunks: 0, totalChunks: null })

      if (this.socket.connected) {
        this.socket.emit('request', payload)
      } else {
        // queue for send on reconnect
        this._offlineQueue.push(payload)
      }
    })

    return promise
  }

  close() {
    try {
      this.socket.close()
    } catch (e) {}
  }
}
