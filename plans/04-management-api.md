# Plan 4: Management API

## Objective

Create HTTP REST endpoints for managing the mempool state, controlling filtering rules, and manipulating pending transactions. This API enables programmatic control of the debug mempool for test automation and provides the backend for the future UI.

## Prerequisites

- Plan 1 completed (Core Proxy Infrastructure)
- Plan 2 completed (Mempool Storage Layer)
- Plan 3 completed (Transaction Interception)

## Tasks

### 4.1 Define API Response Types

**File**: `packages/server/src/api/types.ts`

```typescript
// Standard API response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Transaction list item for API responses
export interface TransactionInfo {
  hash: string;
  from: string;
  to: string | null;
  nonce: number;
  gasPrice: string;        // Hex string
  maxFeePerGas?: string;   // Hex string
  maxPriorityFee?: string; // Hex string
  gasLimit: string;        // Hex string
  value: string;           // Hex string
  data: string | null;
  status: string;
  createdAt: number;
  forwardedAt?: number;
  droppedAt?: number;
  dropReason?: string;
}

// Mempool state for API responses
export interface MempoolStateInfo {
  minGasPrice: string;     // Hex string
  autoForward: boolean;    // Default: true - automatically forward transactions
}

// Mempool statistics
export interface MempoolStatsInfo {
  totalPending: number;
  totalForwarded: number;
  totalDropped: number;
  oldestPendingAge?: number; // Seconds since oldest pending tx
  uniqueSenders: number;
}
```

### 4.2 Create Mempool Management API

**File**: `packages/server/src/api/mempool.ts`

