import {JsonRpcRequest, JsonRpcResponse} from './types.js';

export interface ProxyOptions {
	targetUrl: string;
}

export async function forwardRpcRequest(
	request: JsonRpcRequest,
	options: ProxyOptions,
): Promise<JsonRpcResponse> {
	const response = await fetch(options.targetUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(request),
	});

	if (!response.ok) {
		return {
			jsonrpc: '2.0',
			id: request.id,
			error: {
				code: -32603,
				message: `Upstream error: ${response.status} ${response.statusText}`,
			},
		};
	}

	return response.json() as Promise<JsonRpcResponse>;
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
