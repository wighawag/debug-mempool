import {describe, it, expect, beforeEach} from 'vitest';
import {MempoolStorage} from '../../src/storage/mempool.js';
import {createTestDatabase} from '../utils/db.js';
import type {Hash, Address, Hex} from 'viem';
import {parseGwei} from 'viem';

describe('MempoolStorage', () => {
	let storage: MempoolStorage;

	beforeEach(async () => {
		const db = await createTestDatabase();
		storage = new MempoolStorage(db);
	});

	describe('addTransaction', () => {
		it('adds and retrieves a transaction', async () => {
			const tx = {
				hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash,
				rawTx: '0xf86c0184773594008252089470997970c51812dc3a010c7d01b50e0d17dc79c8880de0b6b3a76400008025a0abc...' as Hex,
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				nonce: 0,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			await storage.addTransaction(tx);
			const retrieved = await storage.getTransaction(tx.hash);

			expect(retrieved).not.toBeNull();
			expect(retrieved!.hash).toBe(tx.hash);
			expect(retrieved!.from).toBe(tx.from);
			expect(retrieved!.to).toBe(tx.to);
			expect(retrieved!.nonce).toBe(tx.nonce);
			expect(retrieved!.gasPrice).toBe(tx.gasPrice);
			expect(retrieved!.value).toBe(tx.value);
			expect(retrieved!.status).toBe('pending');
		});

		it('stores EIP-1559 transaction fields', async () => {
			const tx = {
				hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash,
				rawTx: '0x02f86c...' as Hex,
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				nonce: 1,
				maxFeePerGas: parseGwei('20'),
				maxPriorityFeePerGas: parseGwei('2'),
				gasLimit: 21000n,
				value: 500000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'eip1559' as const,
			};

			await storage.addTransaction(tx);
			const retrieved = await storage.getTransaction(tx.hash);

			expect(retrieved!.maxFeePerGas).toBe(parseGwei('20'));
			expect(retrieved!.maxPriorityFeePerGas).toBe(parseGwei('2'));
			expect(retrieved!.gasPrice).toBeUndefined();
			expect(retrieved!.txType).toBe('eip1559');
		});

		it('stores contract creation transaction (null to)', async () => {
			const tx = {
				hash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321' as Hash,
				rawTx: '0xf8...' as Hex,
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: null,
				nonce: 2,
				gasPrice: parseGwei('10'),
				gasLimit: 100000n,
				value: 0n,
				data: '0x6080604052...' as Hex,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			await storage.addTransaction(tx);
			const retrieved = await storage.getTransaction(tx.hash);

			expect(retrieved!.to).toBeNull();
			expect(retrieved!.data).toBe('0x6080604052...');
		});
	});

	describe('getTransaction', () => {
		it('returns null for non-existent transaction', async () => {
			const retrieved = await storage.getTransaction(
				'0x0000000000000000000000000000000000000000000000000000000000000000' as Hash
			);
			expect(retrieved).toBeNull();
		});
	});

	describe('getPendingTransactions', () => {
		it('returns only pending transactions', async () => {
			// Add multiple transactions with different statuses
			const baseTx = {
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			await storage.addTransaction({
				...baseTx,
				hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as Hash,
				rawTx: '0xf86c01...' as Hex,
				nonce: 0,
			});

			await storage.addTransaction({
				...baseTx,
				hash: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hash,
				rawTx: '0xf86c02...' as Hex,
				nonce: 1,
			});

			// Mark one as forwarded
			await storage.updateStatus(
				'0x1111111111111111111111111111111111111111111111111111111111111111' as Hash,
				'forwarded'
			);

			const pending = await storage.getPendingTransactions();

			expect(pending.length).toBe(1);
			expect(pending[0].hash).toBe(
				'0x2222222222222222222222222222222222222222222222222222222222222222'
			);
		});

		it('filters by from address', async () => {
			const baseTx = {
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			await storage.addTransaction({
				...baseTx,
				hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as Hash,
				rawTx: '0xf86c01...' as Hex,
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				nonce: 0,
			});

			await storage.addTransaction({
				...baseTx,
				hash: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hash,
				rawTx: '0xf86c02...' as Hex,
				from: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as Address,
				nonce: 0,
			});

			const txs = await storage.getPendingTransactions({
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
			});

			expect(txs.length).toBe(1);
			expect(txs[0].from).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
		});

		it('supports pagination with limit and offset', async () => {
			const baseTx = {
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			// Add 5 transactions
			for (let i = 0; i < 5; i++) {
				await storage.addTransaction({
					...baseTx,
					hash: `0x${(i + 1).toString().padStart(64, '0')}` as Hash,
					rawTx: `0xf86c0${i}...` as Hex,
					nonce: i,
				});
			}

			const page1 = await storage.getPendingTransactions({limit: 2, offset: 0});
			const page2 = await storage.getPendingTransactions({limit: 2, offset: 2});

			expect(page1.length).toBe(2);
			expect(page2.length).toBe(2);
			// Check they're different
			expect(page1[0].hash).not.toBe(page2[0].hash);
		});
	});

	describe('getTransactionsBySender', () => {
		it('returns transactions for a specific sender sorted by nonce', async () => {
			const baseTx = {
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			// Add transactions out of order
			await storage.addTransaction({
				...baseTx,
				hash: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hash,
				rawTx: '0xf86c02...' as Hex,
				nonce: 2,
			});

			await storage.addTransaction({
				...baseTx,
				hash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hash,
				rawTx: '0xf86c00...' as Hex,
				nonce: 0,
			});

			await storage.addTransaction({
				...baseTx,
				hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as Hash,
				rawTx: '0xf86c01...' as Hex,
				nonce: 1,
			});

			const txs = await storage.getTransactionsBySender(
				'0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address
			);

			expect(txs.length).toBe(3);
			expect(txs[0].nonce).toBe(0);
			expect(txs[1].nonce).toBe(1);
			expect(txs[2].nonce).toBe(2);
		});

		it('returns empty array for sender with no transactions', async () => {
			const txs = await storage.getTransactionsBySender(
				'0x0000000000000000000000000000000000000000' as Address
			);
			expect(txs).toEqual([]);
		});
	});

	describe('updateStatus', () => {
		it('updates status to forwarded with timestamp', async () => {
			const tx = {
				hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash,
				rawTx: '0xf86c...' as Hex,
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				nonce: 0,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			await storage.addTransaction(tx);
			await storage.updateStatus(tx.hash, 'forwarded');

			const updated = await storage.getTransaction(tx.hash);

			expect(updated!.status).toBe('forwarded');
			expect(updated!.forwardedAt).toBeDefined();
			expect(updated!.forwardedAt).toBeGreaterThan(0);
		});

		it('updates status to dropped with reason', async () => {
			const tx = {
				hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash,
				rawTx: '0xf86c...' as Hex,
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				nonce: 0,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			await storage.addTransaction(tx);
			await storage.updateStatus(tx.hash, 'dropped', 'Gas price too low');

			const updated = await storage.getTransaction(tx.hash);

			expect(updated!.status).toBe('dropped');
			expect(updated!.droppedAt).toBeDefined();
			expect(updated!.dropReason).toBe('Gas price too low');
		});

		it('updates status to replaced with reason', async () => {
			const tx = {
				hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash,
				rawTx: '0xf86c...' as Hex,
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				nonce: 0,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			await storage.addTransaction(tx);
			await storage.updateStatus(tx.hash, 'replaced', 'Replaced by 0xabcd...');

			const updated = await storage.getTransaction(tx.hash);

			expect(updated!.status).toBe('replaced');
			expect(updated!.dropReason).toBe('Replaced by 0xabcd...');
		});
	});

	describe('removeTransaction', () => {
		it('removes a transaction', async () => {
			const tx = {
				hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hash,
				rawTx: '0xf86c...' as Hex,
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				nonce: 0,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			await storage.addTransaction(tx);
			await storage.removeTransaction(tx.hash);

			const retrieved = await storage.getTransaction(tx.hash);
			expect(retrieved).toBeNull();
		});
	});

	describe('clearPending', () => {
		it('clears all pending transactions', async () => {
			const baseTx = {
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			// Add multiple pending transactions
			await storage.addTransaction({
				...baseTx,
				hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as Hash,
				rawTx: '0xf86c01...' as Hex,
				nonce: 0,
			});

			await storage.addTransaction({
				...baseTx,
				hash: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hash,
				rawTx: '0xf86c02...' as Hex,
				nonce: 1,
			});

			// Mark one as forwarded (should not be cleared)
			await storage.updateStatus(
				'0x1111111111111111111111111111111111111111111111111111111111111111' as Hash,
				'forwarded'
			);

			await storage.clearPending();

			const pending = await storage.getPendingTransactions();
			expect(pending.length).toBe(0);

			// The forwarded one should still exist
			const forwarded = await storage.getTransaction(
				'0x1111111111111111111111111111111111111111111111111111111111111111' as Hash
			);
			expect(forwarded).not.toBeNull();
			expect(forwarded!.status).toBe('forwarded');
		});
	});

	describe('getStats', () => {
		it('returns correct statistics', async () => {
			const baseTx = {
				from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address,
				to: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address,
				gasPrice: parseGwei('10'),
				gasLimit: 21000n,
				value: 1000000000000000000n,
				data: null,
				chainId: 31337,
				txType: 'legacy' as const,
			};

			// Add transactions with different statuses
			await storage.addTransaction({
				...baseTx,
				hash: '0x1111111111111111111111111111111111111111111111111111111111111111' as Hash,
				rawTx: '0xf86c01...' as Hex,
				nonce: 0,
			});

			await storage.addTransaction({
				...baseTx,
				hash: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hash,
				rawTx: '0xf86c02...' as Hex,
				nonce: 1,
			});

			await storage.addTransaction({
				...baseTx,
				hash: '0x3333333333333333333333333333333333333333333333333333333333333333' as Hash,
				rawTx: '0xf86c03...' as Hex,
				nonce: 2,
				from: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as Address,
			});

			await storage.updateStatus(
				'0x1111111111111111111111111111111111111111111111111111111111111111' as Hash,
				'forwarded'
			);

			await storage.updateStatus(
				'0x2222222222222222222222222222222222222222222222222222222222222222' as Hash,
				'dropped'
			);

			const stats = await storage.getStats();

			expect(stats.totalPending).toBe(1);
			expect(stats.totalForwarded).toBe(1);
			expect(stats.totalDropped).toBe(1);
			expect(stats.uniqueSenders).toBe(1); // Only one sender has pending tx
		});
	});

	describe('state management', () => {
		it('gets and sets state values', async () => {
			await storage.setState('min_gas_price', '1000000000');
			const value = await storage.getState('min_gas_price');
			expect(value).toBe('1000000000');
		});

		it('returns null for non-existent state', async () => {
			const value = await storage.getState('non_existent_key' as any);
			expect(value).toBeNull();
		});

		it('gets and sets min gas price as bigint', async () => {
			await storage.setMinGasPrice(parseGwei('50'));
			const price = await storage.getMinGasPrice();
			expect(price).toBe(parseGwei('50'));
		});

		it('returns 0 for unset min gas price', async () => {
			// Default is '0' from schema init
			const price = await storage.getMinGasPrice();
			expect(price).toBe(0n);
		});

		it('gets and sets auto forward flag', async () => {
			// Default is true
			expect(await storage.isAutoForward()).toBe(true);

			await storage.setAutoForward(false);
			expect(await storage.isAutoForward()).toBe(false);

			await storage.setAutoForward(true);
			expect(await storage.isAutoForward()).toBe(true);
		});
	});
});
