import {Hono} from 'hono';
import {ServerOptions} from '../types.js';
import {setup} from '../setup.js';
import {Env} from '../env.js';
import {JsonRpcRequest} from '../rpc/types.js';
import {forwardRpcRequest, createJsonRpcError} from '../rpc/proxy.js';

export function getRpcAPI<CustomEnv extends Env>(
	options: ServerOptions<CustomEnv>,
) {
	const app = new Hono<{Bindings: CustomEnv}>()
		.use(setup({serverOptions: options}))
		.post('/', async (c) => {
			const config = c.get('config');
			const targetUrl = config.env.RPC_URL;

			if (!targetUrl) {
				return c.json(
					createJsonRpcError(null, -32603, 'RPC_URL not configured'),
					500,
				);
			}

			let request: JsonRpcRequest;
			try {
				request = await c.req.json();
			} catch {
				return c.json(createJsonRpcError(null, -32700, 'Parse error'), 400);
			}

			// Validate JSON-RPC structure
			if (request.jsonrpc !== '2.0' || !request.method) {
				return c.json(
					createJsonRpcError(request?.id ?? null, -32600, 'Invalid Request'),
					400,
				);
			}

			// For now, forward all requests to the target node
			// Phase 3 will add interception logic here
			const response = await forwardRpcRequest(request, {targetUrl});
			return c.json(response);
		});

	return app;
}
