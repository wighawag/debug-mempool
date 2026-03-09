import {type Address, type Hex, parseGwei} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {TEST_PRIVATE_KEY} from '../setup.js';

export interface TransactionParams {
	to?: Address;
	value?: bigint;
	nonce: number;
	gasPrice?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	gasLimit?: bigint;
	data?: Hex;
	chainId: number;
	privateKey?: Hex;
}

/**
 * Create a signed raw transaction for testing.
 * Supports both legacy and EIP-1559 transactions.
 */
export async function createSignedTransaction(params: TransactionParams): Promise<Hex> {
	const privateKey = params.privateKey ?? TEST_PRIVATE_KEY;
	const account = privateKeyToAccount(privateKey);

	// Sign based on transaction type
	if (params.maxFeePerGas) {
		// EIP-1559 transaction
		return account.signTransaction({
			type: 'eip1559',
			to: params.to,
			value: params.value ?? 0n,
			nonce: params.nonce,
			maxFeePerGas: params.maxFeePerGas,
			maxPriorityFeePerGas: params.maxPriorityFeePerGas ?? parseGwei('1'),
			gas: params.gasLimit ?? 21000n,
			data: params.data,
			chainId: params.chainId,
		});
	} else {
		// Legacy transaction
		return account.signTransaction({
			type: 'legacy',
			to: params.to,
			value: params.value ?? 0n,
			nonce: params.nonce,
			gasPrice: params.gasPrice ?? parseGwei('1'),
			gas: params.gasLimit ?? 21000n,
			data: params.data,
			chainId: params.chainId,
		});
	}
}

/**
 * Create a signed EIP-2930 transaction with access list.
 */
export async function createSignedEIP2930Transaction(params: {
	to?: Address;
	value?: bigint;
	nonce: number;
	gasPrice?: bigint;
	gasLimit?: bigint;
	data?: Hex;
	chainId: number;
	accessList?: {address: Address; storageKeys: Hex[]}[];
	privateKey?: Hex;
}): Promise<Hex> {
	const privateKey = params.privateKey ?? TEST_PRIVATE_KEY;
	const account = privateKeyToAccount(privateKey);

	return account.signTransaction({
		type: 'eip2930',
		to: params.to,
		value: params.value ?? 0n,
		nonce: params.nonce,
		gasPrice: params.gasPrice ?? parseGwei('1'),
		gas: params.gasLimit ?? 21000n,
		data: params.data,
		chainId: params.chainId,
		accessList: params.accessList ?? [],
	});
}
