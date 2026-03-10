import {html} from 'hono/html';
import {PendingTransaction} from '../../mempool/types.js';
import {formatGasPrice, formatEthValue, formatTimeAgo} from '../utils.js';

export function transactionList(
	transactions: PendingTransaction[],
	conflicts?: Map<string, string[]>,
) {
	if (transactions.length === 0) {
		return html`
			<div class="empty-state">
				<p>No pending transactions</p>
			</div>
		`;
	}

	const truncateHash = (hash: string) =>
		`${hash.slice(0, 10)}...${hash.slice(-8)}`;

	// Build conflict lookup
	const hasConflict = (tx: PendingTransaction) => {
		const key = `${tx.from.toLowerCase()}:${tx.nonce}`;
		return conflicts?.has(key) ?? false;
	};

	return html`
		<table>
			<thead>
				<tr>
					<th>Hash</th>
					<th>From</th>
					<th>To</th>
					<th>Value</th>
					<th>Gas Price</th>
					<th>Nonce</th>
					<th>Age</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				${transactions.map(
					(tx) => html`
						<tr class="${hasConflict(tx) ? 'nonce-conflict' : ''}">
							<td class="hash truncate" title="${tx.hash}">
								${truncateHash(tx.hash)}
							</td>
							<td class="hash truncate" title="${tx.from}">
								${truncateHash(tx.from)}
							</td>
							<td class="hash truncate" title="${tx.to ?? 'Contract Creation'}">
								${tx.to ? truncateHash(tx.to) : '📄 Create'}
							</td>
							<td>${formatEthValue(tx.value)}</td>
							<td>${formatGasPrice(tx.maxFeePerGas ?? tx.gasPrice ?? 0n)}</td>
							<td>
								${tx.nonce}
								${hasConflict(tx)
									? html`<span
											class="conflict-badge"
											title="Multiple TXs with same nonce"
											>⚠️</span
										>`
									: ''}
							</td>
							<td>${formatTimeAgo(tx.createdAt)}</td>
							<td class="actions">
								<button
									class="btn btn-success"
									style="padding: 0.25rem 0.5rem; font-size: 0.75rem;"
									hx-post="/api/mempool/include/${tx.hash}"
									hx-swap="none"
									title="Force Include"
								>
									✓
								</button>
								<button
									class="btn btn-danger"
									style="padding: 0.25rem 0.5rem; font-size: 0.75rem;"
									hx-post="/api/mempool/drop/${tx.hash}"
									hx-swap="none"
									title="Drop"
								>
									✕
								</button>
							</td>
						</tr>
					`,
				)}
			</tbody>
		</table>
	`;
}
