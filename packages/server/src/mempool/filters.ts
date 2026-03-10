import type {Hash} from 'viem';
import {DecodedTransaction, getEffectiveGasPrice} from './decoder.js';
import {MempoolStorage} from '../storage/mempool.js';

export interface FilterResult {
	accepted: boolean;
	reason?: string;
	action: 'accept' | 'reject' | 'hold';
}

export interface FilterContext {
	storage: MempoolStorage;
	minGasPrice: bigint;
	replacementEnabled: boolean;
	minReplacementBump: number;
}

// Main filter function that applies all rules
export async function applyFilters(
	tx: DecodedTransaction,
	context: FilterContext,
): Promise<FilterResult> {
	// Check minimum gas price
	const effectiveGasPrice = getEffectiveGasPrice(tx);
	if (effectiveGasPrice < context.minGasPrice) {
		return {
			accepted: false,
			action: 'reject',
			reason: `Gas price ${effectiveGasPrice} below minimum ${context.minGasPrice}`,
		};
	}

	// Only check replacement if enabled
	if (context.replacementEnabled) {
		const existingTxs = await context.storage.getTransactionsBySender(tx.from);
		const conflicting = existingTxs.find(
			(existing) => existing.nonce === tx.nonce,
		);

		if (conflicting) {
			// Check if new transaction has higher gas price (replacement)
			const existingPrice =
				conflicting.maxFeePerGas ?? conflicting.gasPrice ?? 0n;
			const newPrice = getEffectiveGasPrice(tx);

			// Use configurable bump percentage
			const bumpMultiplier = BigInt(100 + context.minReplacementBump);
			const minReplacementPrice = (existingPrice * bumpMultiplier) / 100n;

			if (newPrice < minReplacementPrice) {
				return {
					accepted: false,
					action: 'reject',
					reason: `Replacement requires ${context.minReplacementBump}% gas bump. Need ${minReplacementPrice}, got ${newPrice}`,
				};
			}

			// Mark the existing transaction as replaced
			await context.storage.updateStatus(
				conflicting.hash as Hash,
				'replaced',
				`Replaced by ${tx.hash}`,
			);
		}
	}
	// If replacement disabled, just accept - multiple TXs with same nonce allowed

	return {
		accepted: true,
		action: 'accept',
	};
}

// Check for nonce gaps that would prevent execution
export async function checkNonceGap(
	tx: DecodedTransaction,
	storage: MempoolStorage,
	getOnChainNonce: (address: string) => Promise<number>,
): Promise<{hasGap: boolean; expectedNonce?: number}> {
	const onChainNonce = await getOnChainNonce(tx.from);

	// Check pending transactions for this sender
	const pendingTxs = await storage.getTransactionsBySender(tx.from);

	// Build set of nonces we have
	const pendingNonces = new Set(pendingTxs.map((t) => t.nonce));
	pendingNonces.add(tx.nonce);

	// Check for gaps starting from on-chain nonce
	for (let n = onChainNonce; n < tx.nonce; n++) {
		if (!pendingNonces.has(n)) {
			return {hasGap: true, expectedNonce: n};
		}
	}

	return {hasGap: false};
}
