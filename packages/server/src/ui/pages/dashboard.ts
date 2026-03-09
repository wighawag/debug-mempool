import {html, raw} from 'hono/html';
import {layout} from '../layout.js';
import {stateControls} from '../components/state-controls.js';
import {statsCard} from '../components/stats-card.js';
import {transactionList} from '../components/transaction-list.js';
import {PendingTransaction, MempoolStats} from '../../mempool/types.js';

export interface DashboardProps {
	state: {
		minGasPrice: bigint;
		autoForward: boolean;
	};
	stats: MempoolStats;
	pending: PendingTransaction[];
}

export function dashboard({state, stats, pending}: DashboardProps) {
	const content = html`
		${!state.autoForward
			? html`<div class="paused-banner">
					⏸️ AUTO-FORWARD DISABLED - Transactions are being held
				</div>`
			: ''}

		<div class="container">
			<div class="card">
				<h2>Mempool State</h2>
				<div
					id="state-controls"
					hx-get="/ui/partials/state"
					hx-trigger="every 5s"
				>
					${raw(stateControls(state))}
				</div>
			</div>

			<div class="card">
				<h2>Statistics</h2>
				<div
					id="stats-card"
					hx-get="/ui/partials/stats"
					hx-trigger="every 5s"
				>
					${raw(statsCard(stats))}
				</div>
			</div>

			<div class="card">
				<h2>
					Pending Transactions
					<span class="htmx-indicator">⏳</span>
				</h2>
				<div
					id="transaction-list"
					hx-get="/ui/partials/transactions"
					hx-trigger="every 2s"
					hx-indicator=".htmx-indicator"
				>
					${raw(transactionList(pending))}
				</div>
			</div>
		</div>
	`;

	return layout({title: 'Debug Mempool', children: content});
}
