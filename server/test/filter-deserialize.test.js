import test from 'node:test'
import assert from 'node:assert/strict'
import VectoriaDBServer from '../vectoriadb-server.js'

test('server deserializes serialized options.filter (object form) into a function', async () => {
  const server = new VectoriaDBServer()

  // stub the underlying VectoriaDB method (`search`) to inspect received args
  server._vectoria = {
    async search(...args) {
      // find an arg that contains a `filter` property
      const opt = args.find(a => a && typeof a === 'object' && Object.prototype.hasOwnProperty.call(a, 'filter'))
      assert(opt, 'expected an options object containing `filter`')
      assert.equal(typeof opt.filter, 'function', 'options.filter should be a function after deserialization')

      // sanity-check the deserialized function works
      const sample = { owner: 'team' }
      assert.equal(opt.filter(sample), true)

      return { ok: true }
    },
  }

  // capture emitted responses from the "socket"
  let emitted = null
  const mockSocket = { emit: (evt, payload) => (emitted = { evt, payload }) }

  const payload = {
    id: 't-filter-1',
    method: 'search',
    params: [
      {
        // serialized filter object as sent by the client SDK
        filter: { __isFnString: true, fn: 'function(m){ return !!(m && m.owner === "team") }' },
      },
    ],
  }

  await server._handleRequest(mockSocket, payload)

  assert(emitted, 'expected socket.emit to be called')
  assert.equal(emitted.evt, 'response')
  assert.equal(emitted.payload.id, payload.id)
  assert.deepEqual(emitted.payload.result, { ok: true })
  assert.equal(emitted.payload.error, null)
})

test('server deserializes serialized filter + filterContext and invokes filter(metadata, context)', async () => {
  const server = new VectoriaDBServer()

  // stub the underlying VectoriaDB method (`search`) to inspect received args
  server._vectoria = {
    async search(...args) {
      const opt = args.find(a => a && typeof a === 'object' && Object.prototype.hasOwnProperty.call(a, 'filter'))
      assert(opt, 'expected an options object containing `filter`')
      assert.equal(typeof opt.filter, 'function', 'options.filter should be a function after deserialization')

      // call filter — the wrapper should have bound the provided context
      const sample = { owner: 'team' }
      assert.equal(opt.filter(sample), true)
      return { ok: true }
    },
  }

  // capture emitted responses from the "socket"
  let emitted = null
  const mockSocket = { emit: (evt, payload) => (emitted = { evt, payload }) }

  const payload = {
    id: 't-filter-ctx',
    method: 'search',
    params: [
      {
        filter: { __isFnString: true, fn: 'function(m, ctx){ return m && m.owner === ctx.owner }' },
        filterContext: { owner: 'team' },
      },
    ],
  }

  await server._handleRequest(mockSocket, payload)

  assert(emitted, 'expected socket.emit to be called')
  assert.equal(emitted.evt, 'response')
  assert.equal(emitted.payload.id, payload.id)
  assert.deepEqual(emitted.payload.result, { ok: true })
  assert.equal(emitted.payload.error, null)
})
