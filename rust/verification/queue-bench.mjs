// Explicit microbenchmark; intentionally outside Node's automatic test discovery.
// Run from rust/ after building the release example:
//   cargo build --release --locked -p playback-core --example queue_bench
//   node verification/queue-bench.mjs
//   node verification/queue-bench.mjs --iterations 10000 --samples 7 --json
//
// Timed: the actual JS skip()/Rust transition(Skip) APIs, including their current
// revision/timestamp updates, allocations and retained history. JS persistence is
// a no-op; Rust keeps its validation and complete-snapshot cloning. This compares
// those implementations, not equivalent persistence contracts or language speed.
// Untimed: process startup, fixture construction/import, warmup, projection and
// checksums. No filesystem, HTTP, database or media operations occur in the loop.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { migrateState, PlaybackEngine } from '../../lib/engine.js';

const { values } = parseArgs({
  options: {
    binary: { type: 'string' },
    sizes: { type: 'string', default: '25,250,2000' },
    iterations: { type: 'string', default: '2000' },
    warmup: { type: 'string', default: '1000' },
    samples: { type: 'string', default: '5' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`Usage: node verification/queue-bench.mjs [options]

Build first: cargo build --release --locked -p playback-core --example queue_bench

  --binary PATH       Release queue_bench executable (or PLAYBACK_QUEUE_BENCH_BIN)
  --sizes 25,250,2000  Total active entries, including the current video (1–2000)
  --iterations 2000   Timed Skip transitions per sample
  --warmup 1000       Minimum warmup; rounded up to full rotations and >=300 skips
  --samples 5         Samples per engine/size; execution order alternates
  --json              Machine-readable results including all timings and checksums

The JS engine uses a no-op store; Rust retains validation and snapshot cloning.
These are in-memory implementation timings, not durable throughput, cloud
capacity, memory usage, media throughput, or a language-only speed comparison.`);
  process.exit(0);
}

function positiveInteger(value, name, maximum = 1_000_000) {
  assert.match(value, /^[1-9]\d*$/, `${name} must be a positive integer`);
  const parsed = Number(value);
  assert.ok(Number.isSafeInteger(parsed) && parsed <= maximum,
    `${name} must be at most ${maximum}`);
  return parsed;
}

const sizes = values.sizes.split(',').map(value => positiveInteger(value, 'size', 2000));
assert.equal(new Set(sizes).size, sizes.length, 'sizes must be unique');
const iterations = positiveInteger(values.iterations, 'iterations');
const minimumWarmup = positiveInteger(values.warmup, 'warmup');
const samples = positiveInteger(values.samples, 'samples', 100);
const workspace = fileURLToPath(new URL('..', import.meta.url));
const binary = path.resolve(values.binary ?? process.env.PLAYBACK_QUEUE_BENCH_BIN
  ?? path.join(workspace, 'target', 'release', 'examples',
    process.platform === 'win32' ? 'queue_bench.exe' : 'queue_bench'));
assert.ok(existsSync(binary), `Build the release example first; executable missing: ${binary}`);

const startMs = 1_760_572_800_000;
const laneNames = ['queue', 'priorityQueue', 'recycledQueue', 'nextRotationQueue'];
const scope = {
  workload: 'One in-memory channel; repeated Skip; looping on; end/skip voting off.',
  javascript: 'Existing PlaybackEngine.skip() with no-op store.write(); mutates live state.',
  rust: 'Existing EngineState.transition(Command::Skip); validates and clones full snapshots.',
  included: 'API transition work, timestamps, allocations, history retention and normal GC/drop work during the loop.',
  excluded: 'Process startup, fixture/import, warmup, public projection, checksums, persistence/serialization, HTTP, media and final cleanup.',
  limitations: 'Different implementation contracts; single process/channel per sample; no language-only speed, memory, production throughput or hosting-density conclusion.',
};

function fixtureFor(entries) {
  const fixture = migrateState(null);
  const addedAt = new Date(startMs).toISOString();
  const videos = Array.from({ length: entries }, (_, index) => ({
    id: `bench-${String(index).padStart(5, '0')}`,
    videoId: `v${String(index).padStart(10, '0')}`,
    title: `Benchmark video ${index}`,
    position: 0,
    duration: 300 + index % 7,
    paused: false,
    playCount: 0,
    addedAt,
    lastPlayedAt: null,
    lastPlayedRotation: null,
  }));
  fixture.current = videos[0];
  fixture.queue = videos.slice(1);
  fixture.settings = { ...fixture.settings, loop: true, voteOnEnd: false, skipVoting: false };
  fixture.updatedAt = addedAt;
  return fixture;
}

function publicEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    videoId: entry.videoId,
    title: entry.title,
    position: entry.position,
    duration: entry.duration,
    paused: entry.paused,
    playCount: entry.playCount ?? 0,
    addedAt: entry.addedAt ?? null,
    publishedAt: entry.publishedAt ?? null,
    lastPlayedAt: entry.lastPlayedAt ?? null,
    lastPlayedRotation: entry.lastPlayedRotation ?? null,
  };
}

