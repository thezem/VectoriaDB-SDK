# VectoriaDB SDK (client/server)

Lightweight JavaScript-only client/server SDK that forwards VectoriaDB operations from client apps to a central server instance.

## Structure

```
vectoriadb-sdk/
├── server/         # Server SDK (hosts VectoriaDB instance)
└── client/         # Client SDK (mimics VectoriaDB API, forwards via socket.io)
```

## Quick start

1. Install server dependencies and start the server (requires `vectoriadb` installed):

```bash
cd vectoriadb-sdk/server
npm install
npm start
```

2. Install client and run demo (client depends only on `socket.io-client`):

```bash
cd vectoriadb-sdk/client
npm install
npm run demo
```

## Design highlights ✅

- Socket.io namespace: `/vectoriadb`
- Request format: `{ id, method, params, collection, timestamp }`
- Response format: `{ result, error, took }` + chunked `response-chunk` events for large arrays
- Client mirrors VectoriaDB API (add/addMany/search/update/etc.)
- Convenience collection-style methods: `createCollection`, `insert`, `query`
- Client-side validation + server-side execution using the real `vectoriadb` instance
- Streaming for large results, offline queueing, auto-reconnect, request timeouts

## Security note

Filter functions passed from client are serialized and evaluated server-side. Do NOT accept untrusted client connections in production without additional sandboxing.

## Files to inspect

- `server/vectoriadb-server.js` — Server class, exposes VectoriaDB over socket.io
- `client/index.js` — Client SDK that mimics VectoriaDB API
- `client/socket-client.js` — socket.io client wrapper with queueing/reconnect/timeouts

## Next steps / recommendations 💡

- Add authentication middleware (API key is supported; extend for JWT/OAuth)
- Add transport encryption (TLS) for production
- Add unit + integration tests and CI pipeline
- Optionally support multiple VectoriaDB instances per collection on server
