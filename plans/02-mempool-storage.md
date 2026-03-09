# Plan 2: Mempool Storage Layer

## Objective

Design and implement the database schema and storage layer for managing pending transactions and mempool state. This provides persistence so transactions survive proxy restarts.

## Prerequisites

- Plan 1 completed (Core Proxy Infrastructure)
- SQLite database configured via remote-sql-libsql
- Existing remote-sql patterns from the template

## Tasks

### 2.1 Design Database Schema

**File**: `packages/server/src/schema/sql/mempool.sql`

```sql
-- Pending transactions in the local mempool
CREATE TABLE IF NOT EXISTS PendingTransactions (
    hash TEXT PRIMARY KEY,           -- Transaction hash (0x...)
    raw_tx TEXT NOT NULL,            -- Raw signed transaction hex
    from_address TEXT NOT NULL,      -- Sender address
    to_address TEXT,                 -- Recipient address (null for contract creation)
    nonce INTEGER NOT NULL,          -- Transaction nonce
    gas_price TEXT NOT NULL,         -- Gas price in wei (stored as string for precision)
    max_fee_per_gas TEXT,            -- EIP-1559 max fee (optional)
    max_priority_fee TEXT,           -- EIP-1559 priority fee (optional)
    gas_limit TEXT NOT NULL,         -- Gas limit
    value TEXT NOT NULL,             -- Value in wei
    data TEXT,                       -- Transaction data/calldata
    chain_id INTEGER,                -- Chain ID
    tx_type INTEGER DEFAULT 0,       -- Transaction type (0=legacy, 1=access list, 2=EIP-1559)
    status TEXT DEFAULT 'pending',   -- pending, forwarded, dropped, replaced
    created_at INTEGER NOT NULL,     -- Unix timestamp when received
    forwarded_at INTEGER,            -- Unix timestamp when forwarded to node
    dropped_at INTEGER,              -- Unix timestamp when dropped
    drop_reason TEXT                 -- Reason for dropping (if applicable)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_pending_from ON PendingTransactions(from_address);
CREATE INDEX IF NOT EXISTS idx_pending_status ON PendingTransactions(status);
CREATE INDEX IF NOT EXISTS idx_pending_nonce ON PendingTransactions(from_address, nonce);
CREATE INDEX IF NOT EXISTS idx_pending_gas_price ON PendingTransactions(gas_price);
CREATE INDEX IF NOT EXISTS idx_pending_created ON PendingTransactions(created_at);

-- Mempool configuration state
CREATE TABLE IF NOT EXISTS MempoolState (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Initialize default state
INSERT OR IGNORE INTO MempoolState (key, value, updated_at) VALUES
    ('min_gas_price', '0', 0),
    ('auto_forward', 'true', 0);
```

### 2.2 Create Mempool Types

**File**: `packages/server/src/mempool/types.ts`

```typescript
// Transaction status in the local mempool
export type TransactionStatus = 'pending' | 'forwarded' | 'dropped' | 'replaced';

// Pending transaction record
export interface PendingTransaction {
  hash: string;
  rawTx: string;
  from: string;
  to: string | null;
  nonce: number;
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFee?: bigint;
  gasLimit: bigint;
  value: bigint;
  data: string | null;
  chainId?: number;
  txType: number;
  status: TransactionStatus;
  createdAt: number;
  forwardedAt?: number;
  droppedAt?: number;
  dropReason?: string;
}

// Database row representation
export interface PendingTransactionRow {
  hash: string;
  raw_tx: string;
  from_address: string;
  to_address: string | null;
  nonce: number;
  gas_price: string;
  max_fee_per_gas: string | null;
  max_priority_fee: string | null;
  gas_limit: string;
  value: string;
  data: string | null;
  chain_id: number | null;
  tx_type: number;
  status: string;
  created_at: number;
  forwarded_at: number | null;
  dropped_at: number | null;
  drop_reason: string | null;
}

// Mempool state keys
export type MempoolStateKey = 'min_gas_price' | 'auto_forward';

// Mempool statistics
export interface MempoolStats {
  totalPending: number;
  totalForwarded: number;
  totalDropped: number;
  oldestPending?: number;
  uniqueSenders: number;
}

// Filter criteria for querying transactions
export interface TransactionFilter {
  status?: TransactionStatus;
  from?: string;
  minGasPrice?: bigint;
  maxGasPrice?: bigint;
  limit?: number;
  offset?: number;
}
```

### 2.3 Create Storage Layer

**File**: `packages/server/src/storage/mempool.ts`

