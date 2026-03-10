# Purgatory

A local mempool proxy for Ethereum that intercepts, holds, and controls transaction forwarding to upstream nodes. Perfect for debugging, testing, and understanding mempool behavior.

## Overview

Purgatory acts as an RPC proxy between your application and an Ethereum node. It intercepts `eth_sendRawTransaction` calls, stores transactions in a local mempool, and gives you full control over when and how they're forwarded to the actual network.

### Key Features

- **Transaction Interception**: Captures all `eth_sendRawTransaction` calls
- **Gas Price Filtering**: Set minimum gas price thresholds
- **Auto-Forward Control**: Toggle automatic forwarding to upstream node
- **Transaction Replacement**: Configurable replacement bump requirements (like EIP-1559 pools)
- **Batch Operations**: Include or drop multiple transactions at once
- **REST API**: Full mempool management via REST endpoints
- **Web Dashboard**: Visual UI for monitoring and managing transactions
- **Multi-Platform**: Deploy on Node.js or Cloudflare Workers

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm

### Installation

```bash
npm i purgatory
```

### Using it


```
purgatory [options]

Options:
  -p, --port <port>    Port to listen on (default: 8545)
  --db <sqlite.db>     Path to SQLite database file (default: in-memory)
  --rpc-url <url>      RPC URL for the upstream Ethereum node
  --reset-db           Reset the database on startup
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Your DApp     │────▶│    Purgatory    │────▶│  Ethereum Node  │
│                 │     │   (port 8545)   │     │  (port 8546)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌───────────┐
                        │  SQLite   │
                        │  Storage  │
                        └───────────┘
```

## API Reference

### JSON-RPC Endpoint

**POST** `/`

Standard Ethereum JSON-RPC proxy. All methods are forwarded to the upstream node except for intercepted methods:

#### Intercepted Methods

- **`eth_sendRawTransaction`**: Transactions are decoded, validated, and stored in the local mempool. Forwarding depends on the `autoForward` setting.

- **`eth_getTransactionByHash`**: Returns transactions from local mempool if pending locally, otherwise queries upstream.

- **`eth_getTransactionCount`**: Accounts for local pending transactions when `blockTag` is `"pending"`.

### REST API

#### State Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mempool/state` | Get current mempool state |
| POST | `/api/mempool/gas-price` | Set minimum gas price |
| POST | `/api/mempool/auto-forward` | Enable/disable auto-forwarding |
| POST | `/api/mempool/replacement-mode` | Enable/disable transaction replacement |
| POST | `/api/mempool/replacement-bump` | Set minimum replacement bump percentage |

#### Transaction Queries

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mempool/stats` | Get mempool statistics |
| GET | `/api/mempool/pending` | List all pending transactions |
| GET | `/api/mempool/history` | Get transaction history |
| GET | `/api/mempool/tx/:hash` | Get specific transaction |
| GET | `/api/mempool/sender/:address` | Get transactions by sender |

#### Transaction Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/mempool/include/:hash` | Forward a specific transaction |
| POST | `/api/mempool/drop/:hash` | Drop a pending transaction |
| POST | `/api/mempool/include-batch` | Forward multiple transactions |
| POST | `/api/mempool/drop-batch` | Drop multiple transactions |
| POST | `/api/mempool/flush` | Forward all pending transactions |
| DELETE | `/api/mempool/clear` | Clear all pending transactions |

#### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/health/upstream` | Upstream node health check |

### Web Dashboard

Access the visual dashboard at `/ui` to:
- View pending, forwarded, and dropped transactions
- Monitor mempool statistics
- Control auto-forward and gas price settings
- Manually include or drop transactions


## Development

### Running Tests

```bash
# Run all tests
pnpm test

# Run server tests
cd packages/server
pnpm test
```

### Development Mode

```bash
# Start with hot reload
pnpm nodejs:dev

# Or run the full local setup with Zellij
pnpm start:nodejs
```

### Formatting

```bash
pnpm format        # Format all files
pnpm format:check  # Check formatting
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
