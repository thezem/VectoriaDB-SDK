import VectoriaDB from './index.js'

async function perfDemo() {
  const db = new VectoriaDB({ serverUrl: 'http://localhost:3001' })

  console.log('Initializing remote VectoriaDB (server should already be running)...')
  await db.initialize()

  console.log('Inserting 1,000 small documents in batches of 200...')
  const docs = Array.from({ length: 1000 }, (_, i) => ({
    id: `doc:${i}`,
    text: `Document number ${i}`,
    metadata: { id: `doc:${i}`, owner: 'demo' },
  }))

  const start = Date.now()
  for (let i = 0; i < docs.length; i += 200) {
    const batch = docs.slice(i, i + 200)
    await db.addMany(batch)
  }
  console.log('Inserted 1000 docs in', Date.now() - start, 'ms')

  console.log('Running a search...')
  const results = await db.search('Document number 5', { topK: 10 })
  console.log('Search results:', results.slice(0, 3))

  db.close()
}

perfDemo().catch(err => {
  console.error(err)
  process.exit(1)
})
