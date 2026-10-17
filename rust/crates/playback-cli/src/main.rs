use clap::{Parser, Subcommand};
use playback_core::{import_v123, Command, EngineState};
use playback_store::{ChannelKey, ChannelSnapshot, SnapshotChange, Store};
use serde_json::{json, Map, Value};
use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::ExitCode,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Parser)]
#[command(
    name = "playback",
    version,
    about = "Local Rust queue migration and transactional persistence tool",
    long_about = "Local Rust queue migration and transactional persistence tool. This is an offline migration slice, not an HTTP server or a cloud broadcast worker. Database files are operator-private."
)]
struct Cli {
    /// Explicit destination SQLite file. Its parent directory must already exist.
    #[arg(long)]
    db: PathBuf,
    /// Tenant namespace. Namespacing does not replace authentication.
    #[arg(long)]
    tenant: String,
    /// Channel namespace within the tenant.
    #[arg(long)]
    channel: String,
    #[command(subcommand)]
    operation: Operation,
}

#[derive(Subcommand)]
enum Operation {
    /// Create a new empty channel; refuse to overwrite an existing channel.
    Init,
    /// Import an explicit v1.2.3 state.json copy into a new channel.
    #[command(name = "import-v123")]
    ImportV123 {
        /// Read-only source copy. It must be separate from the destination database.
        #[arg(long)]
        source: PathBuf,
    },
    /// Show safe state fields and counts, omitting private settings and source data.
    #[command(alias = "state")]
    Show {
        /// Also show known public entry fields for each queue lane.
        #[arg(long)]
        entries: bool,
    },
    /// Apply one JSON core command using a stable ID and expected revision.
    Apply {
        #[arg(long)]
        command_id: String,
        #[arg(long)]
        expected_revision: u64,
        /// JSON command, for example {"action":"skip"}.
        #[arg(
            long,
            required_unless_present = "command_file",
            conflicts_with = "command_file"
        )]
        command: Option<String>,
        /// Alternative to --command: read a JSON command from this file.
        #[arg(long, required_unless_present = "command", conflicts_with = "command")]
        command_file: Option<PathBuf>,
    },
}

fn main() -> ExitCode {
    match run(Cli::parse()).and_then(|output| Ok(serde_json::to_string_pretty(&output)?)) {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<Value, Box<dyn Error>> {
    let key = ChannelKey::new(cli.tenant, cli.channel);
    let now_ms = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())?;

    match cli.operation {
        Operation::Init => {
            let state = serde_json::to_value(EngineState::new(now_ms))?;
            let mut store = Store::open(&cli.db)?;
            let snapshot = store.create_channel(&key, &state, now_ms)?;
            Ok(json!({"status": "created", "state": safe_summary(&snapshot, false)}))
        }
        Operation::ImportV123 { source } => {
            // Check aliases before SQLite opens anything, and read the supplied
            // file without ever opening it for writing or making automatic copies.
            ensure_separate_source(&source, &cli.db)?;
            let raw = serde_json::from_slice(&fs::read(&source)?)?;
            let report = import_v123(raw, now_ms)?;
            let warning_count = report.warnings.len();
            let state = serde_json::to_value(report.state)?;
            // report.source deliberately remains transient: it may contain
            // unknown settings or credentials from a user's older installation.
            let mut store = Store::open(&cli.db)?;
            let snapshot = store.create_channel(&key, &state, now_ms)?;
            Ok(json!({
                "status": "imported",
                "sourceModified": false,
                "warningCount": warning_count,
                "review": "Review the imported queue and settings before switching from the existing player. The supplied source copy is unchanged; private source data is not exported.",
                "state": safe_summary(&snapshot, false)
            }))
        }
        Operation::Show { entries } => {
            let store = Store::open_read_only(&cli.db)?;
            Ok(safe_summary(&store.load_channel(&key)?, entries))
        }
        Operation::Apply {
            command_id,
            expected_revision,
            command,
            command_file,
        } => {
            let raw = match (command, command_file) {
                (Some(command), None) => command,
                (None, Some(path)) => fs::read_to_string(path)?,
                _ => return Err("provide exactly one of --command or --command-file".into()),
            };
            let request: Value = serde_json::from_str(&raw)?;
            let command: Command = serde_json::from_value(request.clone())?;
            let mut store = Store::open_existing(&cli.db)?;
            let receipt = store.apply_command(
                &key,
                &command_id,
                expected_revision,
                &request,
                now_ms,
                |stored| {
                    let state: EngineState = serde_json::from_value(stored.clone())
                        .map_err(|error| error.to_string())?;
                    let transition = state
                        .transition(command, now_ms)
                        .map_err(|error| error.to_string())?;
                    Ok(SnapshotChange {
                        state: serde_json::to_value(transition.state)
                            .map_err(|error| error.to_string())?,
                        changed: transition.changed,
                        result: json!({"ignored": transition.ignored}),
                    })
                },
            )?;
            Ok(serde_json::to_value(receipt)?)
        }
    }
}

fn safe_summary(snapshot: &ChannelSnapshot, entries: bool) -> Value {
    let state = &snapshot.state;
    let count = |field: &str| state[field].as_array().map_or(0, Vec::len);
    let mut summary = json!({
        "tenantId": snapshot.key.tenant_id,
        "channelId": snapshot.key.channel_id,
        "revision": snapshot.revision,
        "schemaVersion": state["schemaVersion"],
        "generation": state["generation"],
        "rotationNumber": state["rotationNumber"],
        "updatedAtMs": snapshot.updated_at_ms,
        "current": public_entry(&state["current"]),
        "queueCounts": {
            "upcoming": count("queue"),
            "playNext": count("priorityQueue"),
            "recycled": count("recycledQueue"),
            "nextRotation": count("nextRotationQueue"),
            "history": count("history")
        },
        "privateFieldsOmitted": true
    });
    if entries {
        for field in [
            "queue",
            "priorityQueue",
            "recycledQueue",
            "nextRotationQueue",
        ] {
            summary[field] = Value::Array(
                state[field]
                    .as_array()
                    .map(|items| items.iter().map(public_entry).collect())
                    .unwrap_or_default(),
            );
        }
    }
    summary
}

fn public_entry(entry: &Value) -> Value {
    let Some(entry) = entry.as_object() else {
        return Value::Null;
    };
    let mut safe = Map::new();
    for field in ["id", "videoId", "title", "position", "duration", "paused"] {
        if let Some(value) = entry.get(field) {
            safe.insert(field.into(), value.clone());
        }
    }
    Value::Object(safe)
}

fn ensure_separate_source(source: &Path, destination: &Path) -> Result<(), Box<dyn Error>> {
    let source_path = fs::canonicalize(source)?;
    let source_metadata = fs::metadata(&source_path)?;
    if !source_metadata.is_file() {
        return Err("migration source must be a regular JSON file".into());
    }
    // Protect the database and its SQLite sidecar filenames from aliasing the
    // supplied source. On Unix also detect hard links, not just symlinks.
    let mut destinations = vec![destination.to_path_buf()];
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut path = destination.as_os_str().to_os_string();
        path.push(suffix);
        destinations.push(PathBuf::from(path));
    }
    for candidate in destinations {
        match fs::canonicalize(&candidate) {
            Ok(candidate) => {
                if candidate == source_path {
                    return Err(
                        "migration source must not be the destination database or a SQLite sidecar"
                            .into(),
                    );
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    let metadata = fs::metadata(candidate)?;
                    if metadata.dev() == source_metadata.dev()
                        && metadata.ino() == source_metadata.ino()
                    {
                        return Err("migration source and destination must not be hard links to the same file".into());
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