```typescript
import { RemoteSQL } from 'remote-sql';
import {
  PendingTransaction,
  PendingTransactionRow,
  TransactionStatus,
  MempoolStateKey,
  MempoolStats,
  TransactionFilter,
} from '../mempool/types.js';

export class MempoolStorage {
  constructor(private db: RemoteSQL) {}

  // Convert database row to domain object
  private rowToTransaction(row: PendingTransactionRow): PendingTransaction {
    return {
      hash: row.hash,
      rawTx: row.raw_tx,
      from: row.from_address,
      to: row.to_address,
      nonce: row.nonce,
      gasPrice: BigInt(row.gas_price),
      maxFeePerGas: row.max_fee_per_gas ? BigInt(row.max_fee_per_gas) : undefined,
      maxPriorityFee: row.max_priority_fee ? BigInt(row.max_priority_fee) : undefined,
      gasLimit: BigInt(row.gas_limit),
      value: BigInt(row.value),
      data: row.data,
      chainId: row.chain_id ?? undefined,
      txType: row.tx_type,
      status: row.status as TransactionStatus,
      createdAt: row.created_at,
      forwardedAt: row.forwarded_at ?? undefined,
      droppedAt: row.dropped_at ?? undefined,
      dropReason: row.drop_reason ?? undefined,
    };
  }

  // Add a new pending transaction
  async addTransaction(tx: Omit<PendingTransaction, 'status' | 'createdAt'>): Promise<void> {
    await this.db.execute(
      `INSERT INTO PendingTransactions 
       (hash, raw_tx, from_address, to_address, nonce, gas_price, 
        max_fee_per_gas, max_priority_fee, gas_limit, value, data, 
        chain_id, tx_type, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        tx.hash,
        tx.rawTx,
        tx.from,
        tx.to,
        tx.nonce,
        tx.gasPrice.toString(),
        tx.maxFeePerGas?.toString() ?? null,
        tx.maxPriorityFee?.toString() ?? null,
        tx.gasLimit.toString(),
        tx.value.toString(),
        tx.data,
        tx.chainId ?? null,
        tx.txType,
        Math.floor(Date.now() / 1000),
      ]
    );
  }

  // Get transaction by hash
  async getTransaction(hash: string): Promise<PendingTransaction | null> {
    const result = await this.db.query<PendingTransactionRow>(
      'SELECT * FROM PendingTransactions WHERE hash = ?',
      [hash]
    );
    return result.length > 0 ? this.rowToTransaction(result[0]) : null;
  }

  // Get all pending transactions
  async getPendingTransactions(filter?: TransactionFilter): Promise<PendingTransaction[]> {
    let query = 'SELECT * FROM PendingTransactions WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    } else {
      query += " AND status = 'pending'";
    }

    if (filter?.from) {
      query += ' AND from_address = ?';
      params.push(filter.from.toLowerCase());
    }

    if (filter?.minGasPrice !== undefined) {
      query += ' AND CAST(gas_price AS INTEGER) >= ?';
      params.push(filter.minGasPrice.toString());
    }

    if (filter?.maxGasPrice !== undefined) {
      query += ' AND CAST(gas_price AS INTEGER) <= ?';
      params.push(filter.maxGasPrice.toString());
    }

    query += ' ORDER BY created_at ASC';

    if (filter?.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter?.offset) {
      query += ' OFFSET ?';
      params.push(filter.offset);
    }

    const result = await this.db.query<PendingTransactionRow>(query, params);
    return result.map((row) => this.rowToTransaction(row));
  }

  // Get transactions by sender address
  async getTransactionsBySender(address: string): Promise<PendingTransaction[]> {
    const result = await this.db.query<PendingTransactionRow>(
      "SELECT * FROM PendingTransactions WHERE from_address = ? AND status = 'pending' ORDER BY nonce ASC",
      [address.toLowerCase()]
    );
    return result.map((row) => this.rowToTransaction(row));
  }

  // Update transaction status
  async updateStatus(
    hash: string,
    status: TransactionStatus,
    reason?: string
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    
    if (status === 'forwarded') {
      await this.db.execute(
        'UPDATE PendingTransactions SET status = ?, forwarded_at = ? WHERE hash = ?',
        [status, now, hash]
      );
    } else if (status === 'dropped' || status === 'replaced') {
      await this.db.execute(
        'UPDATE PendingTransactions SET status = ?, dropped_at = ?, drop_reason = ? WHERE hash = ?',
        [status, now, reason ?? null, hash]
      );
    } else {
      await this.db.execute(
        'UPDATE PendingTransactions SET status = ? WHERE hash = ?',
        [status, hash]
      );
    }
  }

  // Remove transaction from mempool
  async removeTransaction(hash: string): Promise<boolean> {
    const result = await this.db.execute(
      'DELETE FROM PendingTransactions WHERE hash = ?',
      [hash]
    );
    return (result.rowsAffected ?? 0) > 0;
  }

  // Clear all pending transactions
  async clearPending(): Promise<number> {
    const result = await this.db.execute(
      "DELETE FROM PendingTransactions WHERE status = 'pending'"
    );
    return result.rowsAffected ?? 0;
  }

  // Get mempool statistics
  async getStats(): Promise<MempoolStats> {
    const stats = await this.db.query<{
      status: string;
      count: number;
    }>(
      'SELECT status, COUNT(*) as count FROM PendingTransactions GROUP BY status'
    );

    const oldest = await this.db.query<{ created_at: number }>(
      "SELECT created_at FROM PendingTransactions WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
    );

    const senders = await this.db.query<{ count: number }>(
      "SELECT COUNT(DISTINCT from_address) as count FROM PendingTransactions WHERE status = 'pending'"
    );

    const statsMap: Record<string, number> = {};
    for (const row of stats) {
      statsMap[row.status] = row.count;
    }

    return {
      totalPending: statsMap['pending'] ?? 0,
      totalForwarded: statsMap['forwarded'] ?? 0,
      totalDropped: (statsMap['dropped'] ?? 0) + (statsMap['replaced'] ?? 0),
      oldestPending: oldest[0]?.created_at,
      uniqueSenders: senders[0]?.count ?? 0,
    };
  }

  // State management
  async getState(key: MempoolStateKey): Promise<string | null> {
    const result = await this.db.query<{ value: string }>(
      'SELECT value FROM MempoolState WHERE key = ?',
      [key]
    );
    return result[0]?.value ?? null;
  }

  async setState(key: MempoolStateKey, value: string): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO MempoolState (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value, Math.floor(Date.now() / 1000)]
    );
  }

  // Convenience state methods
  async getMinGasPrice(): Promise<bigint> {
    const value = await this.getState('min_gas_price');
    return BigInt(value ?? '0');
  }

  async setMinGasPrice(price: bigint): Promise<void> {
    await this.setState('min_gas_price', price.toString());
  }

  async isAutoForward(): Promise<boolean> {
    const value = await this.getState('auto_forward');
    return value !== 'false';
  }

  async setAutoForward(enabled: boolean): Promise<void> {
    await this.setState('auto_forward', enabled.toString());
  }
}
```

### 2.4 Update Setup to Include Storage

**File**: [`packages/server/src/setup.ts`](../packages/server/src/setup.ts)

Modify the setup middleware to include mempool storage:

```typescript
import { MempoolStorage } from './storage/mempool.js';

