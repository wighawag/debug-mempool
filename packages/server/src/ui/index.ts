import {Hono} from 'hono';
import {html} from 'hono/html';
import {ServerOptions} from '../types.js';
import {setup} from '../setup.js';
import {Env} from '../env.js';
import {dashboard} from './pages/dashboard.js';
import {transactionList} from './components/transaction-list.js';
import {stateControls} from './components/state-controls.js';
import {statsCard} from './components/stats-card.js';
import {layout} from './layout.js';
import htmxScript from './static/htmx.min.js.js';

/**
 * Render an error page for the UI
 */
function errorPage(message: string) {
	return layout({
		title: 'Error - Debug Mempool',
		children: html`
			<div class="container">
				<div class="card">
					<h2>Error</h2>
					<p style="color: var(--accent);">${message}</p>
					<p style="margin-top: 1rem;">
						<a href="/ui" class="btn btn-primary">← Back to Dashboard</a>
					</p>
				</div>
			</div>
		`,
	});
}

export function getUIRoutes<CustomEnv extends Env>(
	options: ServerOptions<CustomEnv>,
) {
	const app = new Hono<{Bindings: CustomEnv}>()
		// Static files (no setup middleware needed)
		.get('/static/htmx.min.js', (c) => {
			return c.text(htmxScript, 200, {
				'Content-Type': 'application/javascript',
				'Cache-Control': 'public, max-age=31536000, immutable',
			});
		})

		.use(setup({serverOptions: options}))

		// Main dashboard
		.get('/', async (c) => {
			try {
				const config = c.get('config');
				const storage = config.storage;

				const state = {
					minGasPrice: await storage.getMinGasPrice(),
					autoForward: await storage.isAutoForward(),
					replacementEnabled: await storage.isReplacementEnabled(),
					minReplacementBump: await storage.getMinReplacementBump(),
				};

				const stats = await storage.getStats();
				const pending = await storage.getPendingTransactions({limit: 50, includeHidden: true});
				const hidden = await storage.getHiddenTransactions();
				const conflicts = await storage.getNonceConflicts();

				return c.html(dashboard({state, stats, pending, hiddenCount: hidden.length, conflicts}));
			} catch (error) {
				console.error('Dashboard error:', error);
				return c.html(
					errorPage('Failed to load dashboard. Please try again.'),
					500,
				);
			}
		})

		// HTMX partial: Transaction list (includes hidden)
		.get('/partials/transactions', async (c) => {
			try {
				const config = c.get('config');
				// Get ALL transactions including hidden
				const all = await config.storage.getPendingTransactions({
					limit: 50,
					includeHidden: true,
				});
				const conflicts = await config.storage.getNonceConflicts();
				return c.html(transactionList(all, conflicts));
			} catch (error) {
				console.error('Transaction list error:', error);
				return c.html(
					html`<div class="empty-state">
						<p>Failed to load transactions</p>
					</div>`,
					500,
				);
			}
		})

		// HTMX partial: State controls
		.get('/partials/state', async (c) => {
			try {
				const config = c.get('config');
				const state = {
					minGasPrice: await config.storage.getMinGasPrice(),
					autoForward: await config.storage.isAutoForward(),
					replacementEnabled: await config.storage.isReplacementEnabled(),
					minReplacementBump: await config.storage.getMinReplacementBump(),
				};
				return c.html(stateControls(state));
			} catch (error) {
				console.error('State controls error:', error);
				return c.html(
					html`<div class="empty-state"><p>Failed to load controls</p></div>`,
					500,
				);
			}
		})

		// HTMX partial: Statistics
		.get('/partials/stats', async (c) => {
			try {
				const config = c.get('config');
				const stats = await config.storage.getStats();
				const hidden = await config.storage.getHiddenTransactions();
				return c.html(statsCard({stats, hiddenCount: hidden.length}));
			} catch (error) {
				console.error('Stats error:', error);
				return c.html(
					html`<div class="empty-state"><p>Failed to load stats</p></div>`,
					500,
				);
			}
		})

		// HTMX action: Hide transaction
		.post('/actions/hide/:hash', async (c) => {
			try {
				const hash = c.req.param('hash') as `0x${string}`;
				const config = c.get('config');
				const targetUrl = config.env.RPC_URL;

				if (!targetUrl) {
					throw new Error('RPC_URL not configured');
				}

				const {MempoolManager} = await import('../mempool/state.js');
				const mempool = new MempoolManager(config.storage, targetUrl);
				const result = await mempool.hideTransaction(hash);

				if (!result.success) {
					throw new Error(result.error ?? 'Failed to hide transaction');
				}

				// Return updated transaction list (includes hidden)
				const all = await config.storage.getPendingTransactions({
					limit: 50,
					includeHidden: true,
				});
				const conflicts = await config.storage.getNonceConflicts();
				return c.html(transactionList(all, conflicts));
			} catch (error) {
				console.error('Hide transaction error:', error);
				return c.html(
					html`<div class="empty-state">
						<p>Failed to hide transaction</p>
					</div>`,
					500,
				);
			}
		})

		// HTMX action: Restore transaction
		.post('/actions/restore/:hash', async (c) => {
			try {
				const hash = c.req.param('hash') as `0x${string}`;
				const config = c.get('config');
				const targetUrl = config.env.RPC_URL;

				if (!targetUrl) {
					throw new Error('RPC_URL not configured');
				}

				const {MempoolManager} = await import('../mempool/state.js');
				const mempool = new MempoolManager(config.storage, targetUrl);
				const result = await mempool.restoreTransaction(hash);

				if (!result.success) {
					throw new Error(result.error ?? 'Failed to restore transaction');
				}

				// Return updated transaction list (includes hidden)
				const all = await config.storage.getPendingTransactions({
					limit: 50,
					includeHidden: true,
				});
				const conflicts = await config.storage.getNonceConflicts();
				return c.html(transactionList(all, conflicts));
			} catch (error) {
				console.error('Restore transaction error:', error);
				return c.html(
					html`<div class="empty-state">
						<p>Failed to restore transaction</p>
					</div>`,
					500,
				);
			}
		})

		// HTMX action: Drop transaction
		.post('/actions/drop/:hash', async (c) => {
			try {
				const hash = c.req.param('hash') as `0x${string}`;
				const config = c.get('config');

				// Check if transaction exists and is pending (include hidden transactions)
				const tx = await config.storage.getTransaction(hash, true);
				if (!tx) {
					throw new Error('Transaction not found');
				}

				if (tx.status !== 'pending') {
					throw new Error(`Transaction is ${tx.status}, not pending`);
				}

				await config.storage.updateStatus(hash, 'dropped', 'Manually dropped');

				// Return updated transaction list (includes hidden)
				const pending = await config.storage.getPendingTransactions({
					limit: 50,
					includeHidden: true,
				});
				const conflicts = await config.storage.getNonceConflicts();
				return c.html(transactionList(pending, conflicts));
			} catch (error) {
				console.error('Drop transaction error:', error);
				return c.html(
					html`<div class="empty-state">
						<p>Failed to drop transaction</p>
					</div>`,
					500,
				);
			}
		});

	return app;
}
