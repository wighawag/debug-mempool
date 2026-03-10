import 'named-logs-context';
import {RemoteD1} from 'remote-sql-d1';
import {CloudflareEnv} from './env.js';
import {logs} from 'named-logs';
import {track, enable as enableWorkersLogger} from 'workers-logger';
import {ExecutionContext} from '@cloudflare/workers-types/experimental';
import {logflareReport} from './utils/logflare.js';
import {consoleReporter} from './utils/basicReporters.js';
import {createServer} from 'purgatory-core';
import pkg from 'purgatory-core/package.json';

enableWorkersLogger('*');
const logger = logs('worker');

async function wrapWithLogger(
	request: Request,
	env: CloudflareEnv,
	ctx: ExecutionContext,
	callback: (
		request: Request,
		env: CloudflareEnv,
		ctx: ExecutionContext,
	) => Promise<Response>,
): Promise<Response> {
	const namespaces = env.NAMED_LOGS || '*';
	let logLevel = 3;
	if (env.NAMED_LOGS_LEVEL) {
		const level = parseInt(env.NAMED_LOGS_LEVEL);
		if (!isNaN(level)) {
			logLevel = level;
		}
	}
	if ((globalThis as any)._logFactory) {
		(globalThis as any)._logFactory.enable(namespaces);
		(globalThis as any)._logFactory.level = logLevel;
	} else {
		console.error(`no log factory`);
	}

	const _trackLogger = track(
		request,
		pkg.name,
		env.LOGFLARE_API_KEY && env.LOGFLARE_SOURCE
			? logflareReport({
					batchAsSingleEvent: false,
					apiKey: env.LOGFLARE_API_KEY,
					source: env.LOGFLARE_SOURCE,
				})
			: consoleReporter,
	);
	const response = await (globalThis as any)._runWithLogger(
		_trackLogger,
		() => {
			return callback(request, env, ctx).catch((err) => {
				return new Response(err, {
					status: 500,
					statusText: err.message,
				});
			});
		},
	);
	const p = _trackLogger.report(
		response || new Response('Scheduled Action Done'),
	);
	if (p) {
		ctx.waitUntil(p);
	}
	return response;
}

export const app = createServer<CloudflareEnv>({
	getDB: (c) => new RemoteD1(c.env.DB),
	getEnv: (c) => c.env,
});

const fetch = async (
	request: Request,
	env: CloudflareEnv,
	ctx: ExecutionContext,
) => {
	return wrapWithLogger(request, env, ctx, async () => {
		return app.fetch(request, env, ctx);
	});
};

export default {
	fetch,
};
