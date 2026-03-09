import type {Address, Hash, Hex} from 'viem';

// Transaction status in the local mempool
export type TransactionStatus = 'pending' | 'forwarded' | 'dropped' | 'replaced';

// Transaction type enum
export type TransactionType = 'legacy' | 'eip2930' | 'eip1559' | 'eip4844';

// Pending transaction record using viem-compatible types
export interface PendingTransaction {
	hash: Hash;
	rawTx: Hex;
	from: Address;
	to: Address | null;
	nonce: number;
	// Legacy/EIP-2930 transactions
	gasPrice?: bigint;
	// EIP-1559 transactions
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	gasLimit: bigint;
	value: bigint;
	data: Hex | null;
	chainId?: number;
	txType: TransactionType;
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
	gas_price: string | null;
	max_fee_per_gas: string | null;
	max_priority_fee_per_gas: string | null;
	gas_limit: string;
	value: string;
	data: string | null;
	chain_id: number | null;
	tx_type: string;
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
	from?: Address;
	minGasPrice?: bigint;
	maxGasPrice?: bigint;
	limit?: number;
	offset?: number;
}

// Helper to get effective gas price for comparison
export function getEffectiveGasPrice(tx: PendingTransaction): bigint {
	return tx.gasPrice ?? tx.maxFeePerGas ?? 0n;
}
