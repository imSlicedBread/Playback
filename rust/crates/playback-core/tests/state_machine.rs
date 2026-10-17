use playback_core::{
    import_v123, Command, CompletionReason, CoreError, Destination, EngineState, Entry,
    IgnoreReason, ObservedState, PlaylistOrder, CORE_SCHEMA_VERSION, MAX_HISTORY, MAX_QUEUE,
};
use serde_json::{json, Value};

const VIDEO_IDS: [&str; 7] = [
    "dQw4w9WgXcQ",
    "jNQXAC9IVRw",
    "aqz-KE-bpKQ",
    "M7lc1UVf-VE",
    "jfKfPfyJRdk",
    "LXb3EKWsInQ",
    "4WXs3sKu41I",
];

fn entry(id: &str, video: usize) -> Entry {
    Entry::new(id, VIDEO_IDS[video], format!("Video {video}")).unwrap()
}

fn direct_state() -> EngineState {
    let mut state = EngineState::new(1_000_000);
    state.settings.vote_on_end = false;
    state
}

fn apply(state: &mut EngineState, command: Command) {
    *state = state.transition(command, 1_005_000).unwrap().state;
}

fn add(state: &mut EngineState, id: &str, video: usize, destination: Destination) {
    apply(
        state,
        Command::Add {
            entry: entry(id, video),
            destination,
        },
    );
}

fn current_id(state: &EngineState) -> Option<&str> {
    state.current.as_ref().map(|entry| entry.id.as_str())
}

fn ids(entries: &[Entry]) -> Vec<&str> {
    entries.iter().map(|entry| entry.id.as_str()).collect()
}

fn checkpoint(
    state: &EngineState,
    sequence: u64,
    position: f64,
    observed_state: ObservedState,
) -> Command {
    Command::Checkpoint {
        generation: state.generation,
        entry_id: state.current.as_ref().unwrap().id.clone(),
        sequence,
        position,
        duration: Some(3_600.0),
        observed_state,
    }
}

fn saved_source() -> Value {
    serde_json::from_str(include_str!("../../../fixtures/v1.2.3-sanitized.json")).unwrap()
}

#[test]
fn newly_added_archived_content_finishes_the_current_rotation_before_recycled_items() {
    let mut state = direct_state();
    add(&mut state, "2019", 0, Destination::Current);
    add(&mut state, "2024", 1, Destination::Current);
    add(&mut state, "2025", 2, Destination::Current);
    apply(&mut state, Command::Skip);
    apply(&mut state, Command::Skip);
    assert_eq!(current_id(&state), Some("2025"));
    assert_eq!(ids(&state.recycled_queue), ["2019", "2024"]);

    add(&mut state, "new-2022", 3, Destination::Current);
    let generation = state.generation;
    apply(
        &mut state,
        Command::Ended {
            generation,
            entry_id: "2025".into(),
        },
    );
    assert_eq!(current_id(&state), Some("new-2022"));
    assert_eq!(state.rotation_number, 1);
    assert_eq!(ids(&state.recycled_queue), ["2019", "2024", "2025"]);
    apply(&mut state, Command::Skip);
    assert_eq!(current_id(&state), Some("2019"));
    assert_eq!(state.rotation_number, 2);
}

#[test]
fn priority_is_fifo_and_deferred_new_entries_lead_the_next_rotation() {
    let mut state = direct_state();
    add(&mut state, "a", 0, Destination::Current);
    add(&mut state, "b", 1, Destination::Current);
    add(&mut state, "future", 2, Destination::NextRotation);
    add(&mut state, "pin-one", 3, Destination::PlayNext);
    add(&mut state, "pin-two", 4, Destination::PlayNext);
    for expected in ["pin-one", "pin-two", "b", "future"] {
        apply(&mut state, Command::Skip);
        assert_eq!(current_id(&state), Some(expected));
    }
    assert_eq!(state.rotation_number, 2);
    assert_eq!(ids(&state.queue), ["a", "pin-one", "pin-two", "b"]);
    assert!(state.next_rotation_queue.is_empty());
    assert!(state.recycled_queue.is_empty());
}

