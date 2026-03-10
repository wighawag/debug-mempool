# Template Agnostic Server

A template for building platform-agnostic servers that can run on Node.js, Cloudflare Workers, Bun, or any JavaScript runtime. The server has access to a database while remaining completely agnostic to the runtime environment.

## Architecture

```
├── packages/
│   └── server/          # Core server logic (platform-agnostic)
│       ├── src/
│       │   ├── index.ts      # Main server entry, exports createServer()
│       │   ├── types.ts      # ServerOptions type definition
│       │   ├── setup.ts      # Middleware for request context
│       │   ├── env.ts        # Base environment type
│       │   └── api/          # API route handlers
│       └── src/schema/sql/   # SQL schema files
│
└── platforms/
    ├── cf-worker/       # Cloudflare Workers platform adapter
    └── nodejs/          # Node.js platform adapter
```

### Key Concept: Dependency Injection

The template achieves platform agnosticism through a simple dependency injection pattern. The core server doesn't know how to access the database or environment - it receives these through callbacks:

```typescript
export type ServerOptions<Env extends Bindings = Bindings> = {
  getDB: (c: Context<{Bindings: Env}>) => RemoteSQL;
  getEnv: (c: Context<{Bindings: Env}>) => Env;
};
```

Each platform provides its own implementation of these functions.

## Getting Started

### Prerequisites

- Node.js (v18+)
- pnpm
- (Optional) zellij - for running multiple processes

### Installation

```bash
pnpm install
```

### Development

Run everything (requires zellij):
```bash
pnpm start
```

Or run individual platforms:

**Cloudflare Worker:**
```bash
pnpm cf-worker:dev
```

**Node.js:**
```bash
cd platforms/nodejs && pnpm dev
```

### Running Tests

```bash
pnpm test
```

## How to Use This Template

### 1. Clone and Rename

```bash
git clone <this-repo> my-server
cd my-server
```

Find and replace all occurrences:
- `purgatory-app` → `my-server-app`
- `purgatory-cf-worker` → `my-server-cf-worker`
- `purgatory-nodejs` → `my-server-nodejs`
- `template-agnostic-db` → `my-server-db`

### 2. Define Your Environment

Edit `packages/server/src/env.ts` to add your environment variables:

```typescript
export type Env = {
  DEV?: string;
  API_KEY?: string;      // Add your env vars
  DATABASE_URL?: string;
};
```

### 3. Create Your Database Schema

Edit `packages/server/src/schema/sql/db.sql`:

```sql
CREATE TABLE IF NOT EXISTS Users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    FOREIGN KEY (user_id) REFERENCES Users(id)
);
```

### 4. Add Your API Routes

Create new route files in `packages/server/src/api/`:

```typescript
// packages/server/src/api/users.ts
import { Hono } from 'hono';
import { ServerOptions } from '../types.js';
import { setup } from '../setup.js';
import { Env } from '../env.js';

export function getUsersAPI<CustomEnv extends Env>(
  options: ServerOptions<CustomEnv>,
) {
  const app = new Hono<{Bindings: CustomEnv}>()
    .use(setup({serverOptions: options}))
    .get('/', async (c) => {
      const config = c.get('config');
      // Access database through config.storage or directly via options.getDB
      return c.json({ users: [] });
    })
    .post('/', async (c) => {
      const body = await c.req.json();
      // Create user logic
      return c.json({ success: true });
    });

  return app;
}
```

Register it in `packages/server/src/index.ts`:

```typescript
import { getUsersAPI } from './api/users.js';

export function createServer<CustomEnv extends Env>(
  options: ServerOptions<CustomEnv>,
) {
  const app = new Hono<{Bindings: CustomEnv}>();

  const users = getUsersAPI(options);

  return app
    .use('/*', corsSetup)
    .route('/users', users)  // Add your route
    // ...
}
```

### 5. Implement Storage Layer (Recommended)

Create a storage abstraction for database operations:

```typescript
// packages/server/src/storage/index.ts
import { RemoteSQL } from 'remote-sql';

export class Storage {
  constructor(private db: RemoteSQL) {}

  async getUsers() {
    return this.db.query('SELECT * FROM Users');
  }

  async createUser(id: string, email: string) {
    return this.db.execute(
      'INSERT INTO Users (id, email) VALUES (?, ?)',
      [id, email]
    );
  }
}
```

Then integrate it into `setup.ts`:

```typescript
import { Storage } from './storage/index.js';

export type Config<CustomEnv extends Env> = {
  storage: Storage;
  env: CustomEnv;
};

export function setup<CustomEnv extends Env>(
  options: SetupOptions<CustomEnv>,
): MiddlewareHandler {
  const { getDB, getEnv } = options.serverOptions;

  return async (c, next) => {
    const env = getEnv(c);
    const db = getDB(c);
    const storage = new Storage(db);

    c.set('config', { storage, env });
    return next();
  };
}
```

### 6. Add a New Platform (e.g., Bun)

Create a new platform directory:

```bash
mkdir -p platforms/bun/src
```

Create the platform adapter:

```typescript
// platforms/bun/src/index.ts
import { createServer, type Env } from 'my-server-app';
import { RemoteSQL } from 'remote-sql';

// Implement RemoteSQL for your database driver
class BunSQLite implements RemoteSQL {
  // ... implementation
}

type BunEnv = Env & {
  DB_PATH: string;
};

const env = process.env as BunEnv;
const db = new BunSQLite(env.DB_PATH);

const app = createServer<BunEnv>({
  getDB: () => db,
  getEnv: () => env,
});

Bun.serve({
  port: 3000,
  fetch: app.fetch,
});
```

## Platform-Specific Notes

### Cloudflare Workers

- Uses D1 database via `remote-sql-d1`
- Environment variables configured in `wrangler.toml`
- Deploy with `pnpm deploy:production`

### Node.js

- Uses LibSQL (SQLite-compatible) via `remote-sql-libsql`
- Environment variables loaded from `.env` file
- Run with `pnpm dev` or build and run `node dist/cli.js`

## Database Abstraction

This template uses [remote-sql](https://github.com/user/remote-sql) for database abstraction. Implementations available:

- `remote-sql-d1` - Cloudflare D1
- `remote-sql-libsql` - LibSQL/Turso
- You can create your own by implementing the `RemoteSQL` interface

## Type-Safe Client

The server exports a type-safe client for frontend usage:

```typescript
import { createClient, type Client } from 'my-server-app';

const client: Client = createClient('http://localhost:3000');

// Type-safe API calls
const response = await client.users.$get();
```

## License

MIT
