# Plan 3: Transaction Interception

## Objective

Implement the core transaction interception logic that captures `eth_sendRawTransaction` calls, decodes transaction data using viem, applies filtering rules, and stores transactions in the local mempool.

## Prerequisites

- Plan 1 completed (Core Proxy Infrastructure)
- Plan 2 completed (Mempool Storage Layer)
- viem package installed in packages/server

## Tasks

### 3.1 Create Transaction Decoder

**File**: `packages/server/src/mempool/decoder.ts`

Use viem to decode raw transaction data:

```typescript
import {
  parseTransaction,
  type TransactionSerializable,
  type TransactionSerializableLegacy,
  type TransactionSerializableEIP1559,
  type TransactionSerializableEIP2930,
  keccak256,
  recoverTransactionAddress,
  type Hex,
} from 'viem';
import { PendingTransaction } from './types.js';

export interface DecodedTransaction {
  hash: string;
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
}

export async function decodeRawTransaction(rawTx: string): Promise<DecodedTransaction> {
  const hexTx = rawTx as Hex;
  
  // Parse the transaction
  const parsed = parseTransaction(hexTx);
  
  // Calculate transaction hash
  const hash = keccak256(hexTx);
  
  // Recover sender address from signature
  const from = await recoverTransactionAddress({
    serializedTransaction: hexTx,
  });

  // Determine transaction type and extract gas fields
  let gasPrice: bigint;
  let maxFeePerGas: bigint | undefined;
  let maxPriorityFee: bigint | undefined;
  let txType: number;

  if ('maxFeePerGas' in parsed && parsed.maxFeePerGas !== undefined) {
    // EIP-1559 transaction
    txType = 2;
    maxFeePerGas = parsed.maxFeePerGas;
    maxPriorityFee = parsed.maxPriorityFeePerGas;
    // Use maxFeePerGas as effective gas price for sorting
    gasPrice = maxFeePerGas;
  } else if ('accessList' in parsed && parsed.accessList !== undefined) {
    // EIP-2930 transaction
    txType = 1;
    gasPrice = (parsed as TransactionSerializableEIP2930).gasPrice ?? 0n;
  } else {
    // Legacy transaction
    txType = 0;
    gasPrice = (parsed as TransactionSerializableLegacy).gasPrice ?? 0n;
  }

  return {
    hash,
    from: from.toLowerCase(),
    to: parsed.to?.toLowerCase() ?? null,
    nonce: Number(parsed.nonce),
    gasPrice,
    maxFeePerGas,
    maxPriorityFee,
    gasLimit: parsed.gas ?? 0n,
    value: parsed.value ?? 0n,
    data: parsed.data ?? null,
    chainId: parsed.chainId,
    txType,
  };
}

// Validate transaction basics
export function validateTransaction(tx: DecodedTransaction): { valid: boolean; error?: string } {
  if (!tx.from) {
    return { valid: false, error: 'Invalid signature: cannot recover sender' };
  }

  if (tx.nonce < 0) {
    return { valid: false, error: 'Invalid nonce' };
  }

  if (tx.gasLimit <= 0n) {
    return { valid: false, error: 'Invalid gas limit' };
  }

  if (tx.gasPrice < 0n) {
    return { valid: false, error: 'Invalid gas price' };
  }

  return { valid: true };
}
```

### 3.2 Create Filter Engine

**File**: `packages/server/src/mempool/filters.ts`

Implement filtering rules for transactions:

