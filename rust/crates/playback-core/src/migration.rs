use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{CoreError, EngineState, CORE_SCHEMA_VERSION};

/// An operator-private migration result. `source` is the unmodified parsed
/// input and may contain private integration settings or viewer identifiers.
/// Back it up privately; never return it from a public channel endpoint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub state: EngineState,
    pub source: Value,
    pub warnings: Vec<String>,
}

/// Import a Playback v1.2.3 (schema 2) save without advancing media or voting
/// time. Existing IDs, all four queue lanes, history and settings are retained.
///
/// Unknown fields remain in the appropriate `extra` maps. The complete parsed
/// source is also returned separately for an explicit private backup. Invalid
/// or over-capacity queues fail as a whole rather than dropping entries.
pub fn import_v123(source: Value, now_ms: u64) -> Result<ImportReport, CoreError> {
    let original = source
        .as_object()
        .ok_or_else(|| CoreError::InvalidState("legacy state must be an object".into()))?;
    if original.get("schemaVersion").and_then(Value::as_u64) != Some(2) {
        return Err(CoreError::UnsupportedLegacySchema);
    }
    let mut warnings = Vec::new();
    let default = serde_json::to_value(EngineState::new(now_ms))
        .map_err(|error| CoreError::InvalidState(error.to_string()))?;
    let mut native = default
        .as_object()
        .expect("EngineState serializes as an object")
        .clone();
    native.extend(original.clone());
    native.insert("schemaVersion".into(), Value::from(CORE_SCHEMA_VERSION));
    // Generation survives import, but the new output must establish its own
    // authenticated observation sequence. No legacy timer is extrapolated.
    native.insert("lastObservation".into(), Value::Null);
    if original.contains_key("lastObservation") {
        warnings.push("An unknown legacy lastObservation field was retained in the source backup, not trusted as a native output observation.".into());
    }
    for key in ["revision", "layoutRevision", "rotationNumber", "generation"] {
        if !native
            .get(key)
            .and_then(Value::as_u64)
            .is_some_and(|value| value > 0)
        {
            warnings.push(format!("Invalid {key} was initialized to 1; its original value remains in the source backup."));
            native.insert(key.into(), Value::from(1));
        }
    }
    if let Some(current) = native.get_mut("current") {
        if !current.is_null() {
            normalize_entry(current, "current", 0, &mut warnings)?;
        }
    }
    for lane in [
        "queue",
        "priorityQueue",
        "recycledQueue",
        "nextRotationQueue",
        "history",
    ] {
        let entries = native
            .get_mut(lane)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| CoreError::InvalidState(format!("{lane} must be an array")))?;
        for (index, entry) in entries.iter_mut().enumerate() {
            normalize_entry(entry, lane, index, &mut warnings)?;
            if lane == "history" {
                let item = entry.as_object_mut().expect("entry was checked");
                if !item.contains_key("reason") {
                    let unavailable = item
                        .get("unavailable")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    item.insert(
                        "reason".into(),
                        Value::from(if unavailable {
                            "unavailable"
                        } else {
                            "completed"
                        }),
                    );
                    warnings.push(format!("history[{index}] had no completion reason; a conservative default was assigned."));
                }
                if !item.contains_key("playedAt") {
                    let stamp = item
                        .get("lastPlayedAt")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_owned();
                    item.insert("playedAt".into(), Value::from(stamp));
                }
                if !item.contains_key("rotationNumber") {
                    let rotation = item
                        .get("lastPlayedRotation")
                        .and_then(Value::as_u64)
                        .filter(|value| *value > 0)
                        .unwrap_or(1);
                    item.insert("rotationNumber".into(), Value::from(rotation));
                }
            }
        }
    }
    if let Some(audio) = native.get_mut("audio").and_then(Value::as_object_mut) {
        if audio.get("volume").and_then(Value::as_u64) == Some(0) {
            audio.insert("muted".into(), Value::Bool(true));
        }
    }
    let state: EngineState = serde_json::from_value(Value::Object(native))
        .map_err(|error| CoreError::InvalidState(format!("schema-2 import failed: {error}")))?;
    state.validate()?;
    if !state.suggestions.is_empty() {
        warnings.push("The suggestion inbox was preserved; suggestion moderation and provider integrations are not implemented by this core.".into());
    }
    Ok(ImportReport {
        state,
        source,
        warnings,
    })
}

fn normalize_entry(
    value: &mut Value,
    lane: &str,
    index: usize,
    warnings: &mut Vec<String>,
) -> Result<(), CoreError> {
    let item: &mut Map<String, Value> = value.as_object_mut().ok_or_else(|| {
        CoreError::InvalidState(format!("{lane}[{index}] must be an entry object"))
    })?;
    let video_id = item
        .get("videoId")
        .and_then(Value::as_str)
        .ok_or_else(|| CoreError::InvalidState(format!("{lane}[{index}] has no videoId")))?
        .to_owned();
    if !item.contains_key("id") || item.get("id").is_some_and(Value::is_null) {
        // Stable for the same source snapshot and independent of wall time.
        let id = format!("import-{lane}-{index}-{video_id}");
        item.insert("id".into(), Value::from(id));
        warnings.push(format!(
            "{lane}[{index}] had no entry ID; a deterministic import ID was assigned."
        ));
    }
    if !item.contains_key("title")
        || item.get("title").is_some_and(Value::is_null)
        || item
            .get("title")
            .and_then(Value::as_str)
            .is_some_and(|title| title.trim().is_empty())
    {
        item.insert("title".into(), Value::from(format!("YouTube · {video_id}")));
        warnings.push(format!(
            "{lane}[{index}] had no title; a video-ID placeholder was assigned."
        ));
    }
    Ok(())
}
