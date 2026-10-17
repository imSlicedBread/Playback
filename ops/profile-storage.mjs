/** Repeatable local-disk benchmark. Synthetic metadata; no external requests. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SQLiteStore} from '../lib/sqlite-store.js';
import {DurableStore} from '../lib/store.js';
import {PlaybackEngine} from '../lib/engine.js';
const counts=process.argv.slice(2).map(Number);
if(counts.some(n=>!Number.isSafeInteger(n)||n<1))throw new Error('Use positive integer queue sizes');
const rows=[];
for(const count of counts.length?counts:[2000,5000,10000]) {
  for(const [storage,Store] of [['legacy-json',DurableStore],['sqlite',SQLiteStore]]) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-storage-bench-'));
    let store;
    try {
      store=new Store(dir);const engine=new PlaybackEngine(store);
      const entries=Array.from({length:count},(_,i)=>({id:`entry-${i}`,videoId:String(i).padStart(11,'0'),
        title:`Archive stream ${i} / Synthetic storage benchmark`,position:0,duration:7200,paused:false}));
      engine.state.current=entries[0];engine.state.queue=entries.slice(1);engine.save();
      const samples=[];
      for(let i=1;i<=55;i++) {
        const start=performance.now();engine.updatePosition(engine.state.generation,i*2,7200);
        if(i>5)samples.push(performance.now()-start);
      }
      const sorted=samples.toSorted((a,b)=>a-b);
      const steady=store.lastWrite?{...store.lastWrite}:null;
      const rev=engine.catalogRevision;const pollBytes=Buffer.byteLength(JSON.stringify(engine.dashboardState(rev)));
      const startSkip=performance.now();engine.skip();const skipMs=performance.now()-startSkip;
      const rowsChangedOnSkip=store.lastWrite?.catalogRowsChanged??null;
      store.close?.();
      const startOpen=performance.now();store=new Store(dir);const recovered=new PlaybackEngine(store);
      const reloadMs=performance.now()-startOpen;
      if(recovered.storedCount()!==count)throw new Error('Data lost across reload');
      rows.push({storage,videos:count,checkpointSamples:samples.length,medianCheckpointMs:sorted[Math.floor(sorted.length/2)],
        p95CheckpointMs:sorted[Math.floor(sorted.length*.95)],steadySerializedBytes:steady?.serializedBytes??null,
        steadyCatalogRowsChanged:steady?.catalogRowsChanged??null,compactPollBytes:pollBytes,skipMs,rowsChangedOnSkip,reloadMs,
        recoveredVideos:recovered.storedCount()});
    } finally {store?.close?.();fs.rmSync(dir,{recursive:true,force:true});}
  }
}
console.log(JSON.stringify({node:process.version,platform:process.platform,method:'Synthetic metadata, local filesystem, 5 warmups + 50 committed checkpoints, synchronous FULL for SQLite; not client hardware or OBS throughput',rows},null,2));
