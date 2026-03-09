import {
	parseTransaction,
	type TransactionSerializableLegacy,
	type TransactionSerializableEIP2930,
	type TransactionSerialized,
	keccak256,
	recoverTransactionAddress,
	type Hex,
	type Hash,
	type Address,
} from 'viem';
import type {TransactionType} from './types.js';

export interface DecodedTransaction {
	hash: Hash;
	from: Address;
	to: Address | null;
	nonce: number;
	gasPrice?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	gasLimit: bigint;
	value: bigint;
	data: Hex | null;
	chainId?: number;
	txType: TransactionType;
}

export async function decodeRawTransaction(rawTx: string): Promise<DecodedTransaction> {
	const hexTx = rawTx as TransactionSerialized;

	// Parse the transaction
	const parsed = parseTransaction(hexTx);

	// Calculate transaction hash
	const hash = keccak256(hexTx);

	// Recover sender address from signature
	const from = await recoverTransactionAddress({
		serializedTransaction: hexTx,
	});

	// Determine transaction type and extract gas fields
	let gasPrice: bigint | undefined;
	let maxFeePerGas: bigint | undefined;
	let maxPriorityFeePerGas: bigint | undefined;
	let txType: TransactionType;

	if ('maxFeePerGas' in parsed && parsed.maxFeePerGas !== undefined) {
		// EIP-1559 transaction
		txType = 'eip1559';
		maxFeePerGas = parsed.maxFeePerGas;
		maxPriorityFeePerGas = parsed.maxPriorityFeePerGas;
	} else if ('accessList' in parsed && parsed.accessList !== undefined) {
		// EIP-2930 transaction
		txType = 'eip2930';
		gasPrice = (parsed as TransactionSerializableEIP2930).gasPrice ?? 0n;
	} else {
		// Legacy transaction
		txType = 'legacy';
		gasPrice = (parsed as TransactionSerializableLegacy).gasPrice ?? 0n;
	}

	return {
		hash,
		from: from.toLowerCase() as Address,
		to: parsed.to ? (parsed.to.toLowerCase() as Address) : null,
		nonce: Number(parsed.nonce),
		gasPrice,
		maxFeePerGas,
		maxPriorityFeePerGas,
		gasLimit: parsed.gas ?? 0n,
		value: parsed.value ?? 0n,
		data: (parsed.data as Hex) ?? null,
		chainId: parsed.chainId,
		txType,
	};
}

// Validate transaction basics
export function validateTransaction(tx: DecodedTransaction): {valid: boolean; error?: string} {
	if (!tx.from) {
		return {valid: false, error: 'Invalid signature: cannot recover sender'};
	}

	if (tx.nonce < 0) {
		return {valid: false, error: 'Invalid nonce'};
	}

	if (tx.gasLimit <= 0n) {
		return {valid: false, error: 'Invalid gas limit'};
	}

	const effectiveGasPrice = tx.maxFeePerGas ?? tx.gasPrice ?? 0n;
	if (effectiveGasPrice < 0n) {
		return {valid: false, error: 'Invalid gas price'};
	}

	return {valid: true};
}

// Get effective gas price for comparison
export function getEffectiveGasPrice(tx: DecodedTransaction): bigint {
	return tx.maxFeePerGas ?? tx.gasPrice ?? 0n;
}
