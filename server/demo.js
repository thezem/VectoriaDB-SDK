import VectoriaDBServer from './vectoriadb-server.js'

async function main() {
  const server = new VectoriaDBServer({
    port: 3001,
    vectoriadbConfig: {
      cacheDir: './.cache/vectoriadb',
    },
  })

  await server.listen()
  console.log('Demo server is running. Connect with the client demo in the client folder.')

  // graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...')
    await server.close()
    process.exit(0)
  })
}

main().catch(err => console.error(err))
