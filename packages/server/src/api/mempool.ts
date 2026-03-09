import {Hono} from 'hono';
import {ServerOptions} from '../types.js';
import {setup} from '../setup.js';
import {Env} from '../env.js';
import {MempoolManager} from '../mempool/state.js';
import {ApiResponse, TransactionInfo, MempoolStateInfo, MempoolStatsInfo} from './types.js';
import {PendingTransaction, TransactionStatus} from '../mempool/types.js';
import type {Hash} from 'viem';

// Convert domain transaction to API response format
function toTransactionInfo(tx: PendingTransaction): TransactionInfo {
	// gasPrice is optional in domain, provide fallback for API
	const effectiveGasPrice = tx.gasPrice ?? tx.maxFeePerGas ?? 0n;
	return {
		hash: tx.hash,
		from: tx.from,
		to: tx.to,
		nonce: tx.nonce,
		gasPrice: `0x${effectiveGasPrice.toString(16)}`,
		maxFeePerGas: tx.maxFeePerGas ? `0x${tx.maxFeePerGas.toString(16)}` : undefined,
		maxPriorityFee: tx.maxPriorityFeePerGas ? `0x${tx.maxPriorityFeePerGas.toString(16)}` : undefined,
		gasLimit: `0x${tx.gasLimit.toString(16)}`,
		value: `0x${tx.value.toString(16)}`,
		data: tx.data,
		status: tx.status,
		createdAt: tx.createdAt,
		forwardedAt: tx.forwardedAt,
		droppedAt: tx.droppedAt,
		dropReason: tx.dropReason,
	};
}

