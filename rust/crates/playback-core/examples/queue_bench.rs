//! In-memory benchmark companion to verification/queue-bench.mjs.
//!
//! Build with `cargo build --release --locked -p playback-core --example queue_bench`.
//! The Node driver supplies the same synthetic legacy fixture to both engines.
//! Fixture import, warmup, public projection and JSON I/O are outside the timer.
//! This measures the existing validated, snapshot-cloning transition API; it
//! neither bypasses its checks nor includes durable storage or media processing.

use std::{error::Error, hint::black_box, io, time::Instant};

use playback_core::{import_v123, Command, EngineState, Entry};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    fixture: Value,
    start_ms: u64,
    warmup: u64,
    iterations: u64,
}

fn main() -> Result<(), Box<dyn Error>> {
    let request: Request = serde_json::from_reader(io::stdin().lock())?;
    if request.iterations == 0 || request.warmup == 0 {
        return Err("warmup and iterations must both be positive".into());
    }
    request
        .start_ms
        .checked_add(request.warmup)
        .and_then(|now| now.checked_add(request.iterations))
        .ok_or("benchmark timestamp overflow")?;

    let imported = import_v123(request.fixture, request.start_ms)?;
    if !imported.warnings.is_empty() {
        return Err("the benchmark fixture must import without migration warnings".into());
    }
    let mut state = imported.state;
    // The source backup is intentionally not retained during the timed work.
    drop(imported.source);
    if !state.settings.loop_enabled
        || state.settings.vote_on_end
        || state.settings.skip_voting
        || state.current.is_none()
        || state.vote.is_some()
    {
        return Err("the benchmark requires a current entry, looping and disabled votes".into());
    }
    let entries = state.stored_count();

    for step in 1..=request.warmup {
        state = state
            .transition(Command::Skip, request.start_ms + step)?
            .state;
    }

    let started = Instant::now();
    for step in 1..=request.iterations {
        state = state
            .transition(
                Command::Skip,
                black_box(request.start_ms + request.warmup + step),
            )?
            .state;
    }
    let elapsed_ns = u64::try_from(started.elapsed().as_nanos())?;
    black_box(&state);

    let output = json!({
        "entries": entries,
        "warmup": request.warmup,
        "iterations": request.iterations,
        "elapsedNs": elapsed_ns,
        "debugAssertions": cfg!(debug_assertions),
        "architecture": std::env::consts::ARCH,
        "platform": std::env::consts::OS,
        "projection": public_projection(&state),
    });
    serde_json::to_writer(io::stdout().lock(), &output)?;
    Ok(())
}

fn public_entry(entry: &Entry) -> Value {
    json!({
        "id": entry.id,
        "videoId": entry.video_id,
        "title": entry.title,
        "position": entry.position,
        "duration": entry.duration,
        "paused": entry.paused,
        "playCount": entry.play_count,
        "addedAt": entry.added_at,
        "publishedAt": entry.published_at,
        "lastPlayedAt": entry.last_played_at,
        "lastPlayedRotation": entry.last_played_rotation,
    })
}

fn public_projection(state: &EngineState) -> Value {
    json!({
        "revision": state.revision,
        "layoutRevision": state.layout_revision,
        "generation": state.generation,
        "rotationNumber": state.rotation_number,
        "current": state.current.as_ref().map(public_entry),
        "queue": state.queue.iter().map(public_entry).collect::<Vec<_>>(),
        "priorityQueue": state.priority_queue.iter().map(public_entry).collect::<Vec<_>>(),
        "recycledQueue": state.recycled_queue.iter().map(public_entry).collect::<Vec<_>>(),
        "nextRotationQueue": state.next_rotation_queue.iter().map(public_entry).collect::<Vec<_>>(),
        "historyCount": state.history.len(),
        "vote": state.vote.as_ref().map(|_| "unexpected active vote"),
        "skipCount": state.skip_ballots.len(),
        "settings": {
            "loop": state.settings.loop_enabled,
            "voteOnEnd": state.settings.vote_on_end,
            "skipVoting": state.settings.skip_voting,
        },
        "audio": { "volume": state.audio.volume, "muted": state.audio.muted },
    })
}