#[test]
fn end_voting_preserves_v123_rollover_before_consuming_current() {
    let mut state = EngineState::new(0);
    add(&mut state, "a", 0, Destination::Current);
    add(&mut state, "b", 1, Destination::Current);
    apply(&mut state, Command::Skip);
    add(&mut state, "c", 2, Destination::Current);
    apply(&mut state, Command::Skip);
    let generation = state.generation;
    apply(
        &mut state,
        Command::Ended {
            generation,
            entry_id: "c".into(),
        },
    );

    assert_eq!(current_id(&state), Some("c"));
    assert!(state.current.as_ref().unwrap().paused);
    assert_eq!(state.rotation_number, 2);
    assert_eq!(ids(&state.queue), ["a", "b"]);
    assert!(state.recycled_queue.is_empty());
    assert_eq!(
        state.vote.as_ref().unwrap().choices,
        [Some("a".into()), Some("b".into())]
    );
    let ignored = state
        .transition(
            Command::Ended {
                generation,
                entry_id: "c".into(),
            },
            9_000_000,
        )
        .unwrap();
    assert!(!ignored.changed);
    assert_eq!(ignored.ignored, Some(IgnoreReason::VoteActive));

    apply(&mut state, Command::Choose { index: 1 });
    assert_eq!(current_id(&state), Some("a"));
    assert_eq!(ids(&state.recycled_queue), ["c"]);
    assert_eq!(state.history.last().unwrap().rotation_number, 2);
    let restored: EngineState =
        serde_json::from_slice(&serde_json::to_vec(&state).unwrap()).unwrap();
    assert_eq!(restored, state);
    restored.validate().unwrap();
}

#[test]
fn play_now_parks_the_interrupted_entry_with_its_confirmed_position() {
    let mut state = direct_state();
    add(&mut state, "a", 0, Destination::Current);
    add(&mut state, "b", 1, Destination::Current);
    add(&mut state, "c", 2, Destination::Current);
    apply(&mut state, Command::Seek { position: 123.5 });
    apply(&mut state, Command::PlayNow { id: "c".into() });
    assert_eq!(current_id(&state), Some("c"));
    assert_eq!(ids(&state.priority_queue), ["a"]);
    assert_eq!(state.priority_queue[0].position, 123.5);
    assert!(state.history.is_empty());
    assert!(state.recycled_queue.is_empty());
    apply(&mut state, Command::Skip);
    assert_eq!(current_id(&state), Some("a"));
    assert_eq!(state.current.as_ref().unwrap().position, 123.5);
    assert_eq!(ids(&state.queue), ["b"]);
}

#[test]
fn add_now_also_preserves_current_and_does_not_accept_reused_entry_ids() {
    let mut state = direct_state();
    add(&mut state, "a", 0, Destination::Current);
    apply(&mut state, Command::Seek { position: 42.0 });
    let before = state.clone();
    assert!(matches!(
        state.transition(
            Command::AddNow {
                entry: entry("a", 1)
            },
            2_000
        ),
        Err(CoreError::DuplicateEntryId(_))
    ));
    assert_eq!(state, before);
    apply(
        &mut state,
        Command::AddNow {
            entry: entry("live-insert", 2),
        },
    );
    assert_eq!(current_id(&state), Some("live-insert"));
    assert_eq!(state.priority_queue[0].position, 42.0);
}

#[test]
fn unavailable_videos_are_quarantined_and_stale_errors_cannot_skip_the_next_video() {
    let mut state = direct_state();
    add(&mut state, "a", 0, Destination::Current);
    add(&mut state, "b", 1, Destination::Current);
    let failure = Command::Unavailable {
        generation: state.generation,
        entry_id: "a".into(),
    };
    apply(&mut state, failure.clone());
    assert_eq!(current_id(&state), Some("b"));
    assert!(state.recycled_queue.is_empty());
    assert!(state.history[0].unavailable);
    assert_eq!(state.history[0].reason, CompletionReason::Unavailable);
    assert_eq!(state.history[0].entry.play_count, 0);
    let stale = state.transition(failure, 2_000_000).unwrap();
    assert!(!stale.changed);
    let generation = state.generation;
    apply(
        &mut state,
        Command::Unavailable {
            generation,
            entry_id: "b".into(),
        },
    );
    assert!(state.current.is_none());
    assert!(state.recycled_queue.is_empty());
    assert_eq!(state.rotation_number, 1);
}