```typescript
import { DecodedTransaction } from './decoder.js';
import { MempoolStorage } from '../storage/mempool.js';

export interface FilterResult {
  accepted: boolean;
  reason?: string;
  action: 'accept' | 'reject' | 'hold';
}

export interface FilterContext {
  storage: MempoolStorage;
  minGasPrice: bigint;
}

// Main filter function that applies all rules
export async function applyFilters(
  tx: DecodedTransaction,
  context: FilterContext
): Promise<FilterResult> {
  // Check minimum gas price
  const effectiveGasPrice = tx.maxFeePerGas ?? tx.gasPrice;
  if (effectiveGasPrice < context.minGasPrice) {
    return {
      accepted: false,
      action: 'reject',
      reason: `Gas price ${effectiveGasPrice} below minimum ${context.minGasPrice}`,
    };
  }

  // Check for nonce conflicts (replacement transactions)
  const existingTxs = await context.storage.getTransactionsBySender(tx.from);
  const conflicting = existingTxs.find((existing) => existing.nonce === tx.nonce);
  
  if (conflicting) {
    // Check if new transaction has higher gas price (replacement)
    const existingPrice = conflicting.maxFeePerGas ?? conflicting.gasPrice;
    const newPrice = tx.maxFeePerGas ?? tx.gasPrice;
    
    // Typically need 10% higher gas price to replace
    const minReplacementPrice = (existingPrice * 110n) / 100n;
    
    if (newPrice < minReplacementPrice) {
      return {
        accepted: false,
        action: 'reject',
        reason: `Replacement transaction gas price too low. Need at least ${minReplacementPrice}, got ${newPrice}`,
      };
    }
    
    // Mark the existing transaction as replaced
    await context.storage.updateStatus(
      conflicting.hash,
      'replaced',
      `Replaced by ${tx.hash}`
    );
  }

  return {
    accepted: true,
    action: 'accept',
  };
}

// Check for nonce gaps that would prevent execution
export async function checkNonceGap(
  tx: DecodedTransaction,
  storage: MempoolStorage,
  getOnChainNonce: (address: string) => Promise<number>
): Promise<{ hasGap: boolean; expectedNonce?: number }> {
  const onChainNonce = await getOnChainNonce(tx.from);
  
  // Check pending transactions for this sender
  const pendingTxs = await storage.getTransactionsBySender(tx.from);
  
  // Build set of nonces we have
  const pendingNonces = new Set(pendingTxs.map((t) => t.nonce));
  pendingNonces.add(tx.nonce);
  
  // Check for gaps starting from on-chain nonce
  for (let n = onChainNonce; n < tx.nonce; n++) {
    if (!pendingNonces.has(n)) {
      return { hasGap: true, expectedNonce: n };
    }
  }
  
  return { hasGap: false };
}
```

### 3.3 Create Mempool State Manager

**File**: `packages/server/src/mempool/state.ts`

Central manager for mempool state and operations:

