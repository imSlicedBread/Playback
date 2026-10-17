//! Local transactional persistence for Playback's Rust migration.
//!
//! Tenant/channel keys scope data; they are not an authentication boundary by
//! themselves. The caller must authorize access before using this store. State
//! may contain private operator settings and must not be sent directly to viewers.

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::Path, time::Duration};
use thiserror::Error;

const SCHEMA_VERSION: i64 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelKey {
    pub tenant_id: String,
    pub channel_id: String,
}

impl ChannelKey {
    pub fn new(tenant_id: impl Into<String>, channel_id: impl Into<String>) -> Self {
        Self {
            tenant_id: tenant_id.into(),
            channel_id: channel_id.into(),
        }
    }

    fn validate(&self) -> Result<(), StoreError> {
        validate_identifier("tenant_id", &self.tenant_id)?;
        validate_identifier("channel_id", &self.channel_id)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChannelSnapshot {
    pub key: ChannelKey,
    pub revision: u64,
    pub state: Value,
    pub updated_at_ms: u64,
}

/// The deterministic result of applying a command to the currently stored state.
/// `result` should be a small response, not another copy of the entire snapshot.
#[derive(Clone, Debug)]
pub struct SnapshotChange {
    pub state: Value,
    pub changed: bool,
    pub result: Value,
}

/// Exact retries return the original result and revision, even when newer
/// commands have subsequently changed the channel. Only `replayed` differs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandReceipt {
    pub command_id: String,
    pub expected_revision: u64,
    pub revision: u64,
    pub changed: bool,
    pub result: Value,
    pub replayed: bool,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("cannot access database file: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid stored JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0} must contain 1 to 255 characters and no control characters")]
    InvalidIdentifier(&'static str),
    #[error("channel already exists; import or initialization never overwrites it")]
    AlreadyExists,
    #[error("channel does not exist")]
    NotFound,
    #[error("revision conflict: expected {expected}, actual {actual}")]
    Conflict { expected: u64, actual: u64 },
    #[error("command_id was already used with a different request or expected revision")]
    CommandMismatch,
    #[error(
        "snapshot must be an object with a nonnegative integer revision within SQLite's range"
    )]
    InvalidSnapshotRevision,
    #[error("snapshot revision {snapshot} does not match required revision {expected}")]
    SnapshotRevisionMismatch { snapshot: u64, expected: u64 },
    #[error("a command marked unchanged attempted to modify the snapshot")]
    UnchangedStateModified,
    #[error("revision or timestamp exceeds SQLite's signed 64-bit range")]
    IntegerRange,
    #[error("command rejected: {0}")]
    Rejected(String),
    #[error("unsupported store schema {0}; refusing to migrate or overwrite it")]
    UnsupportedSchema(i64),
    #[error("use a filesystem database path; in-memory databases and SQLite URI filenames are not accepted")]
    InvalidDatabasePath,
}

pub struct Store {
    connection: Connection,
}