#[test]
fn nonlooping_channels_do_not_consume_deferred_entries_until_loop_is_enabled() {
    let mut state = direct_state();
    apply(&mut state, Command::SetLoop { enabled: false });
    add(&mut state, "a", 0, Destination::Current);
    add(&mut state, "deferred", 1, Destination::NextRotation);
    apply(&mut state, Command::Skip);
    assert!(state.current.is_none());
    assert_eq!(ids(&state.next_rotation_queue), ["deferred"]);
    assert!(state.recycled_queue.is_empty());
    apply(&mut state, Command::SetLoop { enabled: true });
    assert!(
        state.current.is_none(),
        "changing a setting does not implicitly issue Play"
    );
    apply(&mut state, Command::Skip);
    assert_eq!(current_id(&state), Some("deferred"));
    assert_eq!(state.rotation_number, 2);
}

#[test]
fn invalid_bulk_mutations_leave_every_lane_and_revision_unchanged() {
    let mut state = direct_state();
    for (id, video) in [("a", 0), ("b", 1), ("c", 2)] {
        add(&mut state, id, video, Destination::Current);
    }
    let before = state.clone();
    for command in [
        Command::MoveMany {
            ids: vec!["b".into(), "missing".into()],
            destination: Destination::NextRotation,
        },
        Command::MoveMany {
            ids: vec!["b".into(), "b".into()],
            destination: Destination::PlayNext,
        },
        Command::OrderUpcoming {
            ids: vec!["b".into(), "missing".into()],
        },
        Command::BulkAdd {
            entries: vec![entry("new", 3), entry("new", 4)],
            destination: Destination::Current,
        },
    ] {
        assert!(state.transition(command, 9_999_999).is_err());
        assert_eq!(state, before);
    }
    apply(
        &mut state,
        Command::MoveMany {
            ids: vec!["c".into(), "b".into()],
            destination: Destination::NextRotation,
        },
    );
    assert_eq!(ids(&state.next_rotation_queue), ["c", "b"]);
    assert!(state.queue.is_empty());
    assert_eq!(current_id(&state), Some("a"));
}

#[test]
fn imported_playlist_deduplicates_across_all_lanes_and_orders_only_the_new_batch() {
    let mut state = direct_state();
    add(&mut state, "old", 0, Destination::Current);
    add(&mut state, "active", 1, Destination::Current);
    apply(&mut state, Command::Skip);
    add(&mut state, "already-deferred", 2, Destination::NextRotation);
    let mut recent = entry("recent", 3);
    recent.published_at = Some("2025-01-01T00:00:00.000Z".into());
    let mut oldest = entry("oldest", 4);
    oldest.published_at = Some("2020-01-01T00:00:00.000Z".into());
    apply(
        &mut state,
        Command::ImportPlaylist {
            entries: vec![
                recent,
                entry("duplicate-recycled", 0),
                oldest,
                entry("duplicate-deferred", 2),
            ],
            destination: Destination::NextRotation,
            skip_duplicates: true,
            order: PlaylistOrder::Oldest,
        },
    );
    assert_eq!(
        ids(&state.next_rotation_queue),
        ["already-deferred", "oldest", "recent"]
    );
    assert_eq!(current_id(&state), Some("active"));
    assert_eq!(ids(&state.recycled_queue), ["old"]);
}

