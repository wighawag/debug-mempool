import {describe, it, expect, beforeAll} from 'vitest';
import {
	decodeRawTransaction,
	validateTransaction,
	getEffectiveGasPrice,
} from '../../src/mempool/decoder.js';
import {createSignedTransaction, createSignedEIP2930Transaction} from '../utils/tx.js';
import {setupTestEnvironment, TEST_RECIPIENT} from '../setup.js';
import {parseGwei, parseEther, type Address, encodeFunctionData, keccak256} from 'viem';

describe('Transaction Decoder', () => {
	let chainId: number;

	beforeAll(async () => {
		const ctx = await setupTestEnvironment();
		chainId = ctx.chain.id;
	});

	describe('decodeRawTransaction', () => {
		it('decodes legacy transaction', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			expect(decoded.txType).toBe('legacy');
			expect(decoded.from.toLowerCase()).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
			expect(decoded.to?.toLowerCase()).toBe('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc');
			expect(decoded.value).toBe(parseEther('1'));
			expect(decoded.gasPrice).toBe(parseGwei('10'));
			expect(decoded.nonce).toBe(0);
			expect(decoded.hash).toMatch(/^0x[a-f0-9]{64}$/);
		});

		it('decodes EIP-1559 transaction', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				maxFeePerGas: parseGwei('20'),
				maxPriorityFeePerGas: parseGwei('2'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			expect(decoded.txType).toBe('eip1559');
			expect(decoded.maxFeePerGas).toBe(parseGwei('20'));
			expect(decoded.maxPriorityFeePerGas).toBe(parseGwei('2'));
			expect(decoded.gasPrice).toBeUndefined();
			expect(decoded.from.toLowerCase()).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
		});

		it('decodes EIP-2930 transaction', async () => {
			const rawTx = await createSignedEIP2930Transaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.5'),
				nonce: 0,
				gasPrice: parseGwei('15'),
				chainId,
				accessList: [
					{
						address: TEST_RECIPIENT as Address,
						storageKeys: ['0x0000000000000000000000000000000000000000000000000000000000000001'],
					},
				],
			});

			const decoded = await decodeRawTransaction(rawTx);

			expect(decoded.txType).toBe('eip2930');
			expect(decoded.gasPrice).toBe(parseGwei('15'));
			expect(decoded.value).toBe(parseEther('0.5'));
		});

		it('decodes contract creation transaction (no to address)', async () => {
			// Simple contract bytecode (stores 42)
			const bytecode =
				'0x6080604052602a60005534801561001557600080fd5b50' as `0x${string}`;

			const rawTx = await createSignedTransaction({
				to: undefined,
				value: 0n,
				nonce: 0,
				gasPrice: parseGwei('10'),
				gasLimit: 100000n,
				data: bytecode,
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			expect(decoded.to).toBeNull();
			expect(decoded.data).toBe(bytecode);
		});

		it('preserves transaction hash correctly', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 5,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			// Hash should match keccak256 of the raw transaction
			expect(decoded.hash).toBe(keccak256(rawTx));
		});
	});

	describe('validateTransaction', () => {
		it('validates a valid transaction', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);
			const result = validateTransaction(decoded);

			expect(result.valid).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it('validates a valid EIP-1559 transaction', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				maxFeePerGas: parseGwei('20'),
				maxPriorityFeePerGas: parseGwei('2'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);
			const result = validateTransaction(decoded);

			expect(result.valid).toBe(true);
		});

		it('rejects transaction with zero gas limit', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('10'),
				gasLimit: 0n,
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);
			const result = validateTransaction(decoded);

			expect(result.valid).toBe(false);
			expect(result.error).toContain('gas limit');
		});

		// Note: It's hard to create truly invalid transactions with viem's signing,
		// as it validates the transaction before signing. These edge cases would
		// require manually crafted invalid transactions.
	});

	describe('getEffectiveGasPrice', () => {
		it('returns gasPrice for legacy transaction', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);
			const effectivePrice = getEffectiveGasPrice(decoded);

			expect(effectivePrice).toBe(parseGwei('10'));
		});

		it('returns maxFeePerGas for EIP-1559 transaction', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				maxFeePerGas: parseGwei('20'),
				maxPriorityFeePerGas: parseGwei('2'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);
			const effectivePrice = getEffectiveGasPrice(decoded);

			expect(effectivePrice).toBe(parseGwei('20'));
		});

		it('returns gasPrice for EIP-2930 transaction', async () => {
			const rawTx = await createSignedEIP2930Transaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('15'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);
			const effectivePrice = getEffectiveGasPrice(decoded);

			expect(effectivePrice).toBe(parseGwei('15'));
		});
	});
});
