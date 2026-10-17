import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PlaybackEngine} from '../lib/engine.js';
import {createApp} from '../lib/http.js';
import {queuePage,QUEUE_PAGE_SIZE} from '../public/assets/queue-page.js';
import {singleFlight} from '../public/assets/single-flight.js';
import {TitleMetadataQueue} from '../lib/title-metadata.js';

function seed(engine,count=350){
  const videos=Array.from({length:count},(_,i)=>({id:`entry-${i}`,videoId:String(i).padStart(11,'0'),title:`Archive video ${i}`,position:0,duration:1800,paused:false}));
  engine.state.current=videos[0];engine.state.queue=videos.slice(1);engine.save();
  return engine;
}
for(const count of [350,1000,2000,10000])test(`Compact heartbeat payload stays bounded with ${count} videos`,()=>{
  const e=seed(new PlaybackEngine(null),count),first=e.dashboardState();
  assert.equal(first.catalog.upcomingQueue.length,count-1);
  assert.equal(first.playableCount,count-1);
  assert.equal(first.catalog.queue,undefined,'do not send duplicate copy of upcoming');
  const rev=first.catalogRevision;
  e.updatePosition(e.state.generation,180,1800);
  const delta=e.dashboardState(rev);
  assert.equal(delta.catalog,undefined);assert.equal(delta.catalogRevision,rev);
  assert.equal(delta.current.position,180);
  assert.ok(Buffer.byteLength(JSON.stringify(delta))<8000);
  const pub=e.publicState({compact:true});
  assert.equal(pub.queue,undefined);assert.equal(pub.recycledQueue,undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(pub))<8000);
});

test('Pause, seek, mute, settings and ordinary heartbeats do not resend queue metadata',()=>{
  const e=seed(new PlaybackEngine(null));const rev=e.catalogRevision;
  e.pause(true);e.seek(90);e.setAudio(42,true);e.saveSettings(e.settings);
  e.updatePosition(e.state.generation,92,1800);
  assert.equal(e.catalogRevision,rev);
  assert.equal(e.dashboardState(rev).catalog,undefined);
  assert.equal(e.dashboardState(rev).audio.volume,42);
});

test('Queue changes, requests, discovered titles and restart invalidate catalog tokens',()=>{
  const e=seed(new PlaybackEngine(null));
  for(const fn of [()=>e.move('entry-1','nextRotation'),()=>e.reorder('entry-2',4),()=>e.skip(),()=>e.suggest('abcdefghijk','Request','test'),()=>e.sortUpcoming('title'),()=>e.add('xxxxxxxxxxx','')]){
    const revision=e.catalogRevision;fn();assert.notEqual(e.catalogRevision,revision);assert.ok(e.dashboardState(revision).catalog);
  }
  const revision=e.catalogRevision;e.applyDiscoveredTitle('xxxxxxxxxxx','Discovered title');assert.ok(e.dashboardState(revision).catalog);
  const restored=new PlaybackEngine({load:()=>JSON.parse(JSON.stringify(e.state))});
  assert.notEqual(restored.catalogRevision,e.catalogRevision);
  assert.ok(restored.dashboardState(e.catalogRevision).catalog);
  assert.equal(restored.state.queue.length,e.state.queue.length);
});

test('Failed durable mutation invalidates the catalog and restores saved state',()=>{
  let saved=null,fail=false;
  const e=new PlaybackEngine({load:()=>saved,write:s=>{if(fail)throw new Error('disk full');saved=JSON.parse(JSON.stringify(s));}});
  seed(e);const rev=e.catalogRevision;fail=true;
  assert.throws(()=>e.move('entry-1','recycled'),/Could not persist/);
  assert.notEqual(e.catalogRevision,rev);
  assert.equal(e.dashboardState(rev).catalog.recycledQueue.length,0);
});

test('Queue pages are capped and reorder indexes remain absolute after searching',()=>{
  const list=Array.from({length:2000},(_,i)=>({id:`${i}`,videoId:`v${i}`,title:`Title ${i}`}));
  const p=queuePage(list,3);
  assert.equal(p.items.length,QUEUE_PAGE_SIZE);assert.equal(p.items[0].index,150);
  assert.equal(queuePage(list,4000).page,39);
  const found=queuePage(list,0,'Title 1999');
  assert.equal(found.items.length,1);assert.equal(found.items[0].index,1999);
  assert.equal(queuePage([],4).page,0);assert.equal(queuePage(list,-5).page,0);
});

test('Single-flight refresh coalesces concurrent calls and keeps at most one request in flight',async()=>{
  let active=0,max=0,count=0;const release=[];
  const request=singleFlight(async()=>{active++;max=Math.max(max,active);count++;await new Promise(resolve=>release.push(resolve));active--;});
  const a=request();await Promise.resolve();
  const b=request(),c=request();assert.equal(a,b);assert.equal(a,c);
  release.shift()();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(count,2);assert.equal(max,1);release.shift()();await a;
});

test('Refresh can recover after a failed request',async()=>{
  let fail=true;const request=singleFlight(async()=>{if(fail)throw new Error('offline');return true;});
  await assert.rejects(request(),/offline/);fail=false;await request();
});

test('Metadata scheduling enumerates a large queue once, not once per video ID',()=>{
  const engine=seed(new PlaybackEngine(null),1000);let scans=0;
  const original=engine.allQueued.bind(engine);engine.allQueued=()=>{scans++;return original();};
  const q=new TitleMetadataQueue(engine,{resolver:async()=>null});
  q.enqueue(original().map(v=>v.videoId));assert.equal(scans,1);q.close();
});

test('Compact operator API stays authenticated; queue revision survives ticks and changes after moves',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-compact-'));
  const app=createApp({dataDir:dir,port:0,twitchEnabled:false,titleResolver:async()=>null,env:{ADMIN_TOKEN:'test-token'}});
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  seed(app.engine,1000);const {port}=await app.listen();const base=`http://127.0.0.1:${port}/api`;
  assert.equal((await fetch(`${base}/operator?compact=1`)).status,401);
  const login=await fetch(`${base}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'test-token'})});
  const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
  const first=await (await fetch(`${base}/operator?compact=1`,{headers})).json();
  assert.equal(first.catalog.upcomingQueue.length,999);
  const delta=await fetch(`${base}/operator?compact=1&catalog=${encodeURIComponent(first.catalogRevision)}`,{headers});
  const raw=await delta.text();assert.ok(Buffer.byteLength(raw)<8000);assert.equal(JSON.parse(raw).catalog,undefined);
  const settings=await (await fetch(`${base}/operator?compact=1&catalog=omit`,{headers})).json();assert.equal(settings.catalog,undefined);assert.ok(settings.settings);
  app.engine.move('entry-1','recycled');
  const moved=await (await fetch(`${base}/operator?compact=1&catalog=${encodeURIComponent(first.catalogRevision)}`,{headers})).json();
  assert.equal(moved.catalog.recycledQueue.length,1);
  // Old clients still receive the original complete snapshot.
  const full=await (await fetch(`${base}/operator`,{headers})).json();assert.equal(full.queue.length,998);
  const pub=await (await fetch(`${base}/public?compact=1`)).json();assert.equal(pub.queue,undefined);assert.ok(pub.current);
});
