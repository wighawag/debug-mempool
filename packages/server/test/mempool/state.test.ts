import {describe, it, expect, beforeAll, beforeEach} from 'vitest';
import {MempoolManager} from '../../src/mempool/state.js';
import {MempoolStorage} from '../../src/storage/mempool.js';
import {createTestDatabase} from '../utils/db.js';
import {createSignedTransaction} from '../utils/tx.js';
import {setupTestEnvironment, TEST_RECIPIENT} from '../setup.js';
import {parseGwei, parseEther, type Address, type Hash} from 'viem';

describe('MempoolManager', () => {
	let chainId: number;
	let storage: MempoolStorage;
	let rpcUrl: string;

	beforeAll(async () => {
		const ctx = await setupTestEnvironment();
		chainId = ctx.chain.id;
		rpcUrl = ctx.rpcUrl;
	});

	beforeEach(async () => {
		const db = await createTestDatabase();
		storage = new MempoolStorage(db);
	});

	describe('getState', () => {
		it('returns current mempool state', async () => {
			const manager = new MempoolManager(storage, rpcUrl);

			// Set some state
			await storage.setMinGasPrice(parseGwei('5'));
			await storage.setAutoForward(false);

			const state = await manager.getState();

			expect(state.minGasPrice).toBe(parseGwei('5'));
			expect(state.autoForward).toBe(false);
		});

		it('returns default state when not set', async () => {
			const manager = new MempoolManager(storage, rpcUrl);

			const state = await manager.getState();

			expect(state.minGasPrice).toBe(0n);
			expect(state.autoForward).toBe(true); // Default from schema
		});
	});

	describe('processTransaction', () => {
		it('processes valid transaction and stores in mempool (auto-forward off)', async () => {
			await storage.setAutoForward(false);
			const manager = new MempoolManager(storage, rpcUrl);

			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 0,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const response = await manager.processTransaction(rawTx, 1);

			expect(response.error).toBeUndefined();
			expect(response.result).toMatch(/^0x[a-f0-9]{64}$/);

			// Verify stored in mempool
			const stored = await storage.getTransaction(response.result as Hash);
			expect(stored).not.toBeNull();
			expect(stored!.status).toBe('pending');
		});

		it('processes and forwards transaction when auto-forward is on', async () => {
			await storage.setAutoForward(true);
			const manager = new MempoolManager(storage, rpcUrl);

			// Get current nonce
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 100, // Use high nonce that won't conflict with test setup
				gasPrice: parseGwei('10'),
				chainId,
			});

			const response = await manager.processTransaction(rawTx, 1);

			expect(response.result).toMatch(/^0x[a-f0-9]{64}$/);

			// Verify stored and forwarded
			const stored = await storage.getTransaction(response.result as Hash);
			expect(stored).not.toBeNull();
			expect(stored!.status).toBe('forwarded');
		});

		it('returns error for invalid transaction data', async () => {
			const manager = new MempoolManager(storage, rpcUrl);

			const response = await manager.processTransaction('0xinvalid', 1);

			expect(response.error).toBeDefined();
			expect(response.error?.code).toBe(-32000);
			expect(response.error?.message).toContain('Failed to decode');
		});

		it('rejects transaction below minimum gas price', async () => {
			await storage.setAutoForward(false);
			await storage.setMinGasPrice(parseGwei('100'));
			const manager = new MempoolManager(storage, rpcUrl);

			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 0,
				gasPrice: parseGwei('1'), // Below minimum
				chainId,
			});

			const response = await manager.processTransaction(rawTx, 1);

			expect(response.error).toBeDefined();
			expect(response.error?.message).toContain('below minimum');
		});
	});

	describe('forceInclude', () => {
		it('forwards a pending transaction', async () => {
			await storage.setAutoForward(false);
			const manager = new MempoolManager(storage, rpcUrl);

			// First, add a transaction
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 200, // Use high nonce to avoid conflicts
				gasPrice: parseGwei('10'),
				chainId,
			});

			const processResponse = await manager.processTransaction(rawTx, 1);
			const hash = processResponse.result as Hash;

			// Now force include it
			const result = await manager.forceInclude(hash);

			expect(result.success).toBe(true);

			// Verify status updated
			const tx = await storage.getTransaction(hash);
			expect(tx!.status).toBe('forwarded');
		});

		it('returns error for non-existent transaction', async () => {
			const manager = new MempoolManager(storage, rpcUrl);

			const result = await manager.forceInclude(
				'0x0000000000000000000000000000000000000000000000000000000000000000' as Hash
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
		});

		it('returns error for already forwarded transaction', async () => {
			await storage.setAutoForward(false);
			const manager = new MempoolManager(storage, rpcUrl);

			// Add and forward a transaction
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 201,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const processResponse = await manager.processTransaction(rawTx, 1);
			const hash = processResponse.result as Hash;

			// Forward it
			await manager.forceInclude(hash);

			// Try to forward again
			const result = await manager.forceInclude(hash);

			expect(result.success).toBe(false);
			expect(result.error).toContain('already forwarded');
		});
	});

	describe('dropTransaction', () => {
		it('drops a pending transaction', async () => {
			await storage.setAutoForward(false);
			const manager = new MempoolManager(storage, rpcUrl);

			// Add a transaction
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 300,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const processResponse = await manager.processTransaction(rawTx, 1);
			const hash = processResponse.result as Hash;

			// Drop it
			const result = await manager.dropTransaction(hash, 'Test drop');

			expect(result).toBe(true);

			// Verify status
			const tx = await storage.getTransaction(hash);
			expect(tx!.status).toBe('dropped');
			expect(tx!.dropReason).toBe('Test drop');
		});

		it('returns false for non-existent transaction', async () => {
			const manager = new MempoolManager(storage, rpcUrl);

			const result = await manager.dropTransaction(
				'0x0000000000000000000000000000000000000000000000000000000000000000' as Hash
			);

			expect(result).toBe(false);
		});

		it('returns false for already processed transaction', async () => {
			await storage.setAutoForward(false);
			const manager = new MempoolManager(storage, rpcUrl);

			// Add and forward a transaction
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 301,
				gasPrice: parseGwei('10'),
				chainId,
			});

			const processResponse = await manager.processTransaction(rawTx, 1);
			const hash = processResponse.result as Hash;

			await manager.forceInclude(hash);

			// Try to drop
			const result = await manager.dropTransaction(hash);

			expect(result).toBe(false);
		});
	});

	describe('flushPending', () => {
		it('forwards all pending transactions in nonce order', async () => {
			await storage.setAutoForward(false);
			const manager = new MempoolManager(storage, rpcUrl);

			// Add multiple transactions
			const nonces = [402, 401, 400]; // Out of order
			const hashes: Hash[] = [];

			for (const nonce of nonces) {
				const rawTx = await createSignedTransaction({
					to: TEST_RECIPIENT as Address,
					value: parseEther('0.001'),
					nonce,
					gasPrice: parseGwei('10'),
					chainId,
				});

				const response = await manager.processTransaction(rawTx, 1);
				hashes.push(response.result as Hash);
			}

			// Flush all
			const result = await manager.flushPending();

			expect(result.forwarded).toBe(3);
			expect(result.failed).toBe(0);

			// Verify all forwarded
			for (const hash of hashes) {
				const tx = await storage.getTransaction(hash);
				expect(tx!.status).toBe('forwarded');
			}
		});

		it('returns counts of forwarded and failed', async () => {
			await storage.setAutoForward(false);
			const manager = new MempoolManager(storage, rpcUrl);

			// Add one valid transaction
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 500,
				gasPrice: parseGwei('10'),
				chainId,
			});

			await manager.processTransaction(rawTx, 1);

			// Flush
			const result = await manager.flushPending();

			expect(result.forwarded + result.failed).toBe(1);
		});
	});
});
