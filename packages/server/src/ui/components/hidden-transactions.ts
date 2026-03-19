import {html} from 'hono/html';
import {PendingTransaction} from '../../mempool/types.js';
import {formatGasPrice, formatEthValue, formatTimeAgo} from '../utils.js';

export function hiddenTransactionsList(transactions: PendingTransaction[]) {
	if (transactions.length === 0) {
		return html`
			<div class="empty-state">
				<p>No hidden transactions</p>
			</div>
		`;
	}

	const truncateHash = (hash: string) =>
		`${hash.slice(0, 10)}...${hash.slice(-8)}`;

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
					<th>Hidden At</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				${transactions.map(
					(tx) => html`
						<tr class="hidden-tx">
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
							<td>${tx.nonce}</td>
							<td>${tx.deletedAt ? formatTimeAgo(tx.deletedAt) : '-'}</td>
							<td class="actions">
								<button
									class="btn btn-success"
									style="padding: 0.25rem 0.5rem; font-size: 0.75rem;"
									hx-post="/api/admin/tx/restore"
									hx-vals='{"hash":"${tx.hash}"}'
									hx-target="#hidden-transactions-list"
									hx-swap="outerHTML"
									title="Restore Transaction"
								>
									↻ Restore
								</button>
							</td>
						</tr>
					`,
				)}
			</tbody>
		</table>
	`;
}
