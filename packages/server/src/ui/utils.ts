/**
 * Shared utility functions for UI components
 */

import {formatEther, formatGwei} from 'viem';

/**
 * Format a duration in seconds to a human-readable string
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "30s", "5m", "2h")
 */
export function formatAge(seconds: number | undefined): string {
	if (seconds === undefined || seconds === null) return '-';
	if (seconds < 0) return '-';
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	return `${Math.floor(seconds / 3600)}h`;
}

/**
 * Format a timestamp to a relative "ago" string
 * @param timestamp - Unix timestamp in seconds
 * @returns Formatted string (e.g., "30s ago", "5m ago")
 */
export function formatTimeAgo(timestamp: number): string {
	const now = Math.floor(Date.now() / 1000);
	const age = now - timestamp;
	if (age < 0) return 'just now';
	if (age < 60) return `${age}s ago`;
	if (age < 3600) return `${Math.floor(age / 60)}m ago`;
	return `${Math.floor(age / 3600)}h ago`;
}

/**
 * Format a gas price from wei to gwei string
 * Uses viem's formatGwei for precise bigint handling
 * @param price - Gas price in wei as bigint
 * @returns Formatted string (e.g., "10.5 gwei")
 */
export function formatGasPrice(price: bigint): string {
	const gwei = formatGwei(price);
	// Truncate to 2 decimal places for display
	const parts = gwei.split('.');
	if (parts.length === 2) {
		return `${parts[0]}.${parts[1].slice(0, 2)} gwei`;
	}
	return `${gwei} gwei`;
}

/**
 * Format an ETH value from wei to ETH string
 * Uses viem's formatEther for precise bigint handling
 * @param value - Value in wei as bigint
 * @returns Formatted string (e.g., "1.5 ETH", "<0.0001 ETH")
 */
export function formatEthValue(value: bigint): string {
	if (value === 0n) return '0 ETH';

	// For values less than 0.0001 ETH (100 trillion wei)
	const threshold = 100_000_000_000_000n; // 0.0001 ETH
	if (value < threshold) return '<0.0001 ETH';

	const eth = formatEther(value);
	// Truncate to 4 decimal places for display
	const parts = eth.split('.');
	if (parts.length === 2) {
		return `${parts[0]}.${parts[1].slice(0, 4)} ETH`;
	}
	return `${eth} ETH`;
}
