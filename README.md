# VectoriaDB SDK

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)]()

A lightweight, JavaScript-only client/server SDK for [VectoriaDB](https://github.com/agentfront/vectoriadb). Forward vector database operations from client applications to a centralized server instance with ease.

> ⚠️ **Not for large production deployments.** This SDK is primarily intended for small applications, prototypes, demos, and hobby projects where quick setup and simplicity are priorities. For mission‑critical or large-scale production use, consider a hardened, production-grade solution.

---

## Features

- **Mirror API**: Client SDK replicates the full VectoriaDB API surface.
- **Remote Execution**: Perform heavy vector operations on the server; keep your client light.
- **Smart Filtering**: Send JavaScript functions as filters; they are automatically serialized and executed on the server.
- **Streaming Support**: Smoothly handle large result sets with built-in chunking.
- **Robust Connection**: Automatic reconnection, request queueing, and configurable timeouts.
- **Collection Helpers**: High-level abstractions for simplified document management.

## Project Structure

```text
vectoriadb-sdk/
├── server/         # Server implementation (hosts VectoriaDB instance)
└── client/         # Client implementation (forwards requests via Socket.io)
```

## Quick Start

### 1. Start the Server

The server requires `vectoriadb` to be installed.

```bash
cd server
npm install
npm start
```

**Basic Server Configuration (`server/index.js`):**

```javascript
import VectoriaDBServer from '@ouim/vectoriadb-server'

const server = new VectoriaDBServer({
  port: 3001,
  cors: ['http://localhost:3000'],
  // apiKey: 'your-secure-key' // Optional authentication
})

await server.listen()
```

### 2. Connect the Client

```bash
npm install @ouim/vectoriadb-client
```

**Basic Usage:**

```javascript
import VectoriaDB from '@ouim/vectoriadb-client'

const db = new VectoriaDB({
  serverUrl: 'http://localhost:3001',
  // apiKey: 'your-secure-key'
})

await db.initialize()

// Add documents
await db.add('doc1', 'Vector databases are awesome!', { category: 'tech' })

// Search with semantic similarity
const results = await db.search('vector database', { topK: 5 })
console.log(results)
```

---

## Advanced Search & Filtering

### Remote Function Filtering

One of the most powerful features is the ability to filter results server-side using client-defined functions:

```javascript
const results = await db.search('cloud computing', {
  filter: metadata => metadata.category === 'tech' && metadata.priority > 5,
  threshold: 0.7, // Strict similarity matching
})
```

### Collection-Style API

Use `insert` and `query` for a more traditional database feel:

```javascript
await db.insert('my-collection', [
  { text: 'Hello World', metadata: { author: 'Alice' } },
  { text: 'Goodbye World', metadata: { author: 'Bob' } },
])

const bobDocs = await db.query('my-collection', 'farewell', {
  filter: m => m.author === 'Bob',
})
```

---

## ⚙️ Configuration

### Server Options

| Option            | Description                            | Default    |
| :---------------- | :------------------------------------- | :--------- |
| `port`            | Server listening port                  | `3001`     |
| `host`            | Server host address                    | `0.0.0.0`  |
| `apiKey`          | Optional key for client authentication | `null`     |
| `cors`            | Allowed origins (array)                | `[]` (All) |
| `streamChunkSize` | Max results per chunk for streaming    | `500`      |

### Client Options

| Option           | Description                  | Default      |
| :--------------- | :--------------------------- | :----------- |
| `serverUrl`      | URL of the VectoriaDB server | **Required** |
| `apiKey`         | Authentication key           | `null`       |
| `requestTimeout` | API request timeout in ms    | `30000`      |

---

## Large Datasets & Streaming

The SDK automatically handles large result sets by chunking data on the server and assembling it on the client. This prevents memory issues and payload limits when retrieving thousands of vectors.

- **Automatic assembly**: You don't need to worry about chunks; the `Promise` resolves only when all data has arrived.
- **Configurable limits**: Set `streamChunkSize` on the server to tune the chunking behavior.

## Connection Resilience

Built for real-world networks, the client includes:

- **Offline Queueing**: Requests made while the connection is down are queued and sent automatically upon reconnection.
- **Heartbeat & Health Checks**: Monitors connection status to ensure reliable delivery.
- **Configurable Timeouts**: Each request can have its own timeout, or use a global default.

---

## Security Note

> [!WARNING] Filter functions passed from the client are serialized and evaluated on the server using `new Function()`. **Never** expose the server to untrusted clients without strict network controls or additional sandboxing.

---

## Docker Integration

When deploying with Docker, ensure you persist the database state:

```yaml
services:
  vectoriadb-server:
    image: node:18
    # ... other config
    volumes:
      - vectoria-data:/app/server/.cache/vectoriadb

volumes:
  vectoria-data:
```

## Best Practices

- **Intended use**: Not recommended for large production systems — best suited for prototypes, demos, and hobby projects where quick setup matters.
- **Batching**: Use `addMany` instead of repeated `add` calls for efficiency.
- **Timeouts**: Adjust `requestTimeout` for large-scale operations.
- **Shutdown**: Always call `db.close()` on the client and `server.close()` on the server for graceful termination.

---

## FAQ

**Q: Do I need `vectoriadb` on the client?**  
A: No! The client only needs `socket.io-client`. It's designed to be used in browsers or lightweight Node environments.

**Q: How does the server-side filtering work?**  
A: The client SDK stringifies your filter function. The server then reconstructs it using `new Function()`. This is why the filter must be self-contained and not rely on variables outside its scope.

---

## Credits

This SDK builds on and integrates with [VectoriaDB](https://github.com/agentfront/vectoriadb). See the Vectoria product website at [https://agentfront.dev/vectoria](https://agentfront.dev/vectoria) for more information and additional resources.

---

## License

MIT © 2026 VectoriaDB SDK Authors