function publicProjection(state) {
  return {
    revision: state.revision,
    layoutRevision: state.layoutRevision,
    generation: state.generation,
    rotationNumber: state.rotationNumber,
    current: publicEntry(state.current),
    ...Object.fromEntries(laneNames.map(lane => [lane, state[lane].map(publicEntry)])),
    historyCount: state.history.length,
    vote: state.vote ? 'unexpected active vote' : null,
    skipCount: Object.keys(state.skipBallots).length,
    settings: {
      loop: state.settings.loop,
      voteOnEnd: state.settings.voteOnEnd,
      skipVoting: state.settings.skipVoting,
    },
    audio: { volume: state.audio.volume, muted: state.audio.muted },
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function checksum(projection) {
  // Parsing Rust's JSON before canonicalizing also normalizes 0.0 versus 0.
  return createHash('sha256').update(JSON.stringify(canonical(projection))).digest('hex');
}

function javascriptSample(fixture, warmup) {
  let step = 0;
  const engine = new PlaybackEngine({ load: () => structuredClone(fixture), write() {} },
    { clock: () => startMs + step });
  for (let index = 0; index < warmup; index++) {
    step++;
    engine.skip();
  }
  const started = process.hrtime.bigint();
  for (let index = 0; index < iterations; index++) {
    step++;
    engine.skip();
  }
  const elapsedNs = Number(process.hrtime.bigint() - started);
  return { elapsedNs, projection: publicProjection(engine.state) };
}

function rustSample(request) {
  const result = spawnSync(binary, [], {
    input: request,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `Rust benchmark failed: ${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.debugAssertions, false, 'Use a release build for this benchmark');
  assert.equal(output.iterations, iterations);
  assert.ok(Number.isSafeInteger(output.elapsedNs) && output.elapsedNs > 0);
  return output;
}

function verifyWork(projection, entries, warmup) {
  const transitions = warmup + iterations;
  const currentIndex = transitions % entries;
  assert.equal(projection.revision, 1 + transitions);
  assert.equal(projection.generation, 1 + transitions);
  assert.equal(projection.rotationNumber, 1 + Math.floor(transitions / entries));
  assert.equal(projection.current.id, `bench-${String(currentIndex).padStart(5, '0')}`);
  assert.equal(projection.queue.length, entries - 1 - currentIndex);
  assert.equal(projection.recycledQueue.length, currentIndex);
  assert.equal(projection.priorityQueue.length, 0);
  assert.equal(projection.nextRotationQueue.length, 0);
  assert.equal(projection.historyCount, 300);
  assert.equal(projection.vote, null);
  assert.equal(projection.skipCount, 0);
}

function timingSummary(elapsedNs) {
  const sorted = [...elapsedNs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianNs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    samplesMs: elapsedNs.map(value => value / 1e6),
    medianMs: medianNs / 1e6,
    minimumMs: sorted[0] / 1e6,
    maximumMs: sorted.at(-1) / 1e6,
    medianMicrosecondsPerSkip: medianNs / iterations / 1000,
    medianSkipsPerSecond: iterations / (medianNs / 1e9),
  };
}

const results = [];
for (const entries of sizes) {
  const fixture = fixtureFor(entries);
  // Start each sample with bounded, full history and the same rotation phase.
  const warmup = Math.ceil(Math.max(minimumWarmup, 300, entries) / entries) * entries;
  const request = JSON.stringify({ fixture, startMs, warmup, iterations });
  const jsTimings = [];
  const rustTimings = [];
  let expectedChecksum;

  for (let sample = 0; sample < samples; sample++) {
    let js;
    let rust;
    if (sample % 2 === 0) {
      rust = rustSample(request);
      js = javascriptSample(fixture, warmup);
    } else {
      js = javascriptSample(fixture, warmup);
      rust = rustSample(request);
    }
    assert.equal(rust.entries, entries);
    assert.equal(rust.warmup, warmup);
    verifyWork(js.projection, entries, warmup);
    verifyWork(rust.projection, entries, warmup);
    assert.deepEqual(rust.projection, js.projection, `${entries} entries, sample ${sample + 1}: public state differs`);
    const jsChecksum = checksum(js.projection);
    assert.equal(checksum(rust.projection), jsChecksum);
    expectedChecksum ??= jsChecksum;
    assert.equal(jsChecksum, expectedChecksum, 'repeated samples must produce identical state');
    jsTimings.push(js.elapsedNs);
    rustTimings.push(rust.elapsedNs);
  }

  results.push({
    entries,
    retainedHistoryEntries: 300,
    warmupSkips: warmup,
    timedSkipsPerSample: iterations,
    samples,
    projectionMatches: true,
    projectionSha256: expectedChecksum,
    javascript: timingSummary(jsTimings),
    rust: timingSummary(rustTimings),
  });
  if (!values.json) console.error(`Verified ${entries} entries: ${samples} matching final projections.`);
}

const report = {
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? 'unknown',
    rustBinary: binary,
    rustProfile: 'release (debug assertions disabled)',
  },
  scope,
  results,
};

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Queue transition microbenchmark — ${process.version}, ${process.platform}/${process.arch}`);
  console.log(`CPU: ${report.environment.cpu}`);
  console.log(`Rust executable: ${binary}`);
  console.log(`${samples} samples/engine/size; ${iterations} timed skips/sample; final public projections and SHA-256 match.`);
  console.log('\n| Entries | Warmup skips | JS median µs/skip | Rust median µs/skip | JS sample range ms | Rust sample range ms |');
  console.log('| ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const result of results) {
    const js = result.javascript;
    const rust = result.rust;
    console.log(`| ${result.entries} | ${result.warmupSkips} | ${js.medianMicrosecondsPerSkip.toFixed(2)} | ${rust.medianMicrosecondsPerSkip.toFixed(2)} | ${js.minimumMs.toFixed(2)}–${js.maximumMs.toFixed(2)} | ${rust.minimumMs.toFixed(2)}–${rust.maximumMs.toFixed(2)} |`);
  }
  console.log('\nFinal public projection SHA-256:');
  for (const result of results) console.log(`${result.entries}: ${result.projectionSha256}`);
  console.log(`\nJS: ${scope.javascript}\nRust: ${scope.rust}`);
  console.log(`Included: ${scope.included}\nExcluded: ${scope.excluded}\nLimits: ${scope.limitations}`);
  console.log('Use --json for all sample timings and reproducibility metadata. Rerun on an otherwise idle machine before drawing performance conclusions.');
}