export type Config<CustomEnv extends Env> = {
  storage: MempoolStorage;
  env: CustomEnv;
};

export function setup<CustomEnv extends Env>(
  options: SetupOptions<CustomEnv>,
): MiddlewareHandler {
  const { getDB, getEnv } = options.serverOptions;

  return async (c, next) => {
    const env = getEnv(c);
    const db = getDB(c);
    const storage = new MempoolStorage(db);

    c.set('config', { storage, env });
    return next();
  };
}
```

### 2.5 Run SQL Schema Generation

The template includes `sql2ts.cjs` to generate TypeScript from SQL files:

```bash
cd packages/server
pnpm sql2ts
```

This will process `mempool.sql` and generate type definitions.

### 2.6 Initialize Database on Startup

Ensure the mempool schema is created when the server starts. This may involve:

- Running migrations in the platform adapter
- Or executing schema SQL on first connection

Check existing patterns in the template for database initialization.

## Testing Checklist

- [ ] Database schema creates successfully
- [ ] Can add a transaction to the mempool
- [ ] Can retrieve transaction by hash
- [ ] Can list all pending transactions
- [ ] Can filter transactions by status, sender, gas price
- [ ] Can update transaction status
- [ ] Can remove/clear transactions
- [ ] State management works (min gas price, auto-forward)
- [ ] Statistics are calculated correctly
- [ ] Data survives server restart

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/server/src/schema/sql/mempool.sql` | Create |
| `packages/server/src/mempool/types.ts` | Create |
| `packages/server/src/storage/mempool.ts` | Create |
| `packages/server/src/setup.ts` | Modify |

## Success Criteria

1. Database schema properly defines all required tables
2. Storage layer provides clean API for all mempool operations
3. BigInt values handled correctly for gas prices and values
4. Transaction status transitions work correctly
5. State persistence works across restarts
6. Efficient queries with proper indexing

## Next Phase

With storage in place, proceed to [Plan 3: Transaction Interception](./03-transaction-interception.md) to add the logic for capturing and processing transactions.
