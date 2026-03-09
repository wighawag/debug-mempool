import {MiddlewareHandler} from 'hono/types';
import {ServerOptions} from './types.js';
import {Env} from './env.js';
import {MempoolStorage} from './storage/mempool.js';

export type SetupOptions<CustomEnv extends Env> = {
	serverOptions: ServerOptions<CustomEnv>;
};

export type Config<CustomEnv extends Env> = {
	storage: MempoolStorage;
	env: CustomEnv;
};

declare module 'hono' {
	interface ContextVariableMap {
		config: Config<Env>; // We cannot use generics here, but that is fine as server code is expected to only use Env
	}
}

export function setup<CustomEnv extends Env>(
	options: SetupOptions<CustomEnv>,
): MiddlewareHandler {
	const {getDB, getEnv} = options.serverOptions;

	return async (c, next) => {
		const env = getEnv(c);
		const db = getDB(c);
		const storage = new MempoolStorage(db);

		c.set('config', {
			storage,
			env,
		});

		return next();
	};
}