```typescript
import { Hono } from 'hono';
import { ServerOptions } from '../types.js';
import { setup } from '../setup.js';
import { Env } from '../env.js';
import { MempoolManager } from '../mempool/state.js';
import { ApiResponse, TransactionInfo, MempoolStateInfo, MempoolStatsInfo } from './types.js';
import { PendingTransaction } from '../mempool/types.js';

// Convert domain transaction to API response format
function toTransactionInfo(tx: PendingTransaction): TransactionInfo {
  return {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    nonce: tx.nonce,
    gasPrice: `0x${tx.gasPrice.toString(16)}`,
    maxFeePerGas: tx.maxFeePerGas ? `0x${tx.maxFeePerGas.toString(16)}` : undefined,
    maxPriorityFee: tx.maxPriorityFee ? `0x${tx.maxPriorityFee.toString(16)}` : undefined,
    gasLimit: `0x${tx.gasLimit.toString(16)}`,
    value: `0x${tx.value.toString(16)}`,
    data: tx.data,
    status: tx.status,
    createdAt: tx.createdAt,
    forwardedAt: tx.forwardedAt,
    droppedAt: tx.droppedAt,
    dropReason: tx.dropReason,
  };
}

export function getMempoolAPI<CustomEnv extends Env>(
  options: ServerOptions<CustomEnv>,
) {
  const app = new Hono<{ Bindings: CustomEnv }>()
    .use(setup({ serverOptions: options }))

    // === STATE MANAGEMENT ===

    // GET /api/mempool/state - Get current mempool state
    .get('/state', async (c) => {
      const config = c.get('config');
      const storage = config.storage;

      const state: MempoolStateInfo = {
        minGasPrice: `0x${(await storage.getMinGasPrice()).toString(16)}`,
        autoForward: await storage.isAutoForward(),
      };

      return c.json<ApiResponse<MempoolStateInfo>>({
        success: true,
        data: state,
      });
    })

    // POST /api/mempool/gas-price - Set minimum gas price
    .post('/gas-price', async (c) => {
      const body = await c.req.json<{ minGasPrice: string }>();
      const config = c.get('config');

      let price: bigint;
      try {
        // Accept hex string or decimal string
        price = BigInt(body.minGasPrice);
      } catch {
        return c.json<ApiResponse>({
          success: false,
          error: 'Invalid gas price format',
        }, 400);
      }

      await config.storage.setMinGasPrice(price);

      return c.json<ApiResponse>({
        success: true,
        data: { minGasPrice: `0x${price.toString(16)}` },
      });
    })

    // POST /api/mempool/auto-forward - Set auto-forward mode
    .post('/auto-forward', async (c) => {
      const body = await c.req.json<{ enabled: boolean }>();
      const config = c.get('config');

      await config.storage.setAutoForward(body.enabled);

      return c.json<ApiResponse>({
        success: true,
        data: { autoForward: body.enabled },
      });
    })

    // === TRANSACTION QUERIES ===

    // GET /api/mempool/stats - Get mempool statistics
    .get('/stats', async (c) => {
      const config = c.get('config');
      const stats = await config.storage.getStats();

      const now = Math.floor(Date.now() / 1000);
      const info: MempoolStatsInfo = {
        totalPending: stats.totalPending,
        totalForwarded: stats.totalForwarded,
        totalDropped: stats.totalDropped,
        oldestPendingAge: stats.oldestPending 
          ? now - stats.oldestPending 
          : undefined,
        uniqueSenders: stats.uniqueSenders,
      };

      return c.json<ApiResponse<MempoolStatsInfo>>({
        success: true,
        data: info,
      });
    })

    // GET /api/mempool/pending - List all pending transactions
    .get('/pending', async (c) => {
      const config = c.get('config');
      const from = c.req.query('from');
      const limit = c.req.query('limit');
      const offset = c.req.query('offset');

      const txs = await config.storage.getPendingTransactions({
        status: 'pending',
        from: from?.toLowerCase(),
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });

      return c.json<ApiResponse<TransactionInfo[]>>({
        success: true,
        data: txs.map(toTransactionInfo),
      });
    })

    // GET /api/mempool/tx/:hash - Get specific transaction
    .get('/tx/:hash', async (c) => {
      const hash = c.req.param('hash');
      const config = c.get('config');

      const tx = await config.storage.getTransaction(hash);
      if (!tx) {
        return c.json<ApiResponse>({
          success: false,
          error: 'Transaction not found',
        }, 404);
      }

      return c.json<ApiResponse<TransactionInfo>>({
        success: true,
        data: toTransactionInfo(tx),
      });
    })

    // GET /api/mempool/sender/:address - Get transactions by sender
    .get('/sender/:address', async (c) => {
      const address = c.req.param('address');
      const config = c.get('config');

      const txs = await config.storage.getTransactionsBySender(address);

      return c.json<ApiResponse<TransactionInfo[]>>({
        success: true,
        data: txs.map(toTransactionInfo),
      });
    })

    // === TRANSACTION MANAGEMENT ===

    // POST /api/mempool/include/:hash - Force include a specific transaction
    .post('/include/:hash', async (c) => {
      const hash = c.req.param('hash');
      const config = c.get('config');
      const targetUrl = config.env.RPC_URL;

      if (!targetUrl) {
        return c.json<ApiResponse>({
          success: false,
          error: 'RPC_URL not configured',
        }, 500);
      }

      const mempool = new MempoolManager(config.storage, targetUrl);
      const result = await mempool.forceInclude(hash);

      if (!result.success) {
        return c.json<ApiResponse>({
          success: false,
          error: result.error,
        }, 400);
      }

      return c.json<ApiResponse>({
        success: true,
        data: { hash, status: 'forwarded' },
      });
    })

    // POST /api/mempool/drop/:hash - Drop a pending transaction
    .post('/drop/:hash', async (c) => {
      const hash = c.req.param('hash');
      const config = c.get('config');
      const body = await c.req.json<{ reason?: string }>().catch(() => ({}));

      const success = await config.storage.updateStatus(
        hash,
        'dropped',
        body.reason ?? 'Manually dropped'
      );

      if (!success) {
        const tx = await config.storage.getTransaction(hash);
        if (!tx) {
          return c.json<ApiResponse>({
            success: false,
            error: 'Transaction not found',
          }, 404);
        }
        // Transaction exists but couldn't be dropped
        return c.json<ApiResponse>({
          success: false,
          error: `Transaction is ${tx.status}, not pending`,
        }, 400);
      }

      return c.json<ApiResponse>({
        success: true,
        data: { hash, status: 'dropped' },
      });
    })

    // POST /api/mempool/flush - Forward all pending transactions
    .post('/flush', async (c) => {
      const config = c.get('config');
      const targetUrl = config.env.RPC_URL;

      if (!targetUrl) {
        return c.json<ApiResponse>({
          success: false,
          error: 'RPC_URL not configured',
        }, 500);
      }

      const mempool = new MempoolManager(config.storage, targetUrl);
      const result = await mempool.flushPending();

      return c.json<ApiResponse>({
        success: true,
        data: result,
      });
    })

    // DELETE /api/mempool/clear - Clear all pending transactions
    .delete('/clear', async (c) => {
      const config = c.get('config');
      const cleared = await config.storage.clearPending();

      return c.json<ApiResponse>({
        success: true,
        data: { cleared },
      });
    });

  return app;
}
```

### 4.3 Register Mempool API in Server

**File**: [`packages/server/src/index.ts`](../packages/server/src/index.ts)

Add the mempool API route:

```typescript
import { getMempoolAPI } from './api/mempool.js';

export function createServer<CustomEnv extends Env>(
  options: ServerOptions<CustomEnv>,
) {
  const app = new Hono<{ Bindings: CustomEnv }>();

  const dummy = getDummyAPI(options);
  const rpc = getRpcAPI(options);
  const mempool = getMempoolAPI(options);
  const health = getHealthAPI(options);

  return app
    .use('/*', corsSetup)
    .route('/', dummy)
    .route('/rpc', rpc)
    .route('/api/mempool', mempool)
    .route('/health', health)
    // ... rest
}
```

### 4.4 Add Batch Operations

**File**: `packages/server/src/api/mempool.ts` (additions)

Add batch operations for efficiency:

