// Run explicitly after building playback-cli. The filename intentionally stays
// outside Node's automatic test discovery so the existing release stays usable
// without a Rust toolchain. No network, real player or customer state is used.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlaybackEngine } from '../../lib/engine.js';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const binary = process.env.PLAYBACK_RUST_BIN
  ? path.resolve(process.env.PLAYBACK_RUST_BIN)
  : path.join(workspace, 'target', 'debug', process.platform === 'win32' ? 'playback.exe' : 'playback');
assert.ok(existsSync(binary), `Build playback-cli first; binary missing: ${binary}`);
const fixture = path.join(workspace, 'fixtures', 'v1.2.3-sanitized.json');
const source = JSON.parse(readFileSync(fixture, 'utf8'));
const temporary = mkdtempSync(path.join(tmpdir(), 'playback-parity-'));
const lanes = ['queue', 'priorityQueue', 'recycledQueue', 'nextRotationQueue'];
let comparisons = 0;

function publicEntry(entry) {
  if (!entry) return null;
  return Object.fromEntries(['id', 'videoId', 'title', 'position', 'duration', 'paused']
    .map(field => [field, entry[field]]));
}

function projection(state) {
  return {
    rotationNumber: state.rotationNumber,
    current: publicEntry(state.current),
    ...Object.fromEntries(lanes.map(lane => [lane, state[lane].map(publicEntry)])),
    historyCount: state.queueCounts?.history ?? state.history.length,
  };
}

function scenario(name, exercise) {
  const db = path.join(temporary, `${name}.sqlite3`);
  const base = ['--db', db, '--tenant', 'parity', '--channel', name];
  const run = (...args) => {
    const result = spawnSync(binary, [...base, ...args], { encoding: 'utf8', timeout: 15_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${name}: playback ${args[0]} failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  run('import-v123', '--source', fixture);
  const engine = new PlaybackEngine({ load: () => structuredClone(source), write() {} },
    { clock: () => 1_760_572_800_000 });
  let serial = 0;
  const state = () => run('show', '--entries');
  const compare = label => {
    assert.deepEqual(projection(state()), projection(engine.state), `${name}: ${label}`);
    comparisons++;
  };
  const apply = (label, command, legacyAction) => {
    const before = state();
    legacyAction();
    const request = typeof command === 'function' ? command(before) : command;
    run('apply', '--command-id', `${name}-${++serial}`, '--expected-revision',
      String(before.revision), '--command', JSON.stringify(request));
    compare(label);
  };
  compare('imported fixture');
  exercise({ engine, state, apply });
  console.log(`PASS ${name}`);
}

try {
  scenario('queue-and-recovery', ({ engine, state, apply }) => {
    apply('priority activation', { action: 'skip' }, () => engine.skip());
    apply('fractional seek', { action: 'seek', position: 12.75 }, () => engine.seek(12.75));
    apply('pause before interruption', { action: 'pause', paused: true }, () => engine.pause(true));
    const selected = engine.state.queue[0].id;
    apply('play now parks exact saved position', { action: 'play_now', id: selected }, () => engine.playNow(selected));
    apply('interrupted entry resumes', { action: 'skip' }, () => engine.skip());
    assert.equal(state().current.position, 12.75);

    let added;
    apply('new entry joins current rotation', () => ({ action: 'add', entry: added, destination: 'current' }),
      () => { added = engine.add('abcdefghijk', 'New item'); });
    const moveId = engine.state.queue.at(-1).id;
    apply('move to priority', { action: 'move', id: moveId, destination: 'playNext' }, () => engine.move(moveId, 'playNext'));
    const deferred = engine.state.nextRotationQueue[0].id;
    let skips = 0;
    while (engine.state.rotationNumber === source.rotationNumber && skips++ < 20) {
      apply('drain rotation', { action: 'skip' }, () => engine.skip());
    }
    assert.equal(state().rotationNumber, source.rotationNumber + 1);
    assert.equal(state().current.id, deferred, 'deferred entries precede the recycled pool');
    apply('previous preserves a single active occurrence', { action: 'previous' }, () => engine.previous());
    apply('replay', { action: 'replay' }, () => engine.replay());
  });

  scenario('votes-and-output-events', ({ engine, state, apply }) => {
    apply('manual vote pauses current', { action: 'start_vote', voteId: 'manual-1' }, () => engine.startVote());
    apply('viewer selects second choice', { action: 'vote_choice', index: 2, viewer: 'viewer-a' }, () => engine.voteChoice(2, 'viewer-a'));
    apply('viewer changes selection', { action: 'vote_choice', index: 1, viewer: 'viewer-a' }, () => engine.voteChoice(1, 'viewer-a'));
    apply('manual cancel restores prior pause', { action: 'cancel_vote' }, () => engine.cancelVote());
    apply('end begins automatic vote', before => ({ action: 'ended', generation: before.generation, entryId: before.current.id }),
      () => engine.ended(engine.state.generation));
    apply('owner selects second choice', { action: 'choose', index: 2 }, () => engine.choose(2));
    apply('unavailable item is quarantined', before => ({ action: 'unavailable', generation: before.generation, entryId: before.current.id }),
      () => engine.failVideo());
    apply('disable end voting', { action: 'set_vote_on_end', enabled: false }, () => { engine.settings.voteOnEnd = false; engine.save(); });
    const oldRust = state();
    const oldGeneration = engine.state.generation;
    apply('end activates next item', before => ({ action: 'ended', generation: before.generation, entryId: before.current.id }),
      () => engine.ended(engine.state.generation));
    apply('stale ended cannot skip replacement', { action: 'ended', generation: oldRust.generation, entryId: oldRust.current.id },
      () => engine.ended(oldGeneration));
    apply('confirmed progress is persisted', before => ({ action: 'checkpoint', generation: before.generation,
      entryId: before.current.id, sequence: 1, position: 31.5, duration: 500, observedState: 'playing' }),
      () => engine.updatePosition(engine.state.generation, 31.5, 500, engine.state.current.title, engine.state.current.videoId));
    assert.equal(state().current.position, 31.5);
  });

  console.log(`Verified ${comparisons} public-state comparisons against the existing JavaScript engine.`);
  console.log('Scope: queue, rotation, voting effects, playhead and event semantics; no media output, timing, network or performance claim.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
