import {RemoteSQL} from 'remote-sql';
import type {Address, Hash, Hex} from 'viem';
import {
	PendingTransaction,
	PendingTransactionRow,
	TransactionStatus,
	TransactionType,
	MempoolStateKey,
	MempoolStats,
	TransactionFilter,
} from '../mempool/types.js';

export class MempoolStorage {
	constructor(private db: RemoteSQL) {}

	// Convert database row to domain object
	private rowToTransaction(row: PendingTransactionRow): PendingTransaction {
		return {
			hash: row.hash as Hash,
			rawTx: row.raw_tx as Hex,
			from: row.from_address as Address,
			to: row.to_address as Address | null,
			nonce: row.nonce,
			gasPrice: row.gas_price ? BigInt(row.gas_price) : undefined,
			maxFeePerGas: row.max_fee_per_gas ? BigInt(row.max_fee_per_gas) : undefined,
			maxPriorityFeePerGas: row.max_priority_fee_per_gas ? BigInt(row.max_priority_fee_per_gas) : undefined,
			gasLimit: BigInt(row.gas_limit),
			value: BigInt(row.value),
			data: row.data as Hex | null,
			chainId: row.chain_id ?? undefined,
			txType: row.tx_type as TransactionType,
			status: row.status as TransactionStatus,
			createdAt: row.created_at,
			forwardedAt: row.forwarded_at ?? undefined,
			droppedAt: row.dropped_at ?? undefined,
			dropReason: row.drop_reason ?? undefined,
		};
	}