```typescript
// POST /api/mempool/include-batch - Force include multiple transactions
.post('/include-batch', async (c) => {
  const body = await c.req.json<{ hashes: string[] }>();
  const config = c.get('config');
  const targetUrl = config.env.RPC_URL;

  if (!targetUrl) {
    return c.json<ApiResponse>({
      success: false,
      error: 'RPC_URL not configured',
    }, 500);
  }

  const mempool = new MempoolManager(config.storage, targetUrl);
  const results: { hash: string; success: boolean; error?: string }[] = [];

  for (const hash of body.hashes) {
    const result = await mempool.forceInclude(hash);
    results.push({
      hash,
      success: result.success,
      error: result.error,
    });
  }

  return c.json<ApiResponse>({
    success: true,
    data: {
      results,
      forwarded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    },
  });
})

// POST /api/mempool/drop-batch - Drop multiple transactions
.post('/drop-batch', async (c) => {
  const body = await c.req.json<{ hashes: string[]; reason?: string }>();
  const config = c.get('config');

  const results: { hash: string; dropped: boolean }[] = [];

  for (const hash of body.hashes) {
    await config.storage.updateStatus(hash, 'dropped', body.reason ?? 'Batch drop');
    const tx = await config.storage.getTransaction(hash);
    results.push({
      hash,
      dropped: tx?.status === 'dropped',
    });
  }

  return c.json<ApiResponse>({
    success: true,
    data: {
      results,
      dropped: results.filter(r => r.dropped).length,
    },
  });
})
```

### 4.5 Add History/Audit Endpoint

```typescript
// GET /api/mempool/history - Get transaction history
.get('/history', async (c) => {
  const config = c.get('config');
  const status = c.req.query('status'); // pending, forwarded, dropped
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const txs = await config.storage.getPendingTransactions({
    status: status as any,
    limit,
    offset,
  });

  return c.json<ApiResponse<TransactionInfo[]>>({
    success: true,
    data: txs.map(toTransactionInfo),
  });
})
```

## API Reference

### State Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mempool/state` | GET | Get current mempool state |
| `/api/mempool/gas-price` | POST | Set minimum gas price |
| `/api/mempool/auto-forward` | POST | Enable/disable auto-forward (default: true) |

### Transaction Queries

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mempool/stats` | GET | Get mempool statistics |
| `/api/mempool/pending` | GET | List pending transactions |
| `/api/mempool/tx/:hash` | GET | Get specific transaction |
| `/api/mempool/sender/:address` | GET | Get transactions by sender |
| `/api/mempool/history` | GET | Get transaction history |

### Transaction Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mempool/include/:hash` | POST | Force include transaction |
| `/api/mempool/drop/:hash` | POST | Drop pending transaction |
| `/api/mempool/include-batch` | POST | Force include multiple |
| `/api/mempool/drop-batch` | POST | Drop multiple transactions |
| `/api/mempool/flush` | POST | Forward all pending |
| `/api/mempool/clear` | DELETE | Clear all pending |

## Testing Checklist

- [ ] `GET /api/mempool/state` returns current state
- [ ] `POST /api/mempool/gas-price` sets minimum gas price
- [ ] `POST /api/mempool/auto-forward` enables/disables auto-forward
- [ ] `GET /api/mempool/stats` returns accurate statistics
- [ ] `GET /api/mempool/pending` lists all pending transactions
- [ ] `GET /api/mempool/tx/:hash` returns specific transaction
- [ ] `POST /api/mempool/include/:hash` forwards transaction
- [ ] `POST /api/mempool/drop/:hash` drops transaction
- [ ] `POST /api/mempool/flush` forwards all pending
- [ ] `DELETE /api/mempool/clear` clears pending

## Test Commands

```bash
# Check mempool state
curl http://localhost:3000/api/mempool/state

# Disable auto-forward to hold transactions
curl -X POST http://localhost:3000/api/mempool/auto-forward \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Set minimum gas price to 10 gwei
curl -X POST http://localhost:3000/api/mempool/gas-price \
  -H "Content-Type: application/json" \
  -d '{"minGasPrice": "10000000000"}'

# List pending transactions
curl http://localhost:3000/api/mempool/pending

# Get statistics
curl http://localhost:3000/api/mempool/stats

# Force include a transaction
curl -X POST http://localhost:3000/api/mempool/include/0xabc...

# Drop a transaction
curl -X POST http://localhost:3000/api/mempool/drop/0xabc... \
  -H "Content-Type: application/json" \
  -d '{"reason": "Testing drop"}'

# Flush all pending
curl -X POST http://localhost:3000/api/mempool/flush

# Clear mempool
curl -X DELETE http://localhost:3000/api/mempool/clear
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/server/src/api/types.ts` | Create |
| `packages/server/src/api/mempool.ts` | Create |
| `packages/server/src/index.ts` | Modify |

## Success Criteria

1. All endpoints return proper JSON responses
2. State changes persist across requests
3. Transaction management operations work correctly
4. Batch operations handle multiple transactions
5. Error handling returns appropriate status codes
6. CORS headers allow frontend access
7. Query parameters work for filtering

## Next Phase

With the management API complete, proceed to [Plan 5: UI Foundation](./05-ui-foundation.md) to build the web interface for manual mempool management.
