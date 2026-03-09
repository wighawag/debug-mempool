import {describe, it, expect, beforeAll, beforeEach} from 'vitest';
import {applyFilters, checkNonceGap, FilterContext} from '../../src/mempool/filters.js';
import {decodeRawTransaction} from '../../src/mempool/decoder.js';
import {MempoolStorage} from '../../src/storage/mempool.js';
import {createTestDatabase} from '../utils/db.js';
import {createSignedTransaction} from '../utils/tx.js';
import {setupTestEnvironment, TEST_RECIPIENT, TEST_ADDRESS} from '../setup.js';
import {parseGwei, parseEther, type Address, type Hash} from 'viem';

describe('Transaction Filters', () => {
	let chainId: number;
	let storage: MempoolStorage;

	beforeAll(async () => {
		const ctx = await setupTestEnvironment();
		chainId = ctx.chain.id;
	});

	beforeEach(async () => {
		const db = await createTestDatabase();
		storage = new MempoolStorage(db);
	});

	describe('applyFilters', () => {
		it('accepts transaction above minimum gas price', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			const context: FilterContext = {
				storage,
				minGasPrice: parseGwei('5'),
			};

			const result = await applyFilters(decoded, context);

			expect(result.accepted).toBe(true);
			expect(result.action).toBe('accept');
		});

		it('rejects transaction below minimum gas price', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('1'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			const context: FilterContext = {
				storage,
				minGasPrice: parseGwei('10'),
			};

			const result = await applyFilters(decoded, context);

			expect(result.accepted).toBe(false);
			expect(result.action).toBe('reject');
			expect(result.reason).toContain('below minimum');
		});

		it('accepts EIP-1559 transaction with sufficient maxFeePerGas', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				maxFeePerGas: parseGwei('20'),
				maxPriorityFeePerGas: parseGwei('2'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			const context: FilterContext = {
				storage,
				minGasPrice: parseGwei('10'),
			};

			const result = await applyFilters(decoded, context);

			expect(result.accepted).toBe(true);
		});

		it('accepts replacement transaction with 10% higher gas', async () => {
			// First, add an existing transaction
			const existingRawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const existingDecoded = await decodeRawTransaction(existingRawTx);

			// Store the existing transaction
			await storage.addTransaction({
				hash: existingDecoded.hash,
				rawTx: existingRawTx,
				from: existingDecoded.from,
				to: existingDecoded.to,
				nonce: existingDecoded.nonce,
				gasPrice: existingDecoded.gasPrice,
				gasLimit: existingDecoded.gasLimit,
				value: existingDecoded.value,
				data: existingDecoded.data,
				chainId: existingDecoded.chainId,
				txType: existingDecoded.txType,
			});

			// Create replacement with 20% higher gas (> 10% required)
			const replacementRawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('12'), // 20% higher
				chainId,
			});

			const replacementDecoded = await decodeRawTransaction(replacementRawTx);

			const context: FilterContext = {
				storage,
				minGasPrice: 0n,
			};

			const result = await applyFilters(replacementDecoded, context);

			expect(result.accepted).toBe(true);
			expect(result.action).toBe('accept');

			// The old transaction should be marked as replaced
			const oldTx = await storage.getTransaction(existingDecoded.hash as Hash);
			expect(oldTx?.status).toBe('replaced');
		});

		it('rejects replacement transaction with insufficient gas bump', async () => {
			// First, add an existing transaction
			const existingRawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const existingDecoded = await decodeRawTransaction(existingRawTx);

			// Store the existing transaction
			await storage.addTransaction({
				hash: existingDecoded.hash,
				rawTx: existingRawTx,
				from: existingDecoded.from,
				to: existingDecoded.to,
				nonce: existingDecoded.nonce,
				gasPrice: existingDecoded.gasPrice,
				gasLimit: existingDecoded.gasLimit,
				value: existingDecoded.value,
				data: existingDecoded.data,
				chainId: existingDecoded.chainId,
				txType: existingDecoded.txType,
			});

			// Create replacement with only 5% higher gas (< 10% required)
			const replacementRawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1.5'), // Different value to get different hash
				nonce: 0,
				gasPrice: parseGwei('10.5'), // Only 5% higher
				chainId,
			});

			const replacementDecoded = await decodeRawTransaction(replacementRawTx);

			const context: FilterContext = {
				storage,
				minGasPrice: 0n,
			};

			const result = await applyFilters(replacementDecoded, context);

			expect(result.accepted).toBe(false);
			expect(result.action).toBe('reject');
			expect(result.reason).toContain('Replacement transaction gas price too low');
		});

		it('accepts transaction when no min gas price is set', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 0,
				gasPrice: parseGwei('1'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			const context: FilterContext = {
				storage,
				minGasPrice: 0n,
			};

			const result = await applyFilters(decoded, context);

			expect(result.accepted).toBe(true);
		});
	});

	describe('checkNonceGap', () => {
		it('detects nonce gap when there are missing nonces', async () => {
			// Create a transaction with nonce 5 when on-chain is 3
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 5,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			// Mock on-chain nonce retrieval
			const getOnChainNonce = async (_address: string) => 3;

			const result = await checkNonceGap(decoded, storage, getOnChainNonce);

			expect(result.hasGap).toBe(true);
			expect(result.expectedNonce).toBe(3); // First missing nonce
		});

		it('no gap when nonces are sequential in pending', async () => {
			// Add pending transactions with nonces 3 and 4
			for (const nonce of [3, 4]) {
				const rawTx = await createSignedTransaction({
					to: TEST_RECIPIENT as Address,
					value: parseEther('0.1'),
					nonce,
					gasPrice: parseGwei('10'),
					chainId,
				});
				const decoded = await decodeRawTransaction(rawTx);
				await storage.addTransaction({
					hash: decoded.hash,
					rawTx,
					from: decoded.from,
					to: decoded.to,
					nonce: decoded.nonce,
					gasPrice: decoded.gasPrice,
					gasLimit: decoded.gasLimit,
					value: decoded.value,
					data: decoded.data,
					chainId: decoded.chainId,
					txType: decoded.txType,
				});
			}

			// Check transaction with nonce 5
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 5,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			// On-chain nonce is 3
			const getOnChainNonce = async (_address: string) => 3;

			const result = await checkNonceGap(decoded, storage, getOnChainNonce);

			expect(result.hasGap).toBe(false);
		});

		it('no gap when transaction is the next expected nonce', async () => {
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('1'),
				nonce: 5,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const decoded = await decodeRawTransaction(rawTx);

			// On-chain nonce matches the transaction nonce
			const getOnChainNonce = async (_address: string) => 5;

			const result = await checkNonceGap(decoded, storage, getOnChainNonce);

			expect(result.hasGap).toBe(false);
		});
	});
});