#[test]
fn repeated_video_ids_are_valid_when_queue_entry_ids_are_distinct() {
    let mut state = direct_state();
    add(&mut state, "first-occurrence", 0, Destination::Current);
    apply(
        &mut state,
        Command::ImportPlaylist {
            entries: vec![entry("second-occurrence", 0)],
            destination: Destination::Current,
            skip_duplicates: false,
            order: PlaylistOrder::Original,
        },
    );
    let old_generation = state.generation;
    apply(&mut state, Command::Skip);
    assert_eq!(current_id(&state), Some("second-occurrence"));
    for (generation, entry_id) in [
        (old_generation, "first-occurrence"),
        (state.generation, "first-occurrence"),
    ] {
        let result = state
            .transition(
                Command::Ended {
                    generation,
                    entry_id: entry_id.into(),
                },
                4_000,
            )
            .unwrap();
        assert!(!result.changed);
        assert_eq!(result.state, state);
    }
}

#[test]
fn capacity_includes_current_and_every_waiting_lane() {
    let mut state = direct_state();
    add(&mut state, "active", 0, Destination::Current);
    state.recycled_queue = (0..MAX_QUEUE - 1)
        .map(|index| entry(&format!("recycled-{index}"), 1))
        .collect();
    state.validate().unwrap();
    let before = state.clone();
    for destination in [
        Destination::Current,
        Destination::PlayNext,
        Destination::NextRotation,
    ] {
        assert_eq!(
            state.transition(
                Command::Add {
                    entry: entry("new", 2),
                    destination
                },
                7_000
            ),
            Err(CoreError::CapacityExceeded {
                requested: 1,
                available: 0
            })
        );
        assert_eq!(state, before);
    }
}

#[test]
fn checkpoints_survive_restart_without_consuming_offline_time_or_changing_desired_pause() {
    let mut state = direct_state();
    add(&mut state, "active", 0, Destination::Current);
    let observation = checkpoint(&state, 1, 84.25, ObservedState::Buffering);
    apply(&mut state, observation);
    assert!(!state.current.as_ref().unwrap().paused);
    assert_eq!(
        state.last_observation.as_ref().unwrap().observed_state,
        ObservedState::Buffering
    );
    apply(&mut state, Command::Pause { paused: true });
    let observation = checkpoint(&state, 1, 84.25, ObservedState::Paused);
    apply(&mut state, observation);
    let serialized = serde_json::to_vec(&state).unwrap();
    let restored: EngineState = serde_json::from_slice(&serialized).unwrap();
    assert_eq!(restored, state);
    let later = restored
        .transition(
            Command::SetAudio {
                volume: 42,
                muted: false,
            },
            365 * 86_400_000,
        )
        .unwrap();
    let current = later.state.current.unwrap();
    assert_eq!(current.position, 84.25);
    assert_eq!(current.duration, 3_600.0);
    assert!(current.paused);
}

#[test]
fn seek_invalidates_old_generation_and_observation_sequence_prevents_regression() {
    let mut state = direct_state();
    add(&mut state, "active", 0, Destination::Current);
    let stale = checkpoint(&state, 8, 4.0, ObservedState::Playing);
    apply(&mut state, Command::Seek { position: 500.0 });
    let result = state.transition(stale, 3_000).unwrap();
    assert_eq!(result.ignored, Some(IgnoreReason::StaleGeneration));
    assert_eq!(result.state, state);
    let newer = checkpoint(&state, 2, 501.0, ObservedState::Playing);
    apply(&mut state, newer);
    let older = checkpoint(&state, 1, 500.0, ObservedState::Playing);
    let result = state.transition(older, 4_000).unwrap();
    assert_eq!(result.ignored, Some(IgnoreReason::StaleObservation));
    assert!(!result.changed);
    assert_eq!(result.state.current.unwrap().position, 501.0);
}

#[test]
fn invalid_time_and_counter_overflow_never_partially_change_a_snapshot() {
    let mut state = direct_state();
    add(&mut state, "active", 0, Destination::Current);
    add(&mut state, "next", 1, Destination::Current);
    for position in [f64::NAN, f64::INFINITY, -1.0, 86_401.0] {
        assert_eq!(
            state.transition(Command::Seek { position }, 1),
            Err(CoreError::InvalidPosition)
        );
    }
    state.revision = u64::MAX;
    let before = state.clone();
    assert_eq!(
        state.transition(Command::Skip, 8_000),
        Err(CoreError::CounterOverflow)
    );
    assert_eq!(state, before);
}

