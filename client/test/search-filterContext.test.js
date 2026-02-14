import test from 'node:test'
import assert from 'node:assert/strict'
import VectoriaDB from '../index.js'

test('client.search forwards serialized filter and filterContext to socket', async () => {
  const db = new VectoriaDB({ serverUrl: 'http://localhost:3001' })

  // mock socket to capture forwarded payload
  let captured = null
  db._socket = {
    sendRequest({ method, params }) {
      captured = { method, params }
      return Promise.resolve([])
    },
  }

  const ctx = { chatId: 'abc' }
  await db.search('hello', {
    topK: 5,
    filter: (m, c) => m.type === 't-bot-context' && m.chatId === c.chatId,
    filterContext: ctx,
  })

  assert.equal(captured.method, 'search')
  assert.equal(captured.params.length, 2)

  const sentOpts = captured.params[1]
  assert(sentOpts && typeof sentOpts === 'object')
  assert.equal(typeof sentOpts.filter, 'object')
  assert.equal(sentOpts.filter.__isFnString, true)
  assert.ok(typeof sentOpts.filter.fn === 'string' && sentOpts.filter.fn.includes('chatId'))
  assert.deepEqual(sentOpts.filterContext, ctx)
})

test('client.search resolves to server result unchanged', async () => {
  const db = new VectoriaDB({ serverUrl: 'http://localhost:3001' })

  const fakeResult = [
    { id: '1', text: 'one', metadata: { chatId: 'abc' } },
    { id: '2', text: 'two', metadata: { chatId: 'abc' } },
  ]

  db._socket = {
    sendRequest() {
      return Promise.resolve(fakeResult)
    },
  }

  const res = await db.search('q', { topK: 2 })
  assert.deepEqual(res, fakeResult)
})

test('client.query inlines user filter and forwards filterContext', async () => {
  const db = new VectoriaDB({ serverUrl: 'http://localhost:3001' })
  let captured = null
  db._socket = {
    sendRequest({ method, params }) {
      captured = { method, params }
      return Promise.resolve([])
    },
  }

  await db.query('myCollection', 'x', {
    filter: (m, ctx) => m.owner === 'myCollection' && m.chatId === ctx.chatId,
    filterContext: { chatId: 'c1' },
  })

  const sentOpts = captured.params[1]
  assert.equal(typeof sentOpts.filter, 'object')
  assert.equal(sentOpts.filter.__isFnString, true)
  // combined inlined function should accept a second argument (ctx)
  assert.ok(sentOpts.filter.fn.includes('__ctx') || sentOpts.filter.fn.includes('ctx'))
  assert.deepEqual(sentOpts.filterContext, { chatId: 'c1' })
})