export function getMempoolAPI<CustomEnv extends Env>(options: ServerOptions<CustomEnv>) {
	const app = new Hono<{Bindings: CustomEnv}>()
		.use(setup({serverOptions: options}))

		// === STATE MANAGEMENT ===

		// GET /api/mempool/state - Get current mempool state
		.get('/state', async (c) => {
			const config = c.get('config');
			const storage = config.storage;

			const state: MempoolStateInfo = {
				minGasPrice: `0x${(await storage.getMinGasPrice()).toString(16)}`,
				autoForward: await storage.isAutoForward(),
			};

			return c.json<ApiResponse<MempoolStateInfo>>({
				success: true,
				data: state,
			});
		})

		// POST /api/mempool/gas-price - Set minimum gas price
		.post('/gas-price', async (c) => {
			const body = await c.req.json<{minGasPrice: string}>();
			const config = c.get('config');

			let price: bigint;
			try {
				// Accept hex string or decimal string
				price = BigInt(body.minGasPrice);
			} catch {
				return c.json<ApiResponse>(
					{
						success: false,
						error: 'Invalid gas price format',
					},
					400
				);
			}

			await config.storage.setMinGasPrice(price);

			return c.json<ApiResponse>({
				success: true,
				data: {minGasPrice: `0x${price.toString(16)}`},
			});
		})

		// POST /api/mempool/auto-forward - Set auto-forward mode
		.post('/auto-forward', async (c) => {
			const body = await c.req.json<{enabled: boolean}>();
			const config = c.get('config');

			if (typeof body.enabled !== 'boolean') {
				return c.json<ApiResponse>(
					{
						success: false,
						error: 'enabled must be a boolean',
					},
					400
				);
			}

			await config.storage.setAutoForward(body.enabled);

			return c.json<ApiResponse>({
				success: true,
				data: {autoForward: body.enabled},
			});
		})

		// === TRANSACTION QUERIES ===

		// GET /api/mempool/stats - Get mempool statistics
		.get('/stats', async (c) => {
			const config = c.get('config');
			const stats = await config.storage.getStats();

			const now = Math.floor(Date.now() / 1000);
			const info: MempoolStatsInfo = {
				totalPending: stats.totalPending,
				totalForwarded: stats.totalForwarded,
				totalDropped: stats.totalDropped,
				oldestPendingAge: stats.oldestPending ? now - stats.oldestPending : undefined,
				uniqueSenders: stats.uniqueSenders,
			};

			return c.json<ApiResponse<MempoolStatsInfo>>({
				success: true,
				data: info,
			});
		})

		// GET /api/mempool/pending - List all pending transactions
		.get('/pending', async (c) => {
			const config = c.get('config');
			const from = c.req.query('from');
			const limit = c.req.query('limit');
			const offset = c.req.query('offset');

			const txs = await config.storage.getPendingTransactions({
				status: 'pending',
				from: from?.toLowerCase() as `0x${string}` | undefined,
				limit: limit ? parseInt(limit, 10) : undefined,
				offset: offset ? parseInt(offset, 10) : undefined,
			});

			return c.json<ApiResponse<TransactionInfo[]>>({
				success: true,
				data: txs.map(toTransactionInfo),
			});
		})

		// GET /api/mempool/history - Get transaction history
		.get('/history', async (c) => {
			const config = c.get('config');
			const status = c.req.query('status'); // pending, forwarded, dropped
			const limit = parseInt(c.req.query('limit') ?? '50', 10);
			const offset = parseInt(c.req.query('offset') ?? '0', 10);

			// Use getTransactionHistory to get all statuses by default
			const txs = await config.storage.getTransactionHistory({
				status: status as TransactionStatus | undefined,
				limit,
				offset,
			});

			return c.json<ApiResponse<TransactionInfo[]>>({
				success: true,
				data: txs.map(toTransactionInfo),
			});
		})

		// GET /api/mempool/tx/:hash - Get specific transaction
		.get('/tx/:hash', async (c) => {
			const hash = c.req.param('hash') as Hash;
			const config = c.get('config');

			const tx = await config.storage.getTransaction(hash);
			if (!tx) {
				return c.json<ApiResponse>(
					{
						success: false,
						error: 'Transaction not found',
					},
					404
				);
			}

			return c.json<ApiResponse<TransactionInfo>>({
				success: true,
				data: toTransactionInfo(tx),
			});
		})

		// GET /api/mempool/sender/:address - Get transactions by sender
		.get('/sender/:address', async (c) => {
			const address = c.req.param('address') as `0x${string}`;
			const config = c.get('config');

			const txs = await config.storage.getTransactionsBySender(address);

			return c.json<ApiResponse<TransactionInfo[]>>({
				success: true,
				data: txs.map(toTransactionInfo),
			});
		})

		// === TRANSACTION MANAGEMENT ===

		// POST /api/mempool/include/:hash - Force include a specific transaction
		.post('/include/:hash', async (c) => {
			const hash = c.req.param('hash') as Hash;
			const config = c.get('config');
			const targetUrl = config.env.RPC_URL;

			if (!targetUrl) {
				return c.json<ApiResponse>(
					{
						success: false,
						error: 'RPC_URL not configured',
					},
					500
				);
			}

			const mempool = new MempoolManager(config.storage, targetUrl);
			const result = await mempool.forceInclude(hash);

			if (!result.success) {
				return c.json<ApiResponse>(
					{
						success: false,
						error: result.error,
					},
					400
				);
			}

			return c.json<ApiResponse>({
				success: true,
				data: {hash, status: 'forwarded'},
			});
		})

		// POST /api/mempool/drop/:hash - Drop a pending transaction
		.post('/drop/:hash', async (c) => {
			const hash = c.req.param('hash') as Hash;
			const config = c.get('config');
			const body = await c.req.json<{reason?: string}>().catch(() => ({reason: undefined}));

			// Check if transaction exists and is pending
			const tx = await config.storage.getTransaction(hash);
			if (!tx) {
				return c.json<ApiResponse>(
					{
						success: false,
						error: 'Transaction not found',
					},
					404
				);
			}

			if (tx.status !== 'pending') {
				return c.json<ApiResponse>(
					{
						success: false,
						error: `Transaction is ${tx.status}, not pending`,
					},
					400
				);
			}

			await config.storage.updateStatus(hash, 'dropped', body.reason ?? 'Manually dropped');

			return c.json<ApiResponse>({
				success: true,
				data: {hash, status: 'dropped'},
			});
		})

		// POST /api/mempool/include-batch - Force include multiple transactions
		.post('/include-batch', async (c) => {
			const body = await c.req.json<{hashes: string[]}>();
			const config = c.get('config');
			const targetUrl = config.env.RPC_URL;

			if (!targetUrl) {
				return c.json<ApiResponse>(
					{
						success: false,
						error: 'RPC_URL not configured',
					},
					500
				);
			}

			const mempool = new MempoolManager(config.storage, targetUrl);
			const results: {hash: string; success: boolean; error?: string}[] = [];

			for (const hash of body.hashes) {
				const result = await mempool.forceInclude(hash as Hash);
				results.push({
					hash,
					success: result.success,
					error: result.error,
				});
			}

			return c.json<ApiResponse>({
				success: true,
				data: {
					results,
					forwarded: results.filter((r) => r.success).length,
					failed: results.filter((r) => !r.success).length,
				},
			});
		})

		// POST /api/mempool/drop-batch - Drop multiple transactions
		.post('/drop-batch', async (c) => {
			const body = await c.req.json<{hashes: string[]; reason?: string}>();
			const config = c.get('config');

			const results: {hash: string; dropped: boolean}[] = [];

			for (const hash of body.hashes) {
				const tx = await config.storage.getTransaction(hash as Hash);
				if (tx && tx.status === 'pending') {
					await config.storage.updateStatus(hash as Hash, 'dropped', body.reason ?? 'Batch drop');
					results.push({hash, dropped: true});
				} else {
					results.push({hash, dropped: false});
				}
			}

			return c.json<ApiResponse>({
				success: true,
				data: {
					results,
					dropped: results.filter((r) => r.dropped).length,
				},
			});
		})

		// POST /api/mempool/flush - Forward all pending transactions
		.post('/flush', async (c) => {
			const config = c.get('config');
			const targetUrl = config.env.RPC_URL;

			if (!targetUrl) {
				return c.json<ApiResponse>(
					{
						success: false,
						error: 'RPC_URL not configured',
					},
					500
				);
			}

			const mempool = new MempoolManager(config.storage, targetUrl);
			const result = await mempool.flushPending();

			return c.json<ApiResponse>({
				success: true,
				data: result,
			});
		})

		// DELETE /api/mempool/clear - Clear all pending transactions
		.delete('/clear', async (c) => {
			const config = c.get('config');

			// Get count before clearing
			const stats = await config.storage.getStats();
			const pendingCount = stats.totalPending;

			await config.storage.clearPending();

			return c.json<ApiResponse>({
				success: true,
				data: {cleared: pendingCount},
			});
		});

	return app;
}