#[test]
fn only_one_revision_is_consumed_and_noop_commands_preserve_snapshot_identity() {
    let mut state = direct_state();
    add(&mut state, "active", 0, Destination::Current);
    add(&mut state, "next", 1, Destination::Current);
    let revision = state.revision;
    let result = state.transition(Command::Skip, 12_345).unwrap();
    assert_eq!(result.state.revision, revision + 1);
    assert_eq!(
        state.revision, revision,
        "staging must not publish the candidate state"
    );
    let noop = state
        .transition(
            Command::SetAudio {
                volume: 100,
                muted: false,
            },
            999_999,
        )
        .unwrap();
    assert!(!noop.changed);
    assert_eq!(noop.state, state);
    assert_eq!(noop.ignored, Some(IgnoreReason::NoChange));
}

#[test]
fn moving_a_vote_candidate_out_of_playable_lanes_discards_its_ballots() {
    let mut state = EngineState::new(0);
    add(&mut state, "active", 0, Destination::Current);
    add(&mut state, "upcoming", 1, Destination::Current);
    add(&mut state, "priority", 2, Destination::PlayNext);
    apply(
        &mut state,
        Command::StartVote {
            vote_id: "round-one".into(),
        },
    );
    apply(
        &mut state,
        Command::VoteChoice {
            index: 1,
            viewer: "viewer".into(),
        },
    );
    assert_eq!(state.vote_counts(), [1, 0, 0, 0]);
    apply(
        &mut state,
        Command::Move {
            id: "priority".into(),
            destination: Destination::Recycled,
        },
    );
    assert_eq!(state.vote_counts(), [0, 0, 0, 0]);
    assert_eq!(state.vote.as_ref().unwrap().choices[0], None);
    apply(&mut state, Command::ConcludeVote);
    assert_eq!(current_id(&state), Some("upcoming"));
    assert_eq!(state.rotation_number, 1);
}

#[test]
fn changed_votes_and_zero_vote_ties_match_existing_selection_rules() {
    let mut state = EngineState::new(0);
    for (id, video) in [("active", 0), ("one", 1), ("two", 2)] {
        add(&mut state, id, video, Destination::Current);
    }
    apply(
        &mut state,
        Command::StartVote {
            vote_id: "one".into(),
        },
    );
    apply(
        &mut state,
        Command::VoteChoice {
            index: 1,
            viewer: "alice".into(),
        },
    );
    apply(
        &mut state,
        Command::VoteChoice {
            index: 2,
            viewer: "alice".into(),
        },
    );
    apply(
        &mut state,
        Command::VoteChoice {
            index: 2,
            viewer: "bob".into(),
        },
    );
    assert_eq!(state.vote_counts(), [0, 2, 0, 0]);
    apply(&mut state, Command::ConcludeVote);
    assert_eq!(current_id(&state), Some("two"));
    apply(
        &mut state,
        Command::StartVote {
            vote_id: "two".into(),
        },
    );
    apply(&mut state, Command::ConcludeVote);
    assert_eq!(current_id(&state), Some("one"));
}

#[test]
fn manual_vote_cancel_restores_position_and_prior_pause_state() {
    let mut state = EngineState::new(0);
    add(&mut state, "active", 0, Destination::Current);
    add(&mut state, "next", 1, Destination::Current);
    apply(&mut state, Command::Seek { position: 64.0 });
    for paused in [false, true] {
        apply(&mut state, Command::Pause { paused });
        apply(
            &mut state,
            Command::StartVote {
                vote_id: format!("round-{paused}"),
            },
        );
        assert!(state.current.as_ref().unwrap().paused);
        apply(&mut state, Command::CancelVote);
        assert_eq!(state.current.as_ref().unwrap().paused, paused);
        assert_eq!(state.current.as_ref().unwrap().position, 64.0);
    }
}

