import VectoriaDBServer from './vectoriadb-server.js'
import { FileStorageAdapter } from 'vectoriadb'

// // If run directly, start a demo server
// if (process.argv[1] && process.argv[1].endsWith('index.js')) {
//   const server = new VectoriaDBServer({
//     port: process.env.PORT ? Number(process.env.PORT) : 3001,
//     host: '0.0.0.0',
//     vectoriadbConfig: {
//       // default storage / model - user should override for production
//       storageAdapter: new FileStorageAdapter({ cacheDir: '/data/vectoriadb', namespace: 'default' }),
//     },
//     cors: ['http://localhost:3000'],
//   })

//   server.listen().catch(err => {
//     console.error(err)
//     process.exit(1)
//   })
// }

export { VectoriaDBServer, FileStorageAdapter }
export default VectoriaDBServer