	// Add a new pending transaction
	async addTransaction(tx: Omit<PendingTransaction, 'status' | 'createdAt'>): Promise<void> {
		const stmt = this.db.prepare(
			`INSERT INTO PendingTransactions
	      (hash, raw_tx, from_address, to_address, nonce, gas_price,
	       max_fee_per_gas, max_priority_fee_per_gas, gas_limit, value, data,
	       chain_id, tx_type, status, created_at)
	      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
		);
		await stmt
			.bind(
				tx.hash,
				tx.rawTx,
				tx.from.toLowerCase(),
				tx.to?.toLowerCase() ?? null,
				tx.nonce,
				tx.gasPrice?.toString() ?? null,
				tx.maxFeePerGas?.toString() ?? null,
				tx.maxPriorityFeePerGas?.toString() ?? null,
				tx.gasLimit.toString(),
				tx.value.toString(),
				tx.data,
				tx.chainId ?? null,
				tx.txType,
				Math.floor(Date.now() / 1000)
			)
			.all();
	}

	// Get transaction by hash
	async getTransaction(hash: Hash): Promise<PendingTransaction | null> {
		const stmt = this.db.prepare('SELECT * FROM PendingTransactions WHERE hash = ?');
		const result = await stmt.bind(hash).all<PendingTransactionRow>();
		return result.results.length > 0 ? this.rowToTransaction(result.results[0]) : null;
	}

	// Get all pending transactions (defaults to pending status)
	async getPendingTransactions(filter?: TransactionFilter): Promise<PendingTransaction[]> {
		return this.queryTransactions(filter, true);
	}

	// Get transaction history (all statuses by default)
	async getTransactionHistory(filter?: TransactionFilter): Promise<PendingTransaction[]> {
		return this.queryTransactions(filter, false);
	}

	// Internal query method with optional status defaulting
	private async queryTransactions(
		filter?: TransactionFilter,
		defaultToPending: boolean = true
	): Promise<PendingTransaction[]> {
		let query = 'SELECT * FROM PendingTransactions WHERE 1=1';
		const params: unknown[] = [];

		if (filter?.status) {
			query += ' AND status = ?';
			params.push(filter.status);
		} else if (defaultToPending) {
			query += " AND status = 'pending'";
		}

		if (filter?.from) {
			query += ' AND from_address = ?';
			params.push(filter.from.toLowerCase());
		}

		if (filter?.minGasPrice !== undefined) {
			// Compare effective gas price using INTEGER (64-bit signed, safe up to ~9.2 billion Gwei)
			query += ' AND CAST(COALESCE(gas_price, max_fee_per_gas, "0") AS INTEGER) >= CAST(? AS INTEGER)';
			params.push(filter.minGasPrice.toString());
		}

		if (filter?.maxGasPrice !== undefined) {
			query += ' AND CAST(COALESCE(gas_price, max_fee_per_gas, "0") AS INTEGER) <= CAST(? AS INTEGER)';
			params.push(filter.maxGasPrice.toString());
		}

		query += ' ORDER BY created_at ASC';

		if (filter?.limit) {
			query += ' LIMIT ?';
			params.push(filter.limit);
		} else if (filter?.offset) {
			// OFFSET requires LIMIT in SQLite; -1 means unlimited
			query += ' LIMIT -1';
		}

		if (filter?.offset) {
			query += ' OFFSET ?';
			params.push(filter.offset);
		}

		const stmt = this.db.prepare(query);
		const result = await stmt.bind(...params).all<PendingTransactionRow>();
		return result.results.map((row) => this.rowToTransaction(row));
	}

	// Get transactions by sender address
	async getTransactionsBySender(address: Address): Promise<PendingTransaction[]> {
		const stmt = this.db.prepare(
			"SELECT * FROM PendingTransactions WHERE from_address = ? AND status = 'pending' ORDER BY nonce ASC"
		);
		const result = await stmt.bind(address.toLowerCase()).all<PendingTransactionRow>();
		return result.results.map((row) => this.rowToTransaction(row));
	}

	// Update transaction status
	async updateStatus(hash: Hash, status: TransactionStatus, reason?: string): Promise<void> {
		const now = Math.floor(Date.now() / 1000);

		if (status === 'forwarded') {
			const stmt = this.db.prepare(
				'UPDATE PendingTransactions SET status = ?, forwarded_at = ? WHERE hash = ?'
			);
			await stmt.bind(status, now, hash).all();
		} else if (status === 'dropped' || status === 'replaced') {
			const stmt = this.db.prepare(
				'UPDATE PendingTransactions SET status = ?, dropped_at = ?, drop_reason = ? WHERE hash = ?'
			);
			await stmt.bind(status, now, reason ?? null, hash).all();
		} else {
			const stmt = this.db.prepare('UPDATE PendingTransactions SET status = ? WHERE hash = ?');
			await stmt.bind(status, hash).all();
		}
	}

	// Remove transaction from mempool
	async removeTransaction(hash: Hash): Promise<void> {
		const stmt = this.db.prepare('DELETE FROM PendingTransactions WHERE hash = ?');
		await stmt.bind(hash).all();
	}

	// Clear all pending transactions
	async clearPending(): Promise<void> {
		const stmt = this.db.prepare("DELETE FROM PendingTransactions WHERE status = 'pending'");
		await stmt.bind().all();
	}

	// Get mempool statistics
	async getStats(): Promise<MempoolStats> {
		const statsStmt = this.db.prepare(
			'SELECT status, COUNT(*) as count FROM PendingTransactions GROUP BY status'
		);
		const statsResult = await statsStmt.bind().all<{status: string; count: number}>();

		const oldestStmt = this.db.prepare(
			"SELECT created_at FROM PendingTransactions WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
		);
		const oldestResult = await oldestStmt.bind().all<{created_at: number}>();

		const sendersStmt = this.db.prepare(
			"SELECT COUNT(DISTINCT from_address) as count FROM PendingTransactions WHERE status = 'pending'"
		);
		const sendersResult = await sendersStmt.bind().all<{count: number}>();

		const statsMap: Record<string, number> = {};
		for (const row of statsResult.results) {
			statsMap[row.status] = row.count;
		}

		return {
			totalPending: statsMap['pending'] ?? 0,
			totalForwarded: statsMap['forwarded'] ?? 0,
			totalDropped: (statsMap['dropped'] ?? 0) + (statsMap['replaced'] ?? 0),
			oldestPending: oldestResult.results[0]?.created_at,
			uniqueSenders: sendersResult.results[0]?.count ?? 0,
		};
	}

	// State management
	async getState(key: MempoolStateKey): Promise<string | null> {
		const stmt = this.db.prepare('SELECT value FROM MempoolState WHERE key = ?');
		const result = await stmt.bind(key).all<{value: string}>();
		return result.results[0]?.value ?? null;
	}

	async setState(key: MempoolStateKey, value: string): Promise<void> {
		const stmt = this.db.prepare(
			'INSERT OR REPLACE INTO MempoolState (key, value, updated_at) VALUES (?, ?, ?)'
		);
		await stmt.bind(key, value, Math.floor(Date.now() / 1000)).all();
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
