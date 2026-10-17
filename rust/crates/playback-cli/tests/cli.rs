use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};
use tempfile::tempdir;

fn run(db: &Path, arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_playback"))
        .arg("--db")
        .arg(db)
        .args(["--tenant", "demo", "--channel", "archive"])
        .args(arguments)
        .output()
        .unwrap()
}

fn success(output: Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../fixtures/v1.2.3-sanitized.json")).unwrap()
}

#[test]
fn import_preserves_source_and_omits_private_fields_from_all_default_output() {
    let directory = tempdir().unwrap();
    let db = directory.path().join("playback.sqlite3");
    let source = directory.path().join("state-copy.json");
    let mut raw = fixture();
    raw["settings"]["privateToken"] = json!("synthetic-do-not-print-secret");
    raw["current"]["privateSourceToken"] = json!("synthetic-do-not-print-secret");
    raw["unknownLegacyCredential"] = json!("synthetic-do-not-print-secret");
    let original = serde_json::to_vec_pretty(&raw).unwrap();
    fs::write(&source, &original).unwrap();

    let imported = success(run(
        &db,
        &["import-v123", "--source", source.to_str().unwrap()],
    ));
    assert_eq!(imported["status"], "imported");
    assert_eq!(imported["sourceModified"], false);
    assert_eq!(imported["state"]["revision"], 13);
    assert_eq!(imported["state"]["current"]["position"], 1234.5);
    assert_eq!(imported["state"]["current"]["paused"], true);
    assert_eq!(imported["state"]["queueCounts"]["recycled"], 2);
    assert!(!imported
        .to_string()
        .contains("synthetic-do-not-print-secret"));
    assert_eq!(fs::read(&source).unwrap(), original);

    let shown = success(run(&db, &["show", "--entries"]));
    assert_eq!(shown["queue"][1]["title"], "Newly imported 2022");
    assert_eq!(shown["priorityQueue"][0]["title"], "Pinned next");
    assert!(shown.get("settings").is_none());
    assert!(!shown.to_string().contains("synthetic-do-not-print-secret"));
    assert!(!directory
        .path()
        .join("state.before-migration.json")
        .exists());
}

#[test]
fn command_ids_are_durable_across_cli_processes() {
    let directory = tempdir().unwrap();
    let db = directory.path().join("playback.sqlite3");
    let source = directory.path().join("state-copy.json");
    fs::write(&source, serde_json::to_vec(&fixture()).unwrap()).unwrap();
    success(run(
        &db,
        &["import-v123", "--source", source.to_str().unwrap()],
    ));
    let skip = [
        "apply",
        "--command-id",
        "skip-one",
        "--expected-revision",
        "13",
        "--command",
        r#"{"action":"skip"}"#,
    ];
    let applied = success(run(&db, &skip));
    assert_eq!(applied["revision"], 14);
    assert_eq!(applied["replayed"], false);
    let replayed = success(run(&db, &skip));
    assert_eq!(replayed["revision"], 14);
    assert_eq!(replayed["replayed"], true);
    let shown = success(run(&db, &["state"]));
    assert_eq!(shown["current"]["title"], "Pinned next");
    assert_eq!(shown["revision"], 14);

    let mismatch = run(
        &db,
        &[
            "apply",
            "--command-id",
            "skip-one",
            "--expected-revision",
            "13",
            "--command",
            r#"{"action":"pause","paused":true}"#,
        ],
    );
    assert!(!mismatch.status.success());
    assert!(String::from_utf8_lossy(&mismatch.stderr).contains("command_id was already used"));
    let conflict = run(
        &db,
        &[
            "apply",
            "--command-id",
            "skip-two",
            "--expected-revision",
            "13",
            "--command",
            r#"{"action":"skip"}"#,
        ],
    );
    assert!(!conflict.status.success());
    assert!(String::from_utf8_lossy(&conflict.stderr).contains("revision conflict"));
    assert_eq!(success(run(&db, &["state"])), shown);
}

#[test]
fn initialization_and_import_never_replace_existing_channel() {
    let directory = tempdir().unwrap();
    let db = directory.path().join("playback.sqlite3");
    let source = directory.path().join("state-copy.json");
    fs::write(&source, serde_json::to_vec(&fixture()).unwrap()).unwrap();
    let initialized = success(run(&db, &["init"]));
    assert_eq!(initialized["state"]["revision"], 1);
    assert!(!run(&db, &["init"]).status.success());
    assert!(
        !run(&db, &["import-v123", "--source", source.to_str().unwrap()])
            .status
            .success()
    );
    assert_eq!(success(run(&db, &["show"])), initialized["state"]);
}

#[test]
fn source_cannot_be_the_destination_and_missing_show_does_not_create_a_database() {
    let directory = tempdir().unwrap();
    let source = directory.path().join("state.json");
    let original = serde_json::to_vec(&fixture()).unwrap();
    fs::write(&source, &original).unwrap();
    let error = run(
        &source,
        &["import-v123", "--source", source.to_str().unwrap()],
    );
    assert!(!error.status.success());
    assert!(String::from_utf8_lossy(&error.stderr).contains("must not be the destination"));
    assert_eq!(fs::read(&source).unwrap(), original);

    let missing = directory.path().join("missing.sqlite3");
    assert!(!run(&missing, &["show"]).status.success());
    assert!(!missing.exists());
}

#[cfg(unix)]
#[test]
fn source_hard_link_is_rejected_without_modification() {
    let directory = tempdir().unwrap();
    let source = directory.path().join("state.json");
    let destination = directory.path().join("alias.sqlite3");
    let original = serde_json::to_vec(&fixture()).unwrap();
    fs::write(&source, &original).unwrap();
    fs::hard_link(&source, &destination).unwrap();
    assert!(!run(
        &destination,
        &["import-v123", "--source", source.to_str().unwrap()]
    )
    .status
    .success());
    assert_eq!(fs::read(&source).unwrap(), original);
}