```typescript
import { MempoolStorage } from '../storage/mempool.js';
import { decodeRawTransaction, validateTransaction, DecodedTransaction } from './decoder.js';
import { applyFilters, FilterResult } from './filters.js';
import { PendingTransaction } from './types.js';
import { forwardRpcRequest, createJsonRpcResult, createJsonRpcError } from '../rpc/proxy.js';
import { JsonRpcResponse } from '../rpc/types.js';

export interface MempoolState {
  minGasPrice: bigint;
  autoForward: boolean;
}

export class MempoolManager {
  constructor(
    private storage: MempoolStorage,
    private targetUrl: string
  ) {}

  // Get current mempool state
  async getState(): Promise<MempoolState> {
    return {
      minGasPrice: await this.storage.getMinGasPrice(),
      autoForward: await this.storage.isAutoForward(),
    };
  }

  // Process incoming eth_sendRawTransaction
  async processTransaction(
    rawTx: string,
    requestId: number | string | null
  ): Promise<JsonRpcResponse> {
    // Decode the transaction
    let decoded: DecodedTransaction;
    try {
      decoded = await decodeRawTransaction(rawTx);
    } catch (error) {
      return createJsonRpcError(
        requestId,
        -32000,
        `Failed to decode transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Validate transaction basics
    const validation = validateTransaction(decoded);
    if (!validation.valid) {
      return createJsonRpcError(requestId, -32000, validation.error!);
    }

    // Get current state
    const state = await this.getState();

    // Apply filters
    const filterResult = await applyFilters(decoded, {
      storage: this.storage,
      minGasPrice: state.minGasPrice,
    });

    if (!filterResult.accepted) {
      return createJsonRpcError(requestId, -32000, filterResult.reason!);
    }

    // Store in local mempool
    await this.storage.addTransaction({
      hash: decoded.hash,
      rawTx,
      from: decoded.from,
      to: decoded.to,
      nonce: decoded.nonce,
      gasPrice: decoded.gasPrice,
      maxFeePerGas: decoded.maxFeePerGas,
      maxPriorityFee: decoded.maxPriorityFee,
      gasLimit: decoded.gasLimit,
      value: decoded.value,
      data: decoded.data,
      chainId: decoded.chainId,
      txType: decoded.txType,
    });

    // If auto-forward enabled, forward to node
    if (state.autoForward && filterResult.action === 'accept') {
      return this.forwardTransaction(decoded.hash, rawTx, requestId);
    }

    // Transaction accepted into local mempool but not forwarded yet
    return createJsonRpcResult(requestId, decoded.hash);
  }

  // Forward a specific transaction to the node
  async forwardTransaction(
    hash: string,
    rawTx?: string,
    requestId?: number | string | null
  ): Promise<JsonRpcResponse> {
    // Get transaction if not provided
    if (!rawTx) {
      const tx = await this.storage.getTransaction(hash);
      if (!tx) {
        return createJsonRpcError(
          requestId ?? null,
          -32000,
          `Transaction ${hash} not found in mempool`
        );
      }
      rawTx = tx.rawTx;
    }

    // Forward to node
    const response = await forwardRpcRequest(
      {
        jsonrpc: '2.0',
        id: requestId ?? 1,
        method: 'eth_sendRawTransaction',
        params: [rawTx],
      },
      { targetUrl: this.targetUrl }
    );

    // Update status if successful
    if (!response.error) {
      await this.storage.updateStatus(hash, 'forwarded');
    }

    return response;
  }

  // Force-include a pending transaction
  async forceInclude(hash: string): Promise<{ success: boolean; error?: string }> {
    const tx = await this.storage.getTransaction(hash);
    if (!tx) {
      return { success: false, error: `Transaction ${hash} not found` };
    }

    if (tx.status !== 'pending') {
      return { success: false, error: `Transaction already ${tx.status}` };
    }

    const response = await this.forwardTransaction(hash, tx.rawTx);
    if (response.error) {
      return { success: false, error: response.error.message };
    }

    return { success: true };
  }

  // Drop a pending transaction
  async dropTransaction(hash: string, reason?: string): Promise<boolean> {
    const tx = await this.storage.getTransaction(hash);
    if (!tx || tx.status !== 'pending') {
      return false;
    }

    await this.storage.updateStatus(hash, 'dropped', reason ?? 'Manually dropped');
    return true;
  }

  // Forward all pending transactions
  async flushPending(): Promise<{ forwarded: number; failed: number }> {
    const pending = await this.storage.getPendingTransactions();
    let forwarded = 0;
    let failed = 0;

    // Sort by nonce for each sender to maintain order
    const bySender = new Map<string, PendingTransaction[]>();
    for (const tx of pending) {
      const list = bySender.get(tx.from) ?? [];
      list.push(tx);
      bySender.set(tx.from, list);
    }

    for (const [, txs] of bySender) {
      // Sort by nonce
      txs.sort((a, b) => a.nonce - b.nonce);
      
      for (const tx of txs) {
        const result = await this.forceInclude(tx.hash);
        if (result.success) {
          forwarded++;
        } else {
          failed++;
        }
      }
    }

    return { forwarded, failed };
  }
}
```

### 3.4 Update RPC API with Interception

**File**: `packages/server/src/api/rpc.ts`

Modify the RPC handler to intercept specific methods:

```typescript
import { Hono } from 'hono';
import { ServerOptions } from '../types.js';
import { setup } from '../setup.js';
import { Env } from '../env.js';
import { JsonRpcRequest } from '../rpc/types.js';
import { forwardRpcRequest, createJsonRpcError } from '../rpc/proxy.js';
import { MempoolManager } from '../mempool/state.js';

// Methods that should be intercepted
const INTERCEPTED_METHODS = [
  'eth_sendRawTransaction',
  'eth_getTransactionByHash',
];

