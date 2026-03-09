import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {ServerOptions} from './types.js';
import {hc} from 'hono/client';
import {HTTPException} from 'hono/http-exception';
import {Env} from './env.js';
import {getDummyAPI} from './api/dummy.js';
import {getRpcAPI} from './api/rpc.js';
import {getMempoolAPI} from './api/mempool.js';
import {getHealthAPI} from './api/health.js';
import {getUIRoutes} from './ui/index.js';

export type {Env};

// export type {Storage} from './storage/index.js';

const corsSetup = cors({
	origin: '*',
	allowHeaders: [
		'X-Custom-Header',
		'Upgrade-Insecure-Requests',
		'Content-Type',
		'SIGNATURE',
	],
	allowMethods: ['POST', 'GET', 'HEAD', 'OPTIONS', 'DELETE'],
	exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
	maxAge: 600,
	credentials: true,
});

export function createServer<CustomEnv extends Env>(
	options: ServerOptions<CustomEnv>,
) {
	const app = new Hono<{Bindings: CustomEnv}>();

	const dummy = getDummyAPI(options);
	const rpc = getRpcAPI(options);
	const mempool = getMempoolAPI(options);
	const health = getHealthAPI(options);
	const ui = getUIRoutes(options);

	return app
		.use('/*', corsSetup)
		.route('/', dummy)
		.route('/rpc', rpc)
		.route('/api/mempool', mempool)
		.route('/health', health)
		.route('/ui', ui)
		.onError((err, c) => {
			const config = c.get('config');
			const env = config?.env || {};
			console.error(err);
			if (err instanceof HTTPException) {
				if (err.res) {
					return err.getResponse();
				}
			}

			return c.json(
				{
					success: false,
					errors: [
						{
							name: 'name' in err ? err.name : undefined,
							code: 'code' in err ? err.code : 5000,
							status: 'status' in err ? err.status : undefined,
							message: err.message,
							cause: env.DEV ? err.cause : undefined,
							stack: env.DEV ? err.stack : undefined,
						},
					],
				},
				500,
			);
		});
}

export type App = ReturnType<typeof createServer>;

// this is a trick to calculate the type when compiling
const client = hc<App>('');
export type Client = typeof client;
export const createClient = (...args: Parameters<typeof hc>): Client =>
	hc<App>(...args);
