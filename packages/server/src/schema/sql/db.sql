-- Pending transactions in the local mempool
CREATE TABLE IF NOT EXISTS PendingTransactions (
    hash TEXT PRIMARY KEY,                  -- Transaction hash (0x...)
    raw_tx TEXT NOT NULL,                   -- Raw signed transaction hex
    from_address TEXT NOT NULL,             -- Sender address
    to_address TEXT,                        -- Recipient address (null for contract creation)
    nonce INTEGER NOT NULL,                 -- Transaction nonce
    gas_price TEXT,                         -- Gas price in wei (legacy/EIP-2930, null for EIP-1559)
    max_fee_per_gas TEXT,                   -- EIP-1559 max fee (optional)
    max_priority_fee_per_gas TEXT,          -- EIP-1559 priority fee (optional)
    gas_limit TEXT NOT NULL,                -- Gas limit
    value TEXT NOT NULL,                    -- Value in wei
    data TEXT,                              -- Transaction data/calldata
    chain_id INTEGER,                       -- Chain ID
    tx_type TEXT DEFAULT 'legacy',          -- Transaction type: legacy, eip2930, eip1559, eip4844
    status TEXT DEFAULT 'pending',          -- pending, forwarded, dropped, replaced
    created_at INTEGER NOT NULL,            -- Unix timestamp when received
    forwarded_at INTEGER,                   -- Unix timestamp when forwarded to node
    dropped_at INTEGER,                     -- Unix timestamp when dropped
    drop_reason TEXT                        -- Reason for dropping (if applicable)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_pending_from ON PendingTransactions(from_address);
CREATE INDEX IF NOT EXISTS idx_pending_status ON PendingTransactions(status);
CREATE INDEX IF NOT EXISTS idx_pending_nonce ON PendingTransactions(from_address, nonce);
CREATE INDEX IF NOT EXISTS idx_pending_created ON PendingTransactions(created_at);

-- Mempool configuration state
CREATE TABLE IF NOT EXISTS MempoolState (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Initialize default state
INSERT OR IGNORE INTO MempoolState (key, value, updated_at) VALUES 
    ('paused', 'false', 0),
    ('min_gas_price', '0', 0),
    ('auto_forward', 'true', 0);
