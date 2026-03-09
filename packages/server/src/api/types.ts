// Standard API response wrapper
export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}

// Transaction list item for API responses
export interface TransactionInfo {
	hash: string;
	from: string;
	to: string | null;
	nonce: number;
	gasPrice: string; // Hex string
	maxFeePerGas?: string; // Hex string
	maxPriorityFee?: string; // Hex string
	gasLimit: string; // Hex string
	value: string; // Hex string
	data: string | null;
	status: string;
	createdAt: number;
	forwardedAt?: number;
	droppedAt?: number;
	dropReason?: string;
}

// Mempool state for API responses
export interface MempoolStateInfo {
	minGasPrice: string; // Hex string
	autoForward: boolean;
}

// Mempool statistics
export interface MempoolStatsInfo {
	totalPending: number;
	totalForwarded: number;
	totalDropped: number;
	oldestPendingAge?: number; // Seconds since oldest pending tx
	uniqueSenders: number;
}
