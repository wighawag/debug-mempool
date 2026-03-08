export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: number | string | null;
	method: string;
	params?: unknown[];
}

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: number | string | null;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

// Common Ethereum RPC methods for reference
export type EthMethod =
	| 'eth_sendRawTransaction'
	| 'eth_getTransactionByHash'
	| 'eth_getTransactionReceipt'
	| 'eth_getTransactionCount'
	| 'eth_blockNumber'
	| 'eth_call'
	| 'eth_estimateGas'
	| 'eth_gasPrice'
	| 'eth_getBalance'
	| 'eth_chainId'
	| string; // Allow any other method
