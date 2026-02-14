import SocketClient from './socket-client.js'

// Client SDK that mirrors VectoriaDB API surface (runtime validation + forwarding)
export default class VectoriaDB {
  constructor(opts = {}) {
    if (!opts.serverUrl) throw new Error('serverUrl is required')
    this.serverUrl = opts.serverUrl
    this.apiKey = opts.apiKey || null
    this.requestTimeout = opts.requestTimeout || 30000
    this._socket = new SocketClient({ serverUrl: this.serverUrl, apiKey: this.apiKey, requestTimeout: this.requestTimeout })
  }

  // --- helper to serialize function filters ---
  static _serializeFunction(fn) {
    if (!fn) return null
    if (typeof fn === 'function') return { __isFnString: true, fn: fn.toString() }
    if (typeof fn === 'string') return { __isFnString: true, fn: fn }
    return null
  }

  // low-level forwarder
  async _forward(method, ...params) {
    return this._socket.sendRequest({ method, params })
  }

  // --- VectoriaDB API methods (as in docs) ---
  async initialize() {
    return this._forward('initialize')
  }

  async add(id, text, metadata) {
    if (typeof id !== 'string') throw new TypeError('id must be string')
    if (typeof text !== 'string') throw new TypeError('text must be string')
    if (!metadata || typeof metadata !== 'object') throw new TypeError('metadata must be an object')
    return this._forward('add', id, text, metadata)
  }

  async addMany(docs) {
    if (!Array.isArray(docs)) throw new TypeError('docs must be an array')
    if (docs.length === 0) return { added: 0 }
    return this._forward('addMany', docs)
  }

  async has(id) {
    return this._forward('has', id)
  }

  async get(id) {
    return this._forward('get', id)
  }

  async size() {
    return this._forward('size')
  }

  async update(id, updates, opts = {}) {
    return this._forward('update', id, updates, opts)
  }

  async updateMetadata(id, metadata) {
    return this._forward('updateMetadata', id, metadata)
  }

  async updateMany(updates) {
    return this._forward('updateMany', updates)
  }

  async remove(id) {
    return this._forward('remove', id)
  }

  async removeMany(ids) {
    return this._forward('removeMany', ids)
  }

  async clear() {
    return this._forward('clear')
  }

  async saveToStorage() {
    return this._forward('saveToStorage')
  }

  async loadFromStorage() {
    return this._forward('loadFromStorage')
  }

  async clearStorage() {
    return this._forward('clearStorage')
  }

  async filter(fn) {
    // filter is executed server-side — serialize function
    if (typeof fn !== 'function') throw new TypeError('filter requires a function')
    const serialized = VectoriaDB._serializeFunction(fn)
    return this._forward('filter', serialized)
  }

  async search(queryOrVector, options = {}) {
    const opts = { ...options }
    if (opts.filter && typeof opts.filter === 'function') {
      opts.filter = VectoriaDB._serializeFunction(opts.filter)
    }
    return this._forward('search', queryOrVector, opts)
  }

  // --- convenience collection-style API (maps to VectoriaDB primitives) ---
  async createCollection(name) {
    if (!name || typeof name !== 'string') throw new TypeError('collection name required')
    // no-op on server side; client manages "collection" via metadata.owner
    return { ok: true, collection: name }
  }

  async insert(collection, docs) {
    if (!collection || typeof collection !== 'string') throw new TypeError('collection required')
    if (!Array.isArray(docs)) throw new TypeError('docs must be an array')

    const transformed = docs.map(d => {
      const id = d.id || d.metadata?.id || `${collection}:${Math.random().toString(36).slice(2, 9)}`
      const metadata = Object.assign({}, d.metadata || {}, { id, owner: collection })
      return { id, text: d.text || d.vector?.toString() || (d.text ?? ''), metadata, vector: d.vector }
    })

    // Use addMany for textual documents; for vector-only docs we forward to addMany as well
    return this.addMany(transformed)
  }

  async query(collection, queryVectorOrText, opts = {}) {
    if (!collection || typeof collection !== 'string') throw new TypeError('collection required')
    const options = { ...opts }
    const originalFilter = options.filter

    // Build a self-contained, serializable filter that enforces owner === collection
    // and (optionally) runs the user's filter. We inline the user's filter source
    // so the resulting function does not rely on outer closures when evaluated
    // on the server process.
    const ownerLiteral = JSON.stringify(collection)

    if (originalFilter) {
      // normalize original filter to a source string
      let origFnStr
      if (typeof originalFilter === 'function') {
        origFnStr = originalFilter.toString()
      } else if (typeof originalFilter === 'string') {
        origFnStr = originalFilter
      } else if (originalFilter && originalFilter.__isFnString && typeof originalFilter.fn === 'string') {
        origFnStr = originalFilter.fn
      } else {
        throw new TypeError('filter must be a function or serialized function')
      }

      // inline user's filter so the combined function is self-contained server-side
      const combinedFnStr = `(function(m){ try { const __orig = ${origFnStr}; return !!(__orig(m) && m && m.owner === ${ownerLiteral}); } catch(e) { return false } })`
      options.filter = VectoriaDB._serializeFunction(combinedFnStr)
    } else {
      const ownerFnStr = `(function(m){ return m && m.owner === ${ownerLiteral}; })`
      options.filter = VectoriaDB._serializeFunction(ownerFnStr)
    }

    return this.search(queryVectorOrText, options)
  }

  // close socket
  close() {
    try {
      this._socket.close()
    } catch (e) {}
  }
}

// CommonJS fallback (so `require('./client')` still works in many setups)
export { VectoriaDB }
