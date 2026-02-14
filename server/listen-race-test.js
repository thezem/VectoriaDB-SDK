import VectoriaDBServer from './vectoriadb-server.js'
import { FileStorageAdapter } from 'vectoriadb'

async function run() {
  const server = new VectoriaDBServer({
    port: 3002,
    vectoriadbConfig: {
      storageAdapter: new FileStorageAdapter({ cacheDir: './.cache/test-vectoriadb', namespace: 'test' }),
    },
  })

  try {
    // call listen() twice concurrently to reproduce the race if present
    const results = await Promise.all([server.listen(), server.listen()])
    console.log('listen() calls resolved, same instance:', results[0] === results[1])
    console.log('server._started =', server._started)
  } catch (err) {
    console.error('concurrent listen failed:', err)
    process.exitCode = 1
  } finally {
    await server.close()
  }
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