impl Store {
    /// Opens a local SQLite file. Its parent directory must already exist.
    /// New files receive mode 0600 on Unix; existing file permissions are not
    /// changed. Callers should place the database in a private directory.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        validate_database_path(path)?;
        create_private_database_file(path)?;
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;
        Self::configure(connection)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::configure(Connection::open_in_memory()?)
    }

    /// Opens an existing database for commands without creating a missing file.
    pub fn open_existing(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        validate_database_path(path.as_ref())?;
        Self::configure(Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE,
        )?)
    }

    /// Reads a previously initialized store without creating or migrating it.
    pub fn open_read_only(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        validate_database_path(path.as_ref())?;
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version != SCHEMA_VERSION {
            return Err(StoreError::UnsupportedSchema(version));
        }
        Ok(Self { connection })
    }

    fn configure(mut connection: Connection) -> Result<Self, StoreError> {
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        // FULL sync plus WAL protects committed transitions across process
        // failure. A hardware/storage failure still requires separate backups.
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let version: i64 =
                transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
            match version {
                0 => {
                    transaction.execute_batch(include_str!("schema.sql"))?;
                    transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
                }
                SCHEMA_VERSION => {}
                other => return Err(StoreError::UnsupportedSchema(other)),
            }
            transaction.commit()?;
        }
        Ok(Self { connection })
    }

    pub fn create_channel(
        &mut self,
        key: &ChannelKey,
        state: &Value,
        now_ms: u64,
    ) -> Result<ChannelSnapshot, StoreError> {
        key.validate()?;
        let revision = snapshot_revision(state)?;
        let timestamp = sql_integer(now_ms)?;
        let state_json = serde_json::to_string(state)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = transaction.execute(
            "INSERT INTO channel_snapshots
                (tenant_id, channel_id, revision, state_json, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(tenant_id, channel_id) DO NOTHING",
            params![
                key.tenant_id,
                key.channel_id,
                sql_integer(revision)?,
                state_json,
                timestamp
            ],
        )?;
        if changed == 0 {
            return Err(StoreError::AlreadyExists);
        }
        transaction.commit()?;
        Ok(ChannelSnapshot {
            key: key.clone(),
            revision,
            state: state.clone(),
            updated_at_ms: now_ms,
        })
    }

    pub fn load_channel(&self, key: &ChannelKey) -> Result<ChannelSnapshot, StoreError> {
        key.validate()?;
        read_snapshot(&self.connection, key)
    }

    /// Serializes competing writers, checks CAS, and commits state plus its
    /// idempotency receipt in one transaction. `apply` must be a pure, bounded
    /// state transition: do not perform network calls or external side effects.
    /// Failed/rejected commands make no durable change and do not reserve IDs.
    pub fn apply_command<F>(
        &mut self,
        key: &ChannelKey,
        command_id: &str,
        expected_revision: u64,
        request: &Value,
        now_ms: u64,
        apply: F,
    ) -> Result<CommandReceipt, StoreError>
    where
        F: FnOnce(&Value) -> Result<SnapshotChange, String>,
    {
        key.validate()?;
        validate_identifier("command_id", command_id)?;
        let expected_sql = sql_integer(expected_revision)?;
        let timestamp = sql_integer(now_ms)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;

        let previous = transaction
            .query_row(
                "SELECT expected_revision, revision, changed, request_json, result_json
                 FROM command_receipts
                 WHERE tenant_id = ?1 AND channel_id = ?2 AND command_id = ?3",
                params![key.tenant_id, key.channel_id, command_id],
                |row| {
                    Ok((
                        row.get::<_, u64>(0)?,
                        row.get::<_, u64>(1)?,
                        row.get::<_, bool>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?;

        if let Some((original_expected, revision, changed, original_json, result_json)) = previous {
            let original_request: Value = serde_json::from_str(&original_json)?;
            if original_expected != expected_revision || original_request != *request {
                return Err(StoreError::CommandMismatch);
            }
            let receipt = CommandReceipt {
                command_id: command_id.into(),
                expected_revision,
                revision,
                changed,
                result: serde_json::from_str(&result_json)?,
                replayed: true,
            };
            transaction.commit()?;
            return Ok(receipt);
        }

        let current = read_snapshot(&transaction, key)?;
        if current.revision != expected_revision {
            return Err(StoreError::Conflict {
                expected: expected_revision,
                actual: current.revision,
            });
        }

        let change = apply(&current.state).map_err(StoreError::Rejected)?;
        let revision = if change.changed {
            current
                .revision
                .checked_add(1)
                .ok_or(StoreError::IntegerRange)?
        } else {
            if change.state != current.state {
                return Err(StoreError::UnchangedStateModified);
            }
            current.revision
        };
        let revision_sql = sql_integer(revision)?;
        let payload_revision = snapshot_revision(&change.state)?;
        if payload_revision != revision {
            return Err(StoreError::SnapshotRevisionMismatch {
                snapshot: payload_revision,
                expected: revision,
            });
        }

        if change.changed {
            let count = transaction.execute(
                "UPDATE channel_snapshots SET revision = ?3, state_json = ?4, updated_at_ms = ?5
                 WHERE tenant_id = ?1 AND channel_id = ?2 AND revision = ?6",
                params![
                    key.tenant_id,
                    key.channel_id,
                    revision_sql,
                    serde_json::to_string(&change.state)?,
                    timestamp,
                    expected_sql,
                ],
            )?;
            if count != 1 {
                return Err(StoreError::Conflict {
                    expected: expected_revision,
                    actual: read_snapshot(&transaction, key)?.revision,
                });
            }
        }

        transaction.execute(
            "INSERT INTO command_receipts
                (tenant_id, channel_id, command_id, expected_revision, revision,
                 changed, request_json, result_json, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                key.tenant_id,
                key.channel_id,
                command_id,
                expected_sql,
                revision_sql,
                change.changed,
                serde_json::to_string(request)?,
                serde_json::to_string(&change.result)?,
                timestamp,
            ],
        )?;
        transaction.commit()?;
        Ok(CommandReceipt {
            command_id: command_id.into(),
            expected_revision,
            revision,
            changed: change.changed,
            result: change.result,
            replayed: false,
        })
    }
}

fn read_snapshot(connection: &Connection, key: &ChannelKey) -> Result<ChannelSnapshot, StoreError> {
    let (revision, state_json, updated_at_ms) = connection
        .query_row(
            "SELECT revision, state_json, updated_at_ms FROM channel_snapshots
             WHERE tenant_id = ?1 AND channel_id = ?2",
            params![key.tenant_id, key.channel_id],
            |row| {
                Ok((
                    row.get::<_, u64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u64>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or(StoreError::NotFound)?;
    let state: Value = serde_json::from_str(&state_json)?;
    let payload_revision = snapshot_revision(&state)?;
    if payload_revision != revision {
        return Err(StoreError::SnapshotRevisionMismatch {
            snapshot: payload_revision,
            expected: revision,
        });
    }
    Ok(ChannelSnapshot {
        key: key.clone(),
        revision,
        state,
        updated_at_ms,
    })
}

fn snapshot_revision(state: &Value) -> Result<u64, StoreError> {
    let revision = state
        .as_object()
        .and_then(|object| object.get("revision"))
        .and_then(Value::as_u64)
        .filter(|revision| *revision <= i64::MAX as u64)
        .ok_or(StoreError::InvalidSnapshotRevision)?;
    Ok(revision)
}

fn sql_integer(value: u64) -> Result<i64, StoreError> {
    i64::try_from(value).map_err(|_| StoreError::IntegerRange)
}

fn validate_identifier(name: &'static str, value: &str) -> Result<(), StoreError> {
    if value.trim().is_empty() || value.chars().count() > 255 || value.chars().any(char::is_control)
    {
        return Err(StoreError::InvalidIdentifier(name));
    }
    Ok(())
}

fn create_private_database_file(path: &Path) -> Result<(), StoreError> {
    use std::fs::OpenOptions;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn validate_database_path(path: &Path) -> Result<(), StoreError> {
    let name = path.as_os_str().to_string_lossy();
    if name.is_empty() || name == ":memory:" || name.starts_with("file:") {
        return Err(StoreError::InvalidDatabasePath);
    }
    Ok(())
}