#[test]
fn skip_ballots_deduplicate_and_owner_skip_remains_unrestricted() {
    let mut state = direct_state();
    add(&mut state, "active", 0, Destination::Current);
    add(&mut state, "next", 1, Destination::Current);
    apply(
        &mut state,
        Command::SkipVote {
            viewer: "alice".into(),
        },
    );
    apply(
        &mut state,
        Command::SkipVote {
            viewer: "alice".into(),
        },
    );
    assert_eq!(state.skip_ballots.len(), 1);
    apply(
        &mut state,
        Command::SkipVote {
            viewer: "bob".into(),
        },
    );
    apply(
        &mut state,
        Command::SkipVote {
            viewer: "charlie".into(),
        },
    );
    assert_eq!(current_id(&state), Some("next"));
    assert!(state.skip_ballots.is_empty());
    state.settings.skip_voting = false;
    assert!(matches!(
        state.transition(
            Command::SkipVote {
                viewer: "alice".into()
            },
            0
        ),
        Err(CoreError::SkipVotingDisabled)
    ));
    apply(&mut state, Command::Skip);
    assert_eq!(current_id(&state), Some("active"));
}

#[test]
fn previous_after_a_single_item_loop_does_not_duplicate_the_stable_entry_id() {
    let mut state = direct_state();
    add(&mut state, "only", 0, Destination::Current);
    apply(&mut state, Command::Skip);
    apply(&mut state, Command::Previous);
    assert_eq!(current_id(&state), Some("only"));
    assert_eq!(state.stored_count(), 1);
    assert!(state.priority_queue.is_empty());
    state.validate().unwrap();
}

#[test]
fn long_running_rotation_history_is_bounded_without_losing_the_active_entry() {
    let mut state = direct_state();
    add(&mut state, "only", 0, Destination::Current);
    for _ in 0..MAX_HISTORY + 5 {
        apply(&mut state, Command::Skip);
    }
    assert_eq!(state.history.len(), MAX_HISTORY);
    assert_eq!(current_id(&state), Some("only"));
    assert_eq!(
        state.current.as_ref().unwrap().play_count as usize,
        MAX_HISTORY + 5
    );
    assert_eq!(state.stored_count(), 1);
}

#[test]
fn schema_two_import_preserves_ids_lanes_progress_settings_and_full_original_source() {
    let mut source = saved_source();
    source["privateFutureSetting"] = json!({"opaque": "preserved"});
    source["current"]["providerMetadata"] = json!({"fixture": true});
    let report = import_v123(source.clone(), 999_999_999_999).unwrap();
    assert_eq!(report.source, source);
    assert_eq!(report.state.schema_version, CORE_SCHEMA_VERSION);
    assert_eq!(report.state.revision, source["revision"].as_u64().unwrap());
    assert_eq!(
        report.state.generation,
        source["generation"].as_u64().unwrap()
    );
    assert_eq!(report.state.current.as_ref().unwrap().position, 1234.5);
    assert!(report.state.current.as_ref().unwrap().paused);
    assert_eq!(
        report.state.current.as_ref().unwrap().extra["providerMetadata"],
        json!({"fixture":true})
    );
    assert_eq!(
        report.state.extra["privateFutureSetting"],
        source["privateFutureSetting"]
    );
    assert_eq!(
        serde_json::to_value(&report.state.settings).unwrap(),
        source["settings"]
    );
    assert_eq!(report.state.settings.extra["lowerThird"]["height"], 20);
    assert_eq!(
        report.state.settings.extra["lowerThird"]["backgroundOpacity"],
        54
    );
    assert_eq!(report.state.queue.len(), 2);
    assert_eq!(report.state.priority_queue.len(), 1);
    assert_eq!(report.state.recycled_queue.len(), 2);
    assert_eq!(report.state.next_rotation_queue.len(), 1);
    for (lane, entries) in [
        ("queue", &report.state.queue),
        ("priorityQueue", &report.state.priority_queue),
        ("recycledQueue", &report.state.recycled_queue),
        ("nextRotationQueue", &report.state.next_rotation_queue),
    ] {
        assert_eq!(
            ids(entries),
            source[lane]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value["id"].as_str().unwrap())
                .collect::<Vec<_>>()
        );
    }
    let restored: EngineState =
        serde_json::from_value(serde_json::to_value(&report.state).unwrap()).unwrap();
    assert_eq!(restored, report.state);
    restored.validate().unwrap();
}

