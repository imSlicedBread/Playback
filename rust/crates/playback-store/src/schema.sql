CREATE TABLE channel_snapshots (
    tenant_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    state_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    PRIMARY KEY (tenant_id, channel_id)
) WITHOUT ROWID;

CREATE TABLE command_receipts (
    tenant_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    changed INTEGER NOT NULL CHECK (changed IN (0, 1)),
    request_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    PRIMARY KEY (tenant_id, channel_id, command_id),
    FOREIGN KEY (tenant_id, channel_id)
        REFERENCES channel_snapshots (tenant_id, channel_id)
) WITHOUT ROWID;
