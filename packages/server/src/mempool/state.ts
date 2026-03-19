import type {Hex, Hash, Address} from 'viem';
import {MempoolStorage} from '../storage/mempool.js';
import {
	decodeRawTransaction,
	validateTransaction,
	DecodedTransaction,
} from './decoder.js';
import {applyFilters, FilterResult} from './filters.js';
import type {PendingTransaction} from './types.js';
import {
	forwardRpcRequest,
	createJsonRpcResult,
	createJsonRpcError,
} from '../rpc/proxy.js';
import type {JsonRpcResponse} from '../rpc/types.js';
import {logs} from 'named-logs';

const logger = logs('state');

export interface MempoolState {
	minGasPrice: bigint;
	autoForward: boolean;
	replacementEnabled: boolean;
	minReplacementBump: number;
}

export class MempoolManager {
	constructor(
		private storage: MempoolStorage,
		private targetUrl: string,
	) {}

	// Get current mempool state
	async getState(): Promise<MempoolState> {
		return {
			minGasPrice: await this.storage.getMinGasPrice(),
			autoForward: await this.storage.isAutoForward(),
			replacementEnabled: await this.storage.isReplacementEnabled(),
			minReplacementBump: await this.storage.getMinReplacementBump(),
		};
	}

	// Process incoming eth_sendRawTransaction
	async processTransaction(
		rawTx: string,
		requestId: number | string | null,
	): Promise<JsonRpcResponse> {
		// Decode the transaction
		let decoded: DecodedTransaction;
		try {
			decoded = await decodeRawTransaction(rawTx);
			logger.debug(decoded);
		} catch (error) {
			return createJsonRpcError(
				requestId,
				-32000,
				`Failed to decode transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
			replacementEnabled: state.replacementEnabled,
			minReplacementBump: state.minReplacementBump,
		});

		if (!filterResult.accepted) {
			return createJsonRpcError(requestId, -32000, filterResult.reason!);
		}

		// Store in local mempool
		await this.storage.addTransaction({
			hash: decoded.hash,
			rawTx: rawTx as Hex,
			from: decoded.from,
			to: decoded.to,
			nonce: decoded.nonce,
			gasPrice: decoded.gasPrice,
			maxFeePerGas: decoded.maxFeePerGas,
			maxPriorityFeePerGas: decoded.maxPriorityFeePerGas,
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
		hash: Hash,
		rawTx?: string,
		requestId?: number | string | null,
	): Promise<JsonRpcResponse> {
		// Get transaction if not provided
			if (!rawTx) {
				const tx = await this.storage.getTransaction(hash, true); // include hidden
				if (!tx) {
					return createJsonRpcError(
						requestId ?? null,
						-32000,
						`Transaction ${hash} not found in mempool`,
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
			{targetUrl: this.targetUrl},
		);

		// Update status if successful
		if (!response.error) {
			await this.storage.updateStatus(hash, 'forwarded');
		}

		return response;
	}

	// Force-include a pending transaction (can include hidden transactions)
	async forceInclude(hash: Hash): Promise<{success: boolean; error?: string}> {
		const tx = await this.storage.getTransaction(hash, true); // include hidden
		if (!tx) {
			return {success: false, error: `Transaction ${hash} not found`};
		}

		if (tx.status !== 'pending') {
			return {success: false, error: `Transaction already ${tx.status}`};
		}

		const response = await this.forwardTransaction(hash, tx.rawTx);
		if (response.error) {
			return {success: false, error: response.error.message};
		}

		return {success: true};
	}

	// Drop a pending transaction (marks as dropped, still visible in history)
	async dropTransaction(hash: Hash, reason?: string): Promise<boolean> {
		const tx = await this.storage.getTransaction(hash, true); // include hidden
		if (!tx || tx.status !== 'pending') {
			return false;
		}

		await this.storage.updateStatus(
			hash,
			'dropped',
			reason ?? 'Manually dropped',
		);
		return true;
	}

	// Hide a pending transaction (soft delete - can be restored later)
	async hideTransaction(hash: Hash): Promise<{success: boolean; error?: string}> {
		const tx = await this.storage.getTransaction(hash, true); // include hidden
		if (!tx) {
			return {success: false, error: `Transaction ${hash} not found`};
		}

		if (tx.deletedAt) {
			return {success: false, error: `Transaction already hidden`};
		}

		await this.storage.hideTransaction(hash);
		return {success: true};
	}

	// Restore a hidden transaction
	async restoreTransaction(hash: Hash): Promise<{success: boolean; error?: string}> {
		const tx = await this.storage.getTransaction(hash, true); // include hidden
		if (!tx) {
			return {success: false, error: `Transaction ${hash} not found`};
		}

		if (!tx.deletedAt) {
			return {success: false, error: `Transaction is not hidden`};
		}

		await this.storage.restoreTransaction(hash);
		return {success: true};
	}

	// Forward all pending transactions
	async flushPending(): Promise<{forwarded: number; failed: number}> {
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
				const result = await this.forceInclude(tx.hash as Hash);
				if (result.success) {
					forwarded++;
				} else {
					failed++;
				}
			}
		}

		return {forwarded, failed};
	}
}