#[test]
fn migrated_fractional_vote_countdown_survives_offline_time_and_repeated_scheduler_ticks() {
    let mut source = saved_source();
    source["vote"] = json!({
        "id":"recover-round", "choices":[source["queue"][0]["id"].clone()],
        "remaining":15.25, "ballots":{"alice":0}, "manual":true, "wasPaused":true,
    });
    let mut state = import_v123(source, 9_999_999_999).unwrap().state;
    apply(
        &mut state,
        Command::SetAudio {
            volume: 50,
            muted: false,
        },
    );
    assert_eq!(state.vote.as_ref().unwrap().remaining, 15.25);
    let tick = Command::ElapseVote {
        vote_id: "recover-round".into(),
        seconds: 1,
        sequence: 1,
    };
    apply(&mut state, tick.clone());
    assert_eq!(state.vote.as_ref().unwrap().remaining, 14.25);
    let repeated = state.transition(tick, 99_999_999_999).unwrap();
    assert!(!repeated.changed);
    assert_eq!(repeated.state, state);
    assert_eq!(repeated.ignored, Some(IgnoreReason::StaleVote));
}

#[test]
fn migration_rejects_duplicate_active_ids_and_malformed_media_without_silently_dropping_entries() {
    let mut source = saved_source();
    source["queue"][0]["id"] = source["current"]["id"].clone();
    assert!(matches!(
        import_v123(source, 0),
        Err(CoreError::DuplicateEntryId(_))
    ));
    let mut source = saved_source();
    source["nextRotationQueue"][0]["videoId"] = Value::from("invalid");
    assert!(matches!(
        import_v123(source, 0),
        Err(CoreError::InvalidEntry(_))
    ));
    assert!(matches!(
        import_v123(json!({"schemaVersion":1}), 0),
        Err(CoreError::UnsupportedLegacySchema)
    ));
}

#[test]
fn missing_legacy_entry_ids_are_assigned_deterministically() {
    let source = json!({"schemaVersion":2,"queue":[{"videoId":VIDEO_IDS[0]}]});
    let first = import_v123(source.clone(), 0).unwrap();
    let second = import_v123(source.clone(), 999_999).unwrap();
    assert_eq!(first.state.queue[0].id, second.state.queue[0].id);
    assert_eq!(first.source, source);
    assert!(!first.warnings.is_empty());
    assert_eq!(first.state.queue[0].position, 0.0);
    assert!(
        first.state.current.is_none(),
        "migration itself must not start playback"
    );
}

#[test]
fn a_legacy_previous_record_can_be_completed_and_deserialized_without_duplicate_history_keys() {
    let mut source = saved_source();
    source["current"]["reason"] = Value::from("skipped");
    source["current"]["playedAt"] = Value::from("2020-01-01T00:00:00.000Z");
    source["current"]["rotationNumber"] = Value::from(1);
    source["current"]["unavailable"] = Value::Bool(false);
    let mut state = import_v123(source, 0).unwrap().state;
    apply(&mut state, Command::Skip);
    let encoded = serde_json::to_string(&state).unwrap();
    let restored: EngineState = serde_json::from_str(&encoded).unwrap();
    assert_eq!(restored, state);
    assert_eq!(
        restored.history.last().unwrap().reason,
        CompletionReason::Skipped
    );
}

#[test]
fn command_wire_format_is_strict_and_preserves_legacy_destination_names() {
    let command: Command = serde_json::from_value(json!({
        "action":"checkpoint", "generation":2, "entryId":"active", "sequence":1,
        "position":0, "observedState":"buffering"
    }))
    .unwrap();
    assert!(matches!(
        command,
        Command::Checkpoint {
            observed_state: ObservedState::Buffering,
            ..
        }
    ));
    assert_eq!(
        serde_json::to_value(Destination::PlayNext).unwrap(),
        "playNext"
    );
    assert_eq!(
        serde_json::to_value(Destination::NextRotation).unwrap(),
        "nextRotation"
    );
    assert!(serde_json::from_value::<Command>(
        json!({"action":"seek","position":10,"unexpected":true})
    )
    .is_err());
}
