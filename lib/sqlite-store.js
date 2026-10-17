/**
 * Transactional, row-oriented station persistence. Runtime checkpoints never
 * serialize or rewrite the catalog. Legacy JSON is read once and never modified.
 * Use only under the station's processLock: one engine owns one data directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirPrivate } from './store.js';

export const DATABASE_NAME = 'playback.sqlite3';
export const STORAGE_VERSION = 1;
const LANES = ['priorityQueue', 'queue', 'recycledQueue', 'nextRotationQueue'];
const CATALOG_KEYS = new Set([...LANES, 'history', 'suggestions']);
const STEP = 1024;

function syncFile(file) {
  // Windows FlushFileBuffers requires a writable handle, even for a completed backup.
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDirectory(dir) {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function entryId(video) {
  if (!video || typeof video.id !== 'string' || !video.id || video.id.length > 200) {
    throw new Error('A queue entry has no valid stable ID; the original saved data has not been replaced');
  }
  return video.id;
}

// Reuse monotonic positions on append/removal/rollover so completing the first
// video does not rewrite every remaining row. Rebalance only on actual reorder
// or if a gap can no longer represent inserted entries using safe integers.
function positionsFor(list, lane, previous) {
  const positions = list.map(v => {
    const old = previous.get(v.id);
    return old?.lane === lane ? old.position : null;
  });
  let last = -Infinity;
  const dense = () => list.map((_, i) => (i + 1) * STEP);
  for (const position of positions) {
    if (position !== null) {
      if (position <= last) return dense();
      last = position;
    }
  }
  for (let i = 0; i < positions.length;) {
    if (positions[i] !== null) { i++; continue; }
    let end = i;
    while (end < positions.length && positions[end] === null) end++;
    const count = end - i, right = positions[end];
    const left = i > 0 ? positions[i - 1] : (right === undefined ? 0 : right - (count + 1) * STEP);
    const step = right === undefined ? STEP : Math.floor((right - left) / (count + 1));
    if (step < 1) return dense();
    for (; i < end; i++) {
      const next = i > 0 ? positions[i - 1] + step : left + step;
      if (!Number.isSafeInteger(next)) return dense();
      positions[i] = next;
    }
  }
  return positions;
}

export class SQLiteStore {
  constructor(dir) {
    this.dir = path.resolve(dir);
    mkdirPrivate(this.dir);
    this.file = path.join(this.dir, DATABASE_NAME);
    this.legacyFile = path.join(this.dir, 'state.json');
    this.migrationBackup = path.join(this.dir, 'state.before-sqlite-migration.json');
    this.kind = 'sqlite';
    this.closed = false;
    this.needsMigration = false;
    this.initialized = false;
    this.queueCache = new Map();
    this.historyCache = [];
    this.suggestionCache = new Map();
    this.lastWrite = null;
    // Create a private file before SQLite opens it; do not truncate an existing DB.
    try { fs.closeSync(fs.openSync(this.file, 'wx', 0o600)); }
    catch (err) { if (err.code !== 'EEXIST') throw err; }
    try {
      this.db = new DatabaseSync(this.file);
      this.db.exec('PRAGMA busy_timeout=5000;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version > STORAGE_VERSION) throw new Error(`Storage version ${version} is newer than this Playback build`);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      if (version === 0) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
          CREATE TABLE IF NOT EXISTS station_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
          CREATE TABLE IF NOT EXISTS queue_entries (
            id TEXT PRIMARY KEY, video_id TEXT NOT NULL, lane TEXT NOT NULL
              CHECK(lane IN ('priorityQueue','queue','recycledQueue','nextRotationQueue')),
            position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
          ) STRICT;
          CREATE INDEX IF NOT EXISTS queue_lane_position ON queue_entries(lane, position);
          CREATE INDEX IF NOT EXISTS queue_video_id ON queue_entries(video_id);
          CREATE TABLE IF NOT EXISTS history_entries (position INTEGER PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
          CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
          PRAGMA user_version=1;
          COMMIT;`);
      }
      const check = this.db.prepare('PRAGMA quick_check').get();
      if (check.quick_check !== 'ok') throw new Error(`Storage integrity check failed: ${check.quick_check}`);
      this.sql = {
        state: this.db.prepare('INSERT INTO station_state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'),
        readState: this.db.prepare('SELECT data FROM station_state WHERE id=1'),
        readQueue: this.db.prepare('SELECT * FROM queue_entries ORDER BY lane, position'),
        upsertQueue: this.db.prepare('INSERT INTO queue_entries(id,video_id,lane,position,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET video_id=excluded.video_id,lane=excluded.lane,position=excluded.position,data=excluded.data'),
        deleteQueue: this.db.prepare('DELETE FROM queue_entries WHERE id=?'),
        upsertHistory: this.db.prepare('INSERT INTO history_entries(position,data) VALUES(?,?) ON CONFLICT(position) DO UPDATE SET data=excluded.data'),
        trimHistory: this.db.prepare('DELETE FROM history_entries WHERE position>=?'),
        upsertSuggestion: this.db.prepare('INSERT INTO suggestions(id,position,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,data=excluded.data'),
        deleteSuggestion: this.db.prepare('DELETE FROM suggestions WHERE id=?'),
        markInitialized: this.db.prepare("INSERT OR IGNORE INTO storage_meta(key,value) VALUES('initialized','1')")
      };
    } catch (err) {
      try { this.db?.close(); } catch {}
      throw new Error(`Cannot open Playback storage at ${this.file}: ${err.message}. Restore a verified backup; existing data was not reset.`);
    }
  }

  load() {
    this.loaded = true;
    const row = this.sql.readState.get();
    if (!row) {
      const established = this.db.prepare("SELECT value FROM storage_meta WHERE key='initialized'").get();
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM queue_entries').get().n;
      if (established || count) throw new Error('Database is missing its station state; refusing to reset an existing library');
      let raw;
      try { raw = fs.readFileSync(this.legacyFile); }
      catch (err) { if (err.code === 'ENOENT') return null; throw err; }
      let legacy;
      try { legacy = JSON.parse(raw.toString('utf8')); }
      catch (err) { throw new Error(`Cannot migrate state.json: ${err.message}. Original JSON is unchanged.`); }
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('Cannot migrate invalid state.json; original file is unchanged');
      this.legacyBytes = raw;
      this.needsMigration = true;
      return legacy;
    }
    const state = JSON.parse(row.data);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid persisted station state; refusing to reset storage');
    this.queueCache = new Map();
    for (const key of LANES) state[key] = [];
    for (const record of this.sql.readQueue.iterate()) {
      state[record.lane].push(JSON.parse(record.data));
      this.queueCache.set(record.id, {lane:record.lane, position:record.position, data:record.data});
    }
    this.historyCache = this.db.prepare('SELECT data FROM history_entries ORDER BY position').all().map(r => r.data);
    state.history = this.historyCache.map(data => JSON.parse(data));
    this.suggestionCache = new Map();
    state.suggestions = [];
    for (const record of this.db.prepare('SELECT * FROM suggestions ORDER BY position').iterate()) {
      state.suggestions.push(JSON.parse(record.data));
      this.suggestionCache.set(record.id, {position:record.position, data:record.data});
    }
    this.initialized = true;
    this.needsMigration = false;
    return state;
  }

  backupLegacy() {
    if (!this.legacyBytes) return;
    if (fs.existsSync(this.migrationBackup)) {
      if (!fs.readFileSync(this.migrationBackup).equals(this.legacyBytes)) {
        throw new Error('A different pre-SQLite backup already exists. Preserve both files and resolve before migration.');
      }
      return;
    }
    const temp = `${this.migrationBackup}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, this.legacyBytes, {flag:'wx', mode:0o600});
      syncFile(temp);
      fs.renameSync(temp, this.migrationBackup);
      syncDirectory(this.dir);
    } finally { try { fs.unlinkSync(temp); } catch (err) { if (err.code !== 'ENOENT') throw err; } }
  }

  write(state, {catalogChanged=true}={}) {
    if (!this.loaded) this.load();
    const started = performance.now();
    const runtime = {};
    for (const key of Object.keys(state)) if (!CATALOG_KEYS.has(key)) runtime[key] = state[key];
    const runtimeJson = JSON.stringify(runtime);
    const full = catalogChanged || !this.initialized;
    let queue, history, suggestions, serializedBytes = Buffer.byteLength(runtimeJson);
    if (full) {
      queue = new Map();
      for (const lane of LANES) {
        const list = state[lane] || [], positions = positionsFor(list, lane, this.queueCache);
        for (let i=0; i<list.length; i++) {
          const video=list[i], id=entryId(video);
          if (queue.has(id)) throw new Error(`Duplicate queue-entry ID ${id}; migration/write aborted without dropping videos`);
          const data=JSON.stringify(video);
          serializedBytes += Buffer.byteLength(data);
          queue.set(id, {lane, position:positions[i], data, videoId:video.videoId || ''});
        }
      }
      history = (state.history || []).map(v => JSON.stringify(v));
      suggestions = new Map();
      for (const [position, item] of (state.suggestions || []).entries()) {
        const id=entryId(item);
        if (suggestions.has(id)) throw new Error('Duplicate suggestion ID');
        suggestions.set(id, {position, data:JSON.stringify(item)});
      }
      serializedBytes += history.reduce((n,s)=>n+Buffer.byteLength(s),0);
      for (const item of suggestions.values()) serializedBytes += Buffer.byteLength(item.data);
    }
    if (this.needsMigration) this.backupLegacy();
    let catalogRowsChanged = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (full) {
        for (const id of this.queueCache.keys()) if (!queue.has(id)) { this.sql.deleteQueue.run(id); catalogRowsChanged++; }
        for (const [id, next] of queue) {
          const old=this.queueCache.get(id);
          if (!old || old.lane!==next.lane || old.position!==next.position || old.data!==next.data) {
            this.sql.upsertQueue.run(id,next.videoId,next.lane,next.position,next.data); catalogRowsChanged++;
          }
        }
        for (let i=0; i<history.length; i++) if (this.historyCache[i]!==history[i]) { this.sql.upsertHistory.run(i,history[i]); catalogRowsChanged++; }
        if (history.length<this.historyCache.length) catalogRowsChanged+=Number(this.sql.trimHistory.run(history.length).changes);
        for (const id of this.suggestionCache.keys()) if (!suggestions.has(id)) { this.sql.deleteSuggestion.run(id); catalogRowsChanged++; }
        for (const [id, next] of suggestions) {
          const old=this.suggestionCache.get(id);
          if (!old || old.position!==next.position || old.data!==next.data) { this.sql.upsertSuggestion.run(id,next.position,next.data); catalogRowsChanged++; }
        }
      }
      this.sql.state.run(runtimeJson);
      if (!this.initialized) this.sql.markInitialized.run();
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw err;
    }
    if (full) { this.queueCache=queue; this.historyCache=history; this.suggestionCache=suggestions; }
    this.initialized=true; this.needsMigration=false; this.legacyBytes=null;
    this.lastWrite={catalogChanged:full,catalogRowsChanged,serializedBytes,durationMs:performance.now()-started};
  }

  close() {
    if (!this.db || this.closed) return;
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    finally { this.db.close(); this.closed = true; }
  }
}

/** Consistent live backup; never copy only the main DB while WAL writes are active. */
export function backupDatabase(source, destination) {
  source=path.resolve(source); destination=path.resolve(destination);
  if (!fs.existsSync(source)) throw new Error(`Database not found: ${source}`);
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists; choose a new filename');
  mkdirPrivate(path.dirname(destination));
  const temp=`${destination}.${crypto.randomUUID()}.tmp`;
  const db=new DatabaseSync(source,{readOnly:true});
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
    db.prepare('VACUUM main INTO ?').run(temp);
    fs.chmodSync(temp,0o600); syncFile(temp);
    const check=new DatabaseSync(temp,{readOnly:true});
    try { if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok') throw new Error('Backup integrity check failed'); }
    finally { check.close(); }
    fs.renameSync(temp,destination); syncDirectory(path.dirname(destination));
    return destination;
  } finally { db.close(); try {fs.unlinkSync(temp);} catch(err) {if(err.code!=='ENOENT')throw err;} }
}
