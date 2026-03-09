import {describe, it, expect, beforeAll, beforeEach} from 'vitest';
import {createServer} from '../../src/index.js';
import {createTestDatabase} from '../utils/db.js';
import {setupTestEnvironment, TEST_RECIPIENT} from '../setup.js';
import {MempoolStorage} from '../../src/storage/mempool.js';
import {createSignedTransaction} from '../utils/tx.js';
import {parseGwei, parseEther, type Address, type Hash} from 'viem';
import type {RemoteSQL} from 'remote-sql';
import type {Env} from '../../src/env.js';

describe('RPC API', () => {
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

	describe('pass-through methods', () => {
		it('forwards eth_chainId to upstream', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_chainId',
					params: [],
				}),
			});

			const json = await res.json();
			expect(json.result).toBe('0x7a69'); // 31337 in hex
		});

		it('forwards eth_blockNumber to upstream', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_blockNumber',
					params: [],
				}),
			});

			const json = await res.json();
			expect(json.result).toMatch(/^0x[a-f0-9]+$/);
		});

		it('forwards eth_gasPrice to upstream', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_gasPrice',
					params: [],
				}),
			});

			const json = await res.json();
			expect(json.result).toMatch(/^0x[a-f0-9]+$/);
		});
	});

	describe('eth_sendRawTransaction', () => {
		it('intercepts and stores transaction in local mempool', async () => {
			// Disable auto-forward
			await storage.setAutoForward(false);

			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 0,
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
			expect(json.result).toMatch(/^0x[a-f0-9]{64}$/);

			// Verify stored in local mempool
			const stored = await storage.getTransaction(json.result as Hash);
			expect(stored).not.toBeNull();
			expect(stored!.status).toBe('pending');
		});

		it('forwards transaction when auto-forward is enabled', async () => {
			await storage.setAutoForward(true);

			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 1000, // High nonce to avoid conflicts
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
			expect(json.result).toMatch(/^0x[a-f0-9]{64}$/);

			// Verify forwarded
			const stored = await storage.getTransaction(json.result as Hash);
			expect(stored).not.toBeNull();
			expect(stored!.status).toBe('forwarded');
		});

		it('returns error for missing transaction data', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_sendRawTransaction',
					params: [],
				}),
			});

			const json = await res.json();
			expect(json.error).toBeDefined();
			expect(json.error.code).toBe(-32602);
			expect(json.error.message).toContain('Missing transaction data');
		});

		it('returns error for invalid transaction', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_sendRawTransaction',
					params: ['0xinvalid'],
				}),
			});

			const json = await res.json();
			expect(json.error).toBeDefined();
			expect(json.error.code).toBe(-32000);
		});
	});

	describe('eth_getTransactionByHash', () => {
		it('returns pending transaction from local mempool', async () => {
			await storage.setAutoForward(false);

			// Add a transaction
			const rawTx = await createSignedTransaction({
				to: TEST_RECIPIENT as Address,
				value: parseEther('0.001'),
				nonce: 0,
				gasPrice: parseGwei('10'),
				chainId,
			});

			// Store it via RPC
			const sendRes = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_sendRawTransaction',
					params: [rawTx],
				}),
			});

			const sendJson = await sendRes.json();
			const hash = sendJson.result;

			// Query the transaction
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 2,
					method: 'eth_getTransactionByHash',
					params: [hash],
				}),
			});

			const json = await res.json();

			expect(json.result).toBeDefined();
			expect(json.result.hash).toBe(hash);
			expect(json.result.blockHash).toBeNull(); // Pending transaction
			expect(json.result.blockNumber).toBeNull();
			expect(json.result.from.toLowerCase()).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
			expect(json.result.to.toLowerCase()).toBe('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc');
		});

		it('forwards to node for non-pending transaction', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_getTransactionByHash',
					params: ['0x0000000000000000000000000000000000000000000000000000000000000000'],
				}),
			});

			const json = await res.json();
			// Node returns null for non-existent transaction
			expect(json.result).toBeNull();
		});
	});

	describe('eth_getTransactionCount', () => {
		it('returns node count when no local pending transactions', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_getTransactionCount',
					params: ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'pending'],
				}),
			});

			const json = await res.json();
			expect(json.result).toMatch(/^0x[a-f0-9]+$/);
		});

		it('accounts for local pending transactions', async () => {
			await storage.setAutoForward(false);

			// Get initial count
			const initialRes = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_getTransactionCount',
					params: ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'pending'],
				}),
			});

			const initialJson = await initialRes.json();
			const initialCount = parseInt(initialJson.result, 16);

			// Add local transactions with higher nonces
			for (const nonce of [initialCount, initialCount + 1, initialCount + 2]) {
				const rawTx = await createSignedTransaction({
					to: TEST_RECIPIENT as Address,
					value: parseEther('0.001'),
					nonce,
					gasPrice: parseGwei('10'),
					chainId,
				});

				await app.request('/rpc', {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: nonce,
						method: 'eth_sendRawTransaction',
						params: [rawTx],
					}),
				});
			}

			// Get updated count
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 100,
					method: 'eth_getTransactionCount',
					params: ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'pending'],
				}),
			});

			const json = await res.json();
			const newCount = parseInt(json.result, 16);

			// Count should account for local pending
			expect(newCount).toBe(initialCount + 3);
		});

		it('forwards non-pending block tag to node', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_getTransactionCount',
					params: ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'latest'],
				}),
			});

			const json = await res.json();
			expect(json.result).toMatch(/^0x[a-f0-9]+$/);
		});
	});

	describe('error handling', () => {
		it('returns parse error for invalid JSON', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: 'not valid json',
			});

			const json = await res.json();
			expect(json.error).toBeDefined();
			expect(json.error.code).toBe(-32700);
			expect(json.error.message).toContain('Parse error');
		});

		it('returns invalid request for missing method', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
				}),
			});

			const json = await res.json();
			expect(json.error).toBeDefined();
			expect(json.error.code).toBe(-32600);
			expect(json.error.message).toContain('Invalid Request');
		});

		it('returns invalid request for wrong jsonrpc version', async () => {
			const res = await app.request('/rpc', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '1.0',
					id: 1,
					method: 'eth_chainId',
				}),
			});

			const json = await res.json();
			expect(json.error).toBeDefined();
			expect(json.error.code).toBe(-32600);
		});
	});
});
