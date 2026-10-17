import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {moveInBatches, BULK_MOVE_BATCH_SIZE} from '../public/assets/bulk-move.js';
import {createApp} from '../lib/http.js';
import {PlaybackEngine} from '../lib/engine.js';
import {SQLiteStore} from '../lib/sqlite-store.js';

const ids=n=>Array.from({length:n},(_,i)=>`bulk-${i}`);
const videos=n=>Array.from({length:n},(_,i)=>({
  id:`bulk-${i}`,videoId:String(i).padStart(11,'0'),title:`Test video ${i}`,
  position:0,duration:3600,paused:false,playCount:0
}));

test('1,702 selected videos move in bounded batches with truthful, monotonic progress', async()=>{
  const input=ids(1702),sent=[],progress=[],confirmed=[];
  const res=await moveInBatches(input,'recycled',{
    submit:async batch=>{sent.push(batch);},
    onBatchComplete:batch=>confirmed.push(...batch),
    onProgress:status=>progress.push(status)
  });
  assert.equal(res.status,'complete');assert.equal(res.moved,1702);
  assert.deepEqual(sent.map(batch=>batch.length),[250,250,250,250,250,250,202]);
  assert.equal(Math.max(...sent.map(x=>x.length))<=500,true);
  assert.deepEqual(confirmed,input);
  assert.deepEqual(progress.filter(p=>p.status==='confirmed').map(p=>p.moved),[250,500,750,1000,1250,1500,1702]);
  assert.equal(progress.at(-1).percent,100);
  assert.equal(progress.at(-1).status,'complete');
  assert.deepEqual(input,ids(1702),'caller selection is not mutated');
});

test('A failed batch leaves exact unconfirmed IDs for safe retry and reports partial success',async()=>{
  const selection=new Set(ids(1050));let calls=0;const statuses=[];
  await assert.rejects(moveInBatches([...selection],'nextRotation',{
    submit:async()=>{if(++calls===3)throw new Error('Disk busy');},
    onBatchComplete:batch=>batch.forEach(id=>selection.delete(id)),
    onProgress:s=>statuses.push(s)
  }),e=>e.moved===500&&e.total===1050&&e.failedBatch===3&&e.remaining.length===550&&/Disk busy/.test(e.message));
  assert.equal(calls,3);
  assert.deepEqual([...selection],ids(1050).slice(500));
  assert.equal(statuses.at(-1).status,'failed');assert.equal(statuses.at(-1).moved,500);
  const retried=await moveInBatches([...selection],'nextRotation',{
    submit:async()=>{},onBatchComplete:batch=>batch.forEach(id=>selection.delete(id))
  });
  assert.equal(retried.moved,550);assert.equal(selection.size,0);
});

test('Stop button safely halts after the current acknowledged batch',async()=>{
  let cancel=false,calls=0;const stages=[];
  const result=await moveInBatches(ids(1001),'recycled',{
    submit:async()=>{calls++;cancel=true;},shouldStop:()=>cancel,
    onProgress:s=>stages.push(s)
  });
  assert.equal(calls,1);assert.equal(result.status,'cancelled');
  assert.equal(result.moved,BULK_MOVE_BATCH_SIZE);assert.equal(result.remaining.length,751);
  assert.equal(stages.at(-1).status,'cancelled');
});

test('Malformed selections and attempts to exceed the per-request safeguard are rejected',async()=>{
  for(const list of [[],['x','x'],['valid',null],'wrong']){
    await assert.rejects(moveInBatches(list,'current',{submit:async()=>{}}));
  }
  await assert.rejects(moveInBatches(ids(501),'current',{submit:async()=>{},batchSize:501}),/1–500/);
});

test('Dashboard exposes select-all-matching, accessible move progress, and safe cancellation',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const html=fs.readFileSync(path.join(root,'public/control.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'public/assets/control.js'),'utf8');
  for(const id of ['queueSelectMatching','queueBulkProgress','queueBulkStatus','queueBulkPercent','queueBulkBar','queueBulkCancel','queueBulkDetails'])
    assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/role="status" aria-live="polite"/);
  assert.match(js,/moveInBatches\(ids,destination/);
  assert.match(js,/onBatchComplete:chunk/);
  assert.match(js,/if\(bulkMoveRunning\)return; \/\/ Preserve/);
  assert.doesNotMatch(js,/queueMoveSelected'\)\.disabled=!selected\|\|selected>500/);
});

test('Real HTTP server moves 1,702 videos in multiple committed batches and recovers order after restart', {timeout:30000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-bulk-ui-'));
  const app=createApp({dataDir:dir,port:0,env:{ADMIN_TOKEN:'bulk-test-token'},twitchEnabled:false,titleResolver:async()=>null});
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  app.engine.state.current={...videos(1)[0],id:'now-playing'};
  app.engine.state.queue=videos(1702);
  app.engine.save();
  const address=await app.listen();const base=`http://127.0.0.1:${address.port}`;
  const auth=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'bulk-test-token'})});
  const cookie=auth.headers.get('set-cookie').split(';')[0];
  const request=async selected=>{
    const r=await fetch(`${base}/api/control`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'moveMany',ids:selected,destination:'recycled'})});
    const j=await r.json();if(!r.ok)throw new Error(j.error);return j;
  };
  const invalid=await fetch(`${base}/api/control`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'moveMany',ids:ids(501),destination:'recycled'})});
  assert.equal(invalid.status,400,'server safeguard remains bounded');
  const res=await moveInBatches(ids(1702),'recycled',{submit:request});
  assert.equal(res.status,'complete');
  assert.equal(app.engine.state.queue.length,0);
  assert.deepEqual(app.engine.state.recycledQueue.map(v=>v.id),ids(1702));
  assert.equal(app.engine.state.current.id,'now-playing');
  assert.equal(app.engine.store.db.prepare('SELECT COUNT(*) AS n FROM queue_entries WHERE lane=?').get('recycledQueue').n,1702);
  await app.close();
  const db=new SQLiteStore(dir);
  try {
    const restored=new PlaybackEngine(db);
    assert.deepEqual(restored.state.recycledQueue.map(v=>v.id),ids(1702));
    assert.equal(restored.state.queue.length,0);
  } finally { db.close(); } // Windows cannot remove an open SQLite database.
});