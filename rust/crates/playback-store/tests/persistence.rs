use playback_store::{ChannelKey, SnapshotChange, Store, StoreError};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::{Arc, Barrier};
use tempfile::tempdir;

fn key() -> ChannelKey {
    ChannelKey::new("tenant-a", "archive")
}

fn initial() -> Value {
    json!({"revision": 1, "position": 123.5, "queue": ["2019", "2025"], "counter": 0})
}

fn advance(state: &Value) -> Result<SnapshotChange, String> {
    let mut next = state.clone();
    next["revision"] = json!(state["revision"].as_u64().unwrap() + 1);
    next["counter"] = json!(state["counter"].as_u64().unwrap() + 1);
    Ok(SnapshotChange {
        state: next,
        changed: true,
        result: json!({"accepted": true}),
    })
}

#[test]
fn exact_retry_survives_reopen_and_returns_original_revision() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("playback.sqlite3");
    let request = json!({"action": "skip", "extra": {"a": 1, "b": 2}});
    {
        let mut store = Store::open(&path).unwrap();
        store.create_channel(&key(), &initial(), 10).unwrap();
        let first = store
            .apply_command(&key(), "first", 1, &request, 20, advance)
            .unwrap();
        assert_eq!(first.revision, 2);
        assert!(!first.replayed);
        store
            .apply_command(&key(), "second", 2, &json!({"action": "skip"}), 30, advance)
            .unwrap();
    }
    let mut reopened = Store::open(&path).unwrap();
    // JSON object key order is irrelevant; this is the same request.
    let reordered = serde_json::from_str(r#"{"extra":{"b":2,"a":1},"action":"skip"}"#).unwrap();
    let retry = reopened
        .apply_command(&key(), "first", 1, &reordered, 40, |_| {
            panic!("retry applied twice")
        })
        .unwrap();
    assert!(retry.replayed);
    assert_eq!(retry.revision, 2);
    assert_eq!(retry.result, json!({"accepted": true}));
    let current = reopened.load_channel(&key()).unwrap();
    assert_eq!(current.revision, 3);
    assert_eq!(current.state["counter"], 2);
    assert_eq!(current.state["position"], 123.5);
    assert_eq!(current.updated_at_ms, 30);
}

#[test]
fn mismatched_command_id_and_stale_revision_do_not_mutate_data() {
    let mut store = Store::open_in_memory().unwrap();
    store.create_channel(&key(), &initial(), 10).unwrap();
    store
        .apply_command(&key(), "one", 1, &json!({"action": "skip"}), 20, advance)
        .unwrap();
    let before = store.load_channel(&key()).unwrap();

    for (expected, request) in [
        (1, json!({"action": "remove"})),
        (2, json!({"action": "skip"})),
    ] {
        let error = store
            .apply_command(&key(), "one", expected, &request, 30, |_| {
                panic!("mismatch applied")
            })
            .unwrap_err();
        assert!(matches!(error, StoreError::CommandMismatch));
    }
    let error = store
        .apply_command(&key(), "two", 1, &json!({"action": "skip"}), 30, |_| {
            panic!("conflict applied")
        })
        .unwrap_err();
    assert!(matches!(
        error,
        StoreError::Conflict {
            expected: 1,
            actual: 2
        }
    ));
    assert_eq!(store.load_channel(&key()).unwrap(), before);
    // A conflict does not consume the new command ID.
    store
        .apply_command(&key(), "two", 2, &json!({"action": "skip"}), 40, advance)
        .unwrap();
    assert_eq!(store.load_channel(&key()).unwrap().revision, 3);
}

#[test]
fn receipt_write_failure_rolls_back_snapshot_update() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("playback.sqlite3");
    let mut store = Store::open(&path).unwrap();
    store.create_channel(&key(), &initial(), 10).unwrap();
    let before = store.load_channel(&key()).unwrap();
    {
        let injection = Connection::open(&path).unwrap();
        injection
            .execute_batch(
                "CREATE TRIGGER fail_receipt BEFORE INSERT ON command_receipts
             WHEN NEW.command_id = 'fail' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
            )
            .unwrap();
    }
    let result = store.apply_command(&key(), "fail", 1, &json!({"action": "skip"}), 20, advance);
    assert!(matches!(result, Err(StoreError::Database(_))));
    drop(store);

    let mut reopened = Store::open(&path).unwrap();
    assert_eq!(reopened.load_channel(&key()).unwrap(), before);
    {
        let injection = Connection::open(&path).unwrap();
        injection
            .execute_batch("DROP TRIGGER fail_receipt;")
            .unwrap();
    }
    let retry = reopened
        .apply_command(&key(), "fail", 1, &json!({"action": "skip"}), 30, advance)
        .unwrap();
    assert!(!retry.replayed);
    assert_eq!(retry.revision, 2);
}

#[test]
fn namespace_separates_snapshots_and_command_ids() {
    let mut store = Store::open_in_memory().unwrap();
    let keys = [
        key(),
        ChannelKey::new("tenant-b", "archive"),
        ChannelKey::new("tenant-a", "other"),
    ];
    for key in &keys {
        store.create_channel(key, &initial(), 10).unwrap();
    }
    store
        .apply_command(
            &keys[0],
            "shared-id",
            1,
            &json!({"action": "skip"}),
            20,
            advance,
        )
        .unwrap();
    assert_eq!(store.load_channel(&keys[1]).unwrap().revision, 1);
    assert_eq!(store.load_channel(&keys[2]).unwrap().revision, 1);
    for key in &keys[1..] {
        let receipt = store
            .apply_command(
                key,
                "shared-id",
                1,
                &json!({"action": "other"}),
                30,
                advance,
            )
            .unwrap();
        assert!(!receipt.replayed);
    }
    assert!(matches!(
        store.load_channel(&ChannelKey::new("absent", "archive")),
        Err(StoreError::NotFound)
    ));
}

