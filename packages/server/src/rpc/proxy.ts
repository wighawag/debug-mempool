import {logs} from 'named-logs';
import {JsonRpcRequest, JsonRpcResponse} from './types.js';

const logger = logs('rpc:proxy');

export interface ProxyOptions {
	targetUrl: string;
}

export async function forwardRpcRequest(
	request: JsonRpcRequest,
	options: ProxyOptions,
): Promise<JsonRpcResponse> {
	const body = JSON.stringify(request);
	// logger.info(
	// 	`Forwarding RPC request to ${options.targetUrl}:`,
	// 	request.method,
	// 	request.params,
	// );
	// logger.debug(`Request body: ${body}`);

	const response = await fetch(options.targetUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body,
	});

	if (!response.ok) {
		const errorBody = await response.text();
		logger.error(
			`Upstream error: ${response.status} ${response.statusText}`,
			errorBody,
		);
		return {
			jsonrpc: '2.0',
			id: request.id,
			error: {
				code: -32603,
				message: `Upstream error: ${response.status} ${response.statusText}`,
			},
		};
	}

	const result = (await response.json()) as JsonRpcResponse;
	if (result.error) {
		logger.warn(`RPC error response for ${request.method}:`, result.error);
	}
	return result;
}

export function createJsonRpcError(
	id: number | string | null,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcResponse {
	return {
		jsonrpc: '2.0',
		id,
		error: {code, message, data},
	};
}

export function createJsonRpcResult(
	id: number | string | null,
	result: unknown,
): JsonRpcResponse {
	return {
		jsonrpc: '2.0',
		id,
		result,
	};
}
