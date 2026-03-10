import {Hono} from 'hono';
import {ServerOptions} from '../../types.js';
import {setup} from '../../setup.js';
import {Env} from '../../env.js';

export function getAdminAPI<CustomEnv extends Env>(
	options: ServerOptions<CustomEnv>,
) {
	const app = new Hono<{Bindings: CustomEnv}>()
		.use(setup({serverOptions: options}))
		.post('/reset-db', async (c) => {
			const config = c.get('config');
			const env = config.env;
			const storage = config.storage;

			if (!(env as any).DEV) {
				throw new Error(`can only reset db in dev mode `);
			}
			await storage.reset();
			return c.json({success: true});
		})
		.post('/setup-db', async (c) => {
			const config = c.get('config');
			const env = config.env;
			const storage = config.storage;

			await storage.setup();
			return c.json({success: true});
		});

	return app;
}
