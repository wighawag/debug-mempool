import {describe, it, expect, beforeAll, beforeEach} from 'vitest';
import {createServer} from '../../src/index.js';
import {createTestDatabase} from '../utils/db.js';
import {setupTestEnvironment, TEST_RECIPIENT} from '../setup.js';
import {MempoolStorage} from '../../src/storage/mempool.js';
import {createSignedTransaction} from '../utils/tx.js';
import {parseGwei, parseEther, type Address, type Hash} from 'viem';
import type {RemoteSQL} from 'remote-sql';
import type {Env} from '../../src/env.js';

describe('Mempool Management API', () => {
	let chainId: number;
	let rpcUrl: string;
	let db: RemoteSQL;
	let storage: MempoolStorage;
	let app: ReturnType<typeof createServer>;

	beforeAll(async () => {
		const ctx = await setupTestEnvironment();
		chainId = ctx.chain.id;
		rpcUrl = ctx.rpcUrl;
	});

	beforeEach(async () => {
		db = await createTestDatabase();
		storage = new MempoolStorage(db);

		app = createServer({
			getDB: () => db,
			getEnv: () => ({RPC_URL: rpcUrl} as Env),
		});
	});

	// Helper to add a pending transaction
	async function addPendingTransaction(nonce: number): Promise<Hash> {
		await storage.setAutoForward(false);

		const rawTx = await createSignedTransaction({
			to: TEST_RECIPIENT as Address,
			value: parseEther('0.001'),
			nonce,
			gasPrice: parseGwei('10'),
			chainId,
		});

		const res = await app.request('/rpc', {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'eth_sendRawTransaction',
				params: [rawTx],
			}),
		});

		const json = await res.json();
		return json.result as Hash;
	}

	describe('GET /api/mempool/state', () => {
		it('returns current mempool state', async () => {
			await storage.setMinGasPrice(parseGwei('5'));
			await storage.setAutoForward(false);

			const res = await app.request('/api/mempool/state', {
				method: 'GET',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.minGasPrice).toBe(`0x${parseGwei('5').toString(16)}`);
			expect(json.data.autoForward).toBe(false);
		});
	});

	describe('POST /api/mempool/gas-price', () => {
		it('sets minimum gas price', async () => {
			const res = await app.request('/api/mempool/gas-price', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({minGasPrice: '10000000000'}),
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.minGasPrice).toBe('0x2540be400'); // 10 gwei in hex

			// Verify stored
			const stored = await storage.getMinGasPrice();
			expect(stored).toBe(10000000000n);
		});

		it('accepts hex gas price', async () => {
			const res = await app.request('/api/mempool/gas-price', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({minGasPrice: '0x2540be400'}), // 10 gwei
			});

			const json = await res.json();
			expect(json.success).toBe(true);
		});

		it('returns 400 for invalid gas price', async () => {
			const res = await app.request('/api/mempool/gas-price', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({minGasPrice: 'invalid'}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.success).toBe(false);
			expect(json.error).toContain('Invalid gas price');
		});
	});

	describe('POST /api/mempool/auto-forward', () => {
		it('sets auto-forward mode', async () => {
			const res = await app.request('/api/mempool/auto-forward', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({enabled: false}),
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.autoForward).toBe(false);

			// Verify stored
			const stored = await storage.isAutoForward();
			expect(stored).toBe(false);
		});
	});

	describe('GET /api/mempool/stats', () => {
		it('returns mempool statistics', async () => {
			// Add some transactions
			const hash1 = await addPendingTransaction(0);
			const hash2 = await addPendingTransaction(1);
			await storage.updateStatus(hash1, 'forwarded');

			const res = await app.request('/api/mempool/stats', {
				method: 'GET',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.totalPending).toBe(1);
			expect(json.data.totalForwarded).toBe(1);
		});
	});

	describe('GET /api/mempool/pending', () => {
		it('returns all pending transactions', async () => {
			await addPendingTransaction(0);
			await addPendingTransaction(1);

			const res = await app.request('/api/mempool/pending', {
				method: 'GET',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.length).toBe(2);
		});

		it('filters by sender', async () => {
			await addPendingTransaction(0);
			await addPendingTransaction(1);

			const res = await app.request(
				'/api/mempool/pending?from=0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
				{method: 'GET'}
			);

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.length).toBe(2);
		});

		it('supports pagination', async () => {
			for (let i = 0; i < 5; i++) {
				await addPendingTransaction(i);
			}

			const res = await app.request('/api/mempool/pending?limit=2&offset=2', {
				method: 'GET',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.length).toBe(2);
		});
	});

	describe('GET /api/mempool/history', () => {
		it('returns all transactions regardless of status', async () => {
			const hash1 = await addPendingTransaction(0);
			const hash2 = await addPendingTransaction(1);
			await storage.updateStatus(hash1, 'forwarded');
			await storage.updateStatus(hash2, 'dropped');

			const res = await app.request('/api/mempool/history', {
				method: 'GET',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			// History includes all transactions regardless of status
			expect(json.data.length).toBe(2);
			// Verify we have different statuses
			const statuses = json.data.map((tx: any) => tx.status);
			expect(statuses).toContain('forwarded');
			expect(statuses).toContain('dropped');
		});

		it('filters by status', async () => {
			const hash1 = await addPendingTransaction(0);
			await addPendingTransaction(1);
			await storage.updateStatus(hash1, 'forwarded');

			const res = await app.request('/api/mempool/history?status=forwarded', {
				method: 'GET',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.every((tx: any) => tx.status === 'forwarded')).toBe(true);
		});
	});

	describe('GET /api/mempool/tx/:hash', () => {
		it('returns transaction details', async () => {
			const hash = await addPendingTransaction(0);

			const res = await app.request(`/api/mempool/tx/${hash}`, {
				method: 'GET',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.hash).toBe(hash);
			expect(json.data.status).toBe('pending');
		});

		it('returns 404 for non-existent transaction', async () => {
			const res = await app.request(
				'/api/mempool/tx/0x0000000000000000000000000000000000000000000000000000000000000000',
				{method: 'GET'}
			);

			expect(res.status).toBe(404);
			const json = await res.json();
			expect(json.success).toBe(false);
			expect(json.error).toContain('not found');
		});
	});

	describe('GET /api/mempool/sender/:address', () => {
		it('returns transactions by sender', async () => {
			await addPendingTransaction(0);
			await addPendingTransaction(1);

			const res = await app.request(
				'/api/mempool/sender/0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
				{method: 'GET'}
			);

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.length).toBe(2);
		});
	});

	describe('POST /api/mempool/include/:hash', () => {
		it('forwards a pending transaction', async () => {
			const hash = await addPendingTransaction(1000); // High nonce to avoid conflicts

			const res = await app.request(`/api/mempool/include/${hash}`, {
				method: 'POST',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.status).toBe('forwarded');

			// Verify status
			const tx = await storage.getTransaction(hash);
			expect(tx!.status).toBe('forwarded');
		});

		it('returns 400 for non-existent transaction', async () => {
			const res = await app.request(
				'/api/mempool/include/0x0000000000000000000000000000000000000000000000000000000000000000',
				{method: 'POST'}
			);

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.success).toBe(false);
		});
	});

	describe('POST /api/mempool/drop/:hash', () => {
		it('drops a pending transaction', async () => {
			const hash = await addPendingTransaction(0);

			const res = await app.request(`/api/mempool/drop/${hash}`, {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({reason: 'Test drop'}),
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.status).toBe('dropped');

			// Verify status
			const tx = await storage.getTransaction(hash);
			expect(tx!.status).toBe('dropped');
			expect(tx!.dropReason).toBe('Test drop');
		});

		it('returns 404 for non-existent transaction', async () => {
			const res = await app.request(
				'/api/mempool/drop/0x0000000000000000000000000000000000000000000000000000000000000000',
				{method: 'POST'}
			);

			expect(res.status).toBe(404);
		});

		it('returns 400 for non-pending transaction', async () => {
			const hash = await addPendingTransaction(0);
			await storage.updateStatus(hash, 'forwarded');

			const res = await app.request(`/api/mempool/drop/${hash}`, {
				method: 'POST',
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error).toContain('not pending');
		});
	});

	describe('POST /api/mempool/include-batch', () => {
		it('forwards multiple transactions', async () => {
			const hash1 = await addPendingTransaction(2000);
			const hash2 = await addPendingTransaction(2001);

			const res = await app.request('/api/mempool/include-batch', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({hashes: [hash1, hash2]}),
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.forwarded).toBe(2);
			expect(json.data.failed).toBe(0);
		});
	});

	describe('POST /api/mempool/drop-batch', () => {
		it('drops multiple transactions', async () => {
			const hash1 = await addPendingTransaction(0);
			const hash2 = await addPendingTransaction(1);

			const res = await app.request('/api/mempool/drop-batch', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					hashes: [hash1, hash2],
					reason: 'Batch drop',
				}),
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.dropped).toBe(2);
		});
	});

	describe('POST /api/mempool/flush', () => {
		it('forwards all pending transactions', async () => {
			await addPendingTransaction(3000);
			await addPendingTransaction(3001);
			await addPendingTransaction(3002);

			const res = await app.request('/api/mempool/flush', {
				method: 'POST',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.forwarded).toBe(3);

			// Verify all forwarded
			const pending = await storage.getPendingTransactions();
			expect(pending.length).toBe(0);
		});
	});

	describe('DELETE /api/mempool/clear', () => {
		it('clears all pending transactions', async () => {
			const hash1 = await addPendingTransaction(0);
			const hash2 = await addPendingTransaction(1);

			// Forward one to verify it's preserved
			await storage.updateStatus(hash1, 'forwarded');

			const res = await app.request('/api/mempool/clear', {
				method: 'DELETE',
			});

			const json = await res.json();

			expect(json.success).toBe(true);
			expect(json.data.cleared).toBe(1); // Only 1 was pending

			// Verify cleared
			const pending = await storage.getPendingTransactions();
			expect(pending.length).toBe(0);

			// Forwarded transaction should still exist
			const forwarded = await storage.getTransaction(hash1);
			expect(forwarded).not.toBeNull();
		});
	});
});