export function getRpcAPI<CustomEnv extends Env>(
  options: ServerOptions<CustomEnv>,
) {
  const app = new Hono<{ Bindings: CustomEnv }>()
    .use(setup({ serverOptions: options }))
    .post('/', async (c) => {
      const config = c.get('config');
      const targetUrl = config.env.RPC_URL;

      if (!targetUrl) {
        return c.json(
          createJsonRpcError(null, -32603, 'RPC_URL not configured'),
          500
        );
      }

      let request: JsonRpcRequest;
      try {
        request = await c.req.json();
      } catch {
        return c.json(createJsonRpcError(null, -32700, 'Parse error'), 400);
      }

      if (request.jsonrpc !== '2.0' || !request.method) {
        return c.json(
          createJsonRpcError(request?.id ?? null, -32600, 'Invalid Request'),
          400
        );
      }

      // Create mempool manager
      const mempool = new MempoolManager(config.storage, targetUrl);

      // Handle intercepted methods
      switch (request.method) {
        case 'eth_sendRawTransaction': {
          const rawTx = request.params?.[0] as string;
          if (!rawTx) {
            return c.json(
              createJsonRpcError(request.id, -32602, 'Missing transaction data'),
              400
            );
          }
          const response = await mempool.processTransaction(rawTx, request.id);
          return c.json(response);
        }

        case 'eth_getTransactionByHash': {
          const hash = request.params?.[0] as string;
          if (!hash) {
            return c.json(
              createJsonRpcError(request.id, -32602, 'Missing transaction hash'),
              400
            );
          }

          // Check local mempool first
          const localTx = await config.storage.getTransaction(hash);
          if (localTx && localTx.status === 'pending') {
            // Return a pending transaction response
            return c.json({
              jsonrpc: '2.0',
              id: request.id,
              result: {
                hash: localTx.hash,
                from: localTx.from,
                to: localTx.to,
                nonce: `0x${localTx.nonce.toString(16)}`,
                gasPrice: `0x${localTx.gasPrice.toString(16)}`,
                gas: `0x${localTx.gasLimit.toString(16)}`,
                value: `0x${localTx.value.toString(16)}`,
                input: localTx.data ?? '0x',
                // Indicate pending status
                blockHash: null,
                blockNumber: null,
                transactionIndex: null,
              },
            });
          }

          // Fall through to forward to node
          break;
        }
      }

      // Forward non-intercepted methods to the target node
      const response = await forwardRpcRequest(request, { targetUrl });
      return c.json(response);
    });

  return app;
}
```

### 3.5 Handle Additional RPC Methods

Consider handling these additional methods for consistency:

```typescript
// In the switch statement, add:

case 'eth_getTransactionCount': {
  // May need to account for pending transactions in local mempool
  const [address, blockTag] = request.params as [string, string];
  
  if (blockTag === 'pending') {
    // Get on-chain count
    const response = await forwardRpcRequest(
      { ...request, params: [address, 'latest'] },
      { targetUrl }
    );
    
    if (!response.error) {
      const onChainCount = parseInt(response.result as string, 16);
      // Count local pending transactions
      const localPending = await config.storage.getTransactionsBySender(address);
      const maxLocalNonce = localPending.reduce(
        (max, tx) => Math.max(max, tx.nonce),
        onChainCount - 1
      );
      
      return c.json({
        jsonrpc: '2.0',
        id: request.id,
        result: `0x${(maxLocalNonce + 1).toString(16)}`,
      });
    }
  }
  // Fall through to forward
  break;
}
```

## Testing Checklist

- [ ] Transaction decoding works for legacy transactions
- [ ] Transaction decoding works for EIP-1559 transactions
- [ ] Transaction decoding works for EIP-2930 transactions
- [ ] Sender address is correctly recovered from signature
- [ ] Gas price filtering rejects low-gas transactions
- [ ] Auto-forward disabled holds transactions in local mempool
- [ ] Replacement transaction detection works
- [ ] Replacement requires 10% higher gas price
- [ ] Transaction stored in database after interception
- [ ] `eth_getTransactionByHash` returns local pending tx
- [ ] Forward all pending works correctly
- [ ] Force include works correctly

## Test Script

```bash
# Start anvil
anvil --port 8545

# Start proxy
cd platforms/nodejs && pnpm dev

# Send transaction through proxy
cast send 0x... --value 1ether --rpc-url http://localhost:3000/rpc

# Check it's in local mempool (should return pending)
curl http://localhost:3000/api/mempool/pending

# Check transaction by hash
cast tx <hash> --rpc-url http://localhost:3000/rpc
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/server/src/mempool/decoder.ts` | Create |
| `packages/server/src/mempool/filters.ts` | Create |
| `packages/server/src/mempool/state.ts` | Create |
| `packages/server/src/api/rpc.ts` | Modify |

## Success Criteria

1. All transaction types can be decoded correctly
2. Sender address recovered accurately from signature
3. Filtering rules applied correctly (gas price, auto-forward)
4. Replacement transactions handled properly
5. Transactions stored in database upon interception
6. Local pending transactions returned by `eth_getTransactionByHash`
7. Integration with existing proxy infrastructure

## Next Phase

With transaction interception working, proceed to [Plan 4: Management API](./04-management-api.md) to build the HTTP endpoints for controlling the mempool.
