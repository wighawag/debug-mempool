import {html} from 'hono/html';
import {MempoolStats} from '../../mempool/types.js';
import {formatAge} from '../utils.js';

export function statsCard(stats: MempoolStats) {
	const now = Math.floor(Date.now() / 1000);
	const oldestAge = stats.oldestPending ? now - stats.oldestPending : undefined;

	return html`
		<div class="stats-grid">
			<div class="stat">
				<div class="stat-value">${stats.totalPending}</div>
				<div class="stat-label">Pending</div>
			</div>
			<div class="stat">
				<div class="stat-value">${stats.totalForwarded}</div>
				<div class="stat-label">Forwarded</div>
			</div>
			<div class="stat">
				<div class="stat-value">${stats.totalDropped}</div>
				<div class="stat-label">Dropped</div>
			</div>
			<div class="stat">
				<div class="stat-value">${stats.uniqueSenders}</div>
				<div class="stat-label">Unique Senders</div>
			</div>
			<div class="stat">
				<div class="stat-value">${formatAge(oldestAge)}</div>
				<div class="stat-label">Oldest Tx Age</div>
			</div>
		</div>
	`;
}
