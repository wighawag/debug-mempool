import {html} from 'hono/html';
import {formatGwei} from 'viem';

export interface StateControlsProps {
	minGasPrice: bigint;
	autoForward: boolean;
	replacementEnabled: boolean;
	minReplacementBump: number;
}

export function stateControls(state: StateControlsProps) {
	const gasPriceGwei = formatGwei(state.minGasPrice);

	return html`
		<div class="controls">
			<div>
				<strong>Auto-Forward:</strong>
				${state.autoForward
					? html`<span class="status-badge status-forwarded">Enabled</span>`
					: html`<span class="status-badge status-pending">Disabled</span>`}
			</div>

			${state.autoForward
				? html`
						<button class="btn btn-warning" onclick="toggleAutoForward(false)">
							⏸️ Disable Auto-Forward
						</button>
					`
				: html`
						<button class="btn btn-success" onclick="toggleAutoForward(true)">
							▶️ Enable Auto-Forward
						</button>
					`}

			<div>
				<strong>Replacement:</strong>
				${state.replacementEnabled
					? html`<span class="status-badge status-forwarded">Node-like</span>`
					: html`<span class="status-badge status-pending">Debug</span>`}
			</div>

			${state.replacementEnabled
				? html`
						<button class="btn btn-sm" onclick="toggleReplacement(false)">
							Switch to Debug
						</button>
					`
				: html`
						<button class="btn btn-sm" onclick="toggleReplacement(true)">
							Switch to Node-like
						</button>
					`}
			${state.replacementEnabled
				? html`
						<div style="display: flex; align-items: center; gap: 0.5rem;">
							<label>Min Gas Bump:</label>
							<input
								type="number"
								id="replacement-bump"
								value="${state.minReplacementBump}"
								min="0"
								max="1000"
								style="width: 80px;"
							/>
							<span>%</span>
							<button class="btn btn-sm" onclick="setReplacementBump()">
								Set
							</button>
						</div>
					`
				: ''}

			<button
				class="btn btn-primary"
				hx-post="/api/mempool/flush"
				hx-swap="none"
				hx-confirm="Forward all pending transactions?"
			>
				🚀 Flush All
			</button>

			<button
				class="btn btn-danger"
				hx-delete="/api/mempool/clear"
				hx-swap="none"
				hx-confirm="Clear all pending transactions?"
			>
				🗑️ Clear
			</button>

			<div
				style="margin-left: auto; display: flex; align-items: center; gap: 0.5rem;"
			>
				<label>Min Gas Price:</label>
				<input
					type="number"
					id="min-gas-price"
					value="${gasPriceGwei}"
					step="0.1"
					style="width: 100px;"
				/>
				<span>gwei</span>
				<button class="btn btn-primary" onclick="setMinGasPrice()">Set</button>
			</div>
		</div>

		<script>
			function setMinGasPrice() {
				const input = document.getElementById('min-gas-price');
				if (!input) return;
				const gwei = input.value;
				const wei = Math.floor(parseFloat(gwei) * 1e9).toString();
				fetch('/api/mempool/gas-price', {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({minGasPrice: wei}),
				})
					.then((res) => {
						if (!res.ok) throw new Error('Failed to set gas price');
						htmx.trigger('#state-controls', 'htmx:load');
					})
					.catch((err) => alert(err.message));
			}

			function toggleAutoForward(enabled) {
				fetch('/api/mempool/auto-forward', {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({enabled}),
				})
					.then((res) => {
						if (!res.ok) throw new Error('Failed to toggle auto-forward');
						htmx.trigger('#state-controls', 'htmx:load');
						location.reload(); // Refresh to show/hide banner
					})
					.catch((err) => alert(err.message));
			}

			function toggleReplacement(enabled) {
				fetch('/api/mempool/replacement-mode', {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({enabled}),
				})
					.then((res) => {
						if (!res.ok) throw new Error('Failed to toggle replacement mode');
						htmx.trigger('#state-controls', 'htmx:load');
						location.reload();
					})
					.catch((err) => alert(err.message));
			}

			function setReplacementBump() {
				const input = document.getElementById('replacement-bump');
				if (!input) return;
				const percent = parseInt(input.value, 10);
				fetch('/api/mempool/replacement-bump', {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({percent}),
				})
					.then((res) => {
						if (!res.ok) throw new Error('Failed to set replacement bump');
						htmx.trigger('#state-controls', 'htmx:load');
					})
					.catch((err) => alert(err.message));
			}
		</script>
	`;
}