#[test]
fn no_op_receipt_is_durable_without_touching_snapshot() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("playback.sqlite3");
    let mut store = Store::open(&path).unwrap();
    store.create_channel(&key(), &initial(), 10).unwrap();
    let before = store.load_channel(&key()).unwrap();
    let request = json!({"action": "ended", "generation": 0});
    let receipt = store
        .apply_command(&key(), "stale-event", 1, &request, 20, |state| {
            Ok(SnapshotChange {
                state: state.clone(),
                changed: false,
                result: json!({"ignored": "stale_generation"}),
            })
        })
        .unwrap();
    assert_eq!(receipt.revision, 1);
    assert!(!receipt.changed);
    assert_eq!(store.load_channel(&key()).unwrap(), before);
    drop(store);
    let mut reopened = Store::open(&path).unwrap();
    let replay = reopened
        .apply_command(&key(), "stale-event", 1, &request, 30, |_| {
            panic!("replayed no-op")
        })
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.result, receipt.result);
    assert_eq!(reopened.load_channel(&key()).unwrap(), before);
}

#[test]
fn invalid_transitions_and_duplicate_initialization_leave_state_untouched() {
    let mut store = Store::open_in_memory().unwrap();
    store.create_channel(&key(), &initial(), 10).unwrap();
    let before = store.load_channel(&key()).unwrap();
    assert!(matches!(
        store.create_channel(&key(), &json!({"revision": 99}), 20),
        Err(StoreError::AlreadyExists)
    ));
    let rejected = store.apply_command(&key(), "bad", 1, &json!({}), 30, |_| {
        Err("invalid entry".into())
    });
    assert!(matches!(rejected, Err(StoreError::Rejected(_))));
    let changed_no_op = store.apply_command(&key(), "bad", 1, &json!({}), 30, |state| {
        let mut next = state.clone();
        next["counter"] = json!(7);
        Ok(SnapshotChange {
            state: next,
            changed: false,
            result: Value::Null,
        })
    });
    assert!(matches!(
        changed_no_op,
        Err(StoreError::UnchangedStateModified)
    ));
    let invalid_revision = store.apply_command(&key(), "bad", 1, &json!({}), 30, |state| {
        Ok(SnapshotChange {
            state: state.clone(),
            changed: true,
            result: Value::Null,
        })
    });
    assert!(matches!(
        invalid_revision,
        Err(StoreError::SnapshotRevisionMismatch { .. })
    ));
    assert_eq!(store.load_channel(&key()).unwrap(), before);
    store
        .apply_command(&key(), "bad", 1, &json!({}), 40, advance)
        .unwrap();
}

#[test]
fn simultaneous_writers_cannot_both_commit_the_same_revision() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("playback.sqlite3");
    let mut first = Store::open(&path).unwrap();
    first.create_channel(&key(), &initial(), 10).unwrap();
    let mut second = Store::open(&path).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let first_barrier = Arc::clone(&barrier);
    let a = std::thread::spawn(move || {
        first_barrier.wait();
        first.apply_command(&key(), "a", 1, &json!({"action": "skip"}), 20, advance)
    });
    let b = std::thread::spawn(move || {
        barrier.wait();
        second.apply_command(&key(), "b", 1, &json!({"action": "skip"}), 20, advance)
    });
    let results = [a.join().unwrap(), b.join().unwrap()];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(StoreError::Conflict { .. })))
            .count(),
        1
    );
    let state = Store::open(&path).unwrap().load_channel(&key()).unwrap();
    assert_eq!(state.revision, 2);
    assert_eq!(state.state["counter"], 1);
}

#[test]
fn committed_transaction_survives_exit_without_destructors() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("playback.sqlite3");
    {
        let mut store = Store::open(&path).unwrap();
        store.create_channel(&key(), &initial(), 10).unwrap();
    }
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "abrupt_exit_child", "--ignored"])
        .env("PLAYBACK_STORE_CHILD_DATABASE", &path)
        .status()
        .unwrap();
    assert!(status.success());
    let mut reopened = Store::open(&path).unwrap();
    assert_eq!(reopened.load_channel(&key()).unwrap().revision, 2);
    let receipt = reopened
        .apply_command(&key(), "abrupt", 1, &json!({"action": "skip"}), 30, |_| {
            panic!("lost receipt")
        })
        .unwrap();
    assert!(receipt.replayed);
}

#[test]
#[ignore = "subprocess helper called by committed_transaction_survives_exit_without_destructors"]
fn abrupt_exit_child() {
    let path = std::env::var_os("PLAYBACK_STORE_CHILD_DATABASE").expect("child database path");
    let mut store = Store::open(path).unwrap();
    store
        .apply_command(&key(), "abrupt", 1, &json!({"action": "skip"}), 20, advance)
        .unwrap();
    // std::process::exit skips the Store/Connection destructors: recovery must
    // read the committed WAL instead of depending on a clean SQLite close.
    std::process::exit(0);
}

#[cfg(unix)]
#[test]
fn new_database_is_private_on_unix() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempdir().unwrap();
    let path = directory.path().join("playback.sqlite3");
    let _store = Store::open(&path).unwrap();
    assert_eq!(
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn durable_open_rejects_in_memory_and_uri_database_names() {
    for path in [":memory:", "file:temporary?mode=memory", ""] {
        assert!(matches!(
            Store::open(path),
            Err(StoreError::InvalidDatabasePath)
        ));
    }
}
