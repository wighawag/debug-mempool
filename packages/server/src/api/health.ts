import {Hono} from 'hono';
import {ServerOptions} from '../types.js';
import {setup} from '../setup.js';
import {Env} from '../env.js';

export function getHealthAPI<CustomEnv extends Env>(
	options: ServerOptions<CustomEnv>,
) {
	const app = new Hono<{Bindings: CustomEnv}>()
		.use(setup({serverOptions: options}))
		.get('/', async (c) => {
			return c.json({
				status: 'ok',
				timestamp: new Date().toISOString(),
				version: '0.1.0',
			});
		})
		.get('/upstream', async (c) => {
			const config = c.get('config');
			const targetUrl = config?.env?.RPC_URL;

			if (!targetUrl) {
				return c.json(
					{
						status: 'error',
						message: 'RPC_URL not configured',
					},
					503,
				);
			}

			try {
				const response = await fetch(targetUrl, {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'eth_chainId',
						params: [],
					}),
				});

				if (response.ok) {
					const data = (await response.json()) as {result?: string};
					return c.json({
						status: 'ok',
						chainId: data.result,
						targetUrl,
					});
				}

				return c.json(
					{
						status: 'error',
						message: `Upstream returned ${response.status}`,
					},
					503,
				);
			} catch (error) {
				return c.json(
					{
						status: 'error',
						message: error instanceof Error ? error.message : 'Unknown error',
					},
					503,
				);
			}
		});

	return app;
}
