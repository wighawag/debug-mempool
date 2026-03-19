import {Hono} from 'hono';
import type {Hash, Address} from 'viem';
import {ServerOptions} from '../types.js';
import {setup} from '../setup.js';
import {Env} from '../env.js';
import {JsonRpcRequest} from '../rpc/types.js';
import {forwardRpcRequest, createJsonRpcError} from '../rpc/proxy.js';
import {MempoolManager} from '../mempool/state.js';
import {logs} from 'named-logs';

const logger = logs('rpc');

// Methods that should be intercepted
const INTERCEPTED_METHODS = [
	'eth_sendRawTransaction',
	'eth_getTransactionByHash',
	'eth_getTransactionCount',
];

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

			// Create mempool manager
			const mempool = new MempoolManager(config.storage, targetUrl);

			// Handle intercepted methods
			switch (request.method) {
				case 'eth_sendRawTransaction': {
					logger.debug(`eth_sendRawTransaction...`);
					const rawTx = request.params?.[0] as string;
					if (!rawTx) {
						return c.json(
							createJsonRpcError(
								request.id,
								-32602,
								'Missing transaction data',
							),
							400,
						);
					}
					const response = await mempool.processTransaction(rawTx, request.id);
					return c.json(response);
				}

				case 'eth_getTransactionByHash': {
					const hash = request.params?.[0] as string;
					if (!hash) {
						return c.json(
							createJsonRpcError(
								request.id,
								-32602,
								'Missing transaction hash',
							),
							400,
						);
					}

					// Check local mempool first
					const localTx = await config.storage.getTransaction(hash as Hash);
					if (localTx && localTx.status === 'pending') {
						// Return a pending transaction response
						return c.json({
							jsonrpc: '2.0',
							id: request.id,
							result: {
								hash: localTx.hash,
								from: localTx.from,
								to: localTx.to,
								nonce: `0x${localTx.nonce.toString(16)}`,
								gasPrice: `0x${(localTx.gasPrice ?? localTx.maxFeePerGas ?? 0n).toString(16)}`,
								gas: `0x${localTx.gasLimit.toString(16)}`,
								value: `0x${localTx.value.toString(16)}`,
								input: localTx.data ?? '0x',
								// Indicate pending status
								blockHash: null,
								blockNumber: null,
								transactionIndex: null,
								// Include EIP-1559 fields if present
								...(localTx.maxFeePerGas && {
									maxFeePerGas: `0x${localTx.maxFeePerGas.toString(16)}`,
								}),
								...(localTx.maxPriorityFeePerGas && {
									maxPriorityFeePerGas: `0x${localTx.maxPriorityFeePerGas.toString(16)}`,
								}),
								// Transaction type
								type:
									localTx.txType === 'legacy'
										? '0x0'
										: localTx.txType === 'eip2930'
											? '0x1'
											: '0x2',
								// Chain ID if present
								...(localTx.chainId && {
									chainId: `0x${localTx.chainId.toString(16)}`,
								}),
							},
						});
					}

					// Fall through to forward to node
					break;
				}

				case 'eth_getTransactionCount': {
					// Account for pending transactions in local mempool
					const [address, blockTag] = request.params as [string, string];

					if (blockTag === 'pending') {
						// Get pending count from node (includes forwarded txs in node's mempool)
						const response = await forwardRpcRequest(request, {targetUrl});

						if (!response.error && response.result) {
							const nodePendingCount = parseInt(response.result as string, 16);
							// Get local pending transactions (not yet sent to node)
							const localPending = await config.storage.getTransactionsBySender(
								address.toLowerCase() as Address,
							);

							if (localPending.length === 0) {
								// No local pending, return node's response directly
								return c.json(response);
							}

							// Sort by nonce to find gaps
							localPending.sort((a, b) => a.nonce - b.nonce);

							// Start from onchain count and find first missing nonce
							let nextNonce = nodePendingCount;

							for (const tx of localPending) {
								if (tx.nonce === nextNonce) {
									// This nonce exists, check next
									nextNonce++;
								} else if (tx.nonce > nextNonce) {
									// Found a gap - return the missing nonce
									break;
								}
								// If tx.nonce < nextNonce, it's already accounted for in onchain count
							}

							return c.json({
								jsonrpc: '2.0',
								id: request.id,
								result: `0x${nextNonce.toString(16)}`,
							});
						}
					}
					// Fall through to forward
					break;
				}
			}

			// Forward non-intercepted methods to the target node
			const response = await forwardRpcRequest(request, {targetUrl});
			return c.json(response);
		});

	return app;
}
