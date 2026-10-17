import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PlaybackEngine,migrateState} from '../lib/engine.js';
import {DurableStore} from '../lib/store.js';
import {createApp} from '../lib/http.js';

const ids=['dQw4w9WgXcQ','jNQXAC9IVRw','aqz-KE-bpKQ','M7lc1UVf-VE','jfKfPfyJRdk','LXb3EKWsInQ','4WXs3sKu41I'];
function engineFixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-rotation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new DurableStore(dir);let now=1_000_000;const engine=new PlaybackEngine(store,{clock:()=>now});return {engine,store,dir,addTime:(ms=1000)=>{now+=ms;}};}

test('Old v1.1.0 state migrates to Upcoming and preserves playhead without playing recycled videos',t=>{
  const {dir}=engineFixture(t);
  const legacy={schemaVersion:1,revision:33,layoutRevision:7,generation:14,settings:{loop:true},current:{id:'cur',videoId:ids[0],title:'Stream 2025',position:3190,paused:true,duration:12000},queue:[{id:'up',videoId:ids[1],title:'New video'}],history:[],audio:{volume:42,muted:false}};
  const stateFile=path.join(dir,'state.json');fs.writeFileSync(stateFile,JSON.stringify(legacy));
  const engine=new PlaybackEngine(new DurableStore(dir));
  assert.equal(engine.state.schemaVersion,2);assert.equal(engine.state.rotationNumber,1);
  assert.equal(engine.state.current.position,3190);assert.equal(engine.state.current.paused,true);
  assert.equal(engine.state.queue[0].id,'up');assert.deepEqual(engine.state.recycledQueue,[]);
  assert.equal(engine.state.audio.volume,42);
  assert.ok(fs.existsSync(path.join(dir,'state.before-rotation-migration.json')));
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).schemaVersion,2);
});

test('New videos always play before recycled videos in long running rotations',t=>{
  const {engine,store}=engineFixture(t);
  engine.add(ids[0],'2019 old');engine.add(ids[1],'2019 part two');
  engine.skip();assert.deepEqual(engine.state.recycledQueue.map(v=>v.videoId),[ids[0]]);
  engine.add(ids[2],'2025 new');
  engine.skip();assert.equal(engine.state.current.videoId,ids[2]);
  assert.deepEqual(engine.state.recycledQueue.map(v=>v.videoId),[ids[0],ids[1]]);
  const gen=engine.state.generation;
  engine.ended(gen); // 2025 finishes; recycled pool rotates when Upcoming is exhausted
  assert.ok(engine.state.vote); // end-of-video voting prefers the new rotation after rollover
  assert.equal(engine.state.rotationNumber,2);
  assert.deepEqual(engine.publicState().queue.map(v=>v.videoId),[ids[0],ids[1]]);
  engine.choose(1);
  assert.equal(engine.state.current.videoId,ids[0]);
  assert.equal(engine.state.recycledQueue.at(-1).videoId,ids[2]);
  const restored=new PlaybackEngine(store);
  assert.equal(restored.state.rotationNumber,2);
  assert.deepEqual(restored.publicState().queue.map(v=>v.videoId),[ids[1]]);
});

test('Play Next overrides Upcoming; Next Rotation remains deferred until rollover',t=>{
  const {engine}=engineFixture(t);
  engine.add(ids[0]);engine.add(ids[1]);engine.add(ids[2],null,{destination:'nextRotation'});
  engine.add(ids[3],null,{destination:'playNext'});
  assert.deepEqual(engine.publicState().queue.map(v=>v.videoId),[ids[3],ids[1]]);
  engine.skip();assert.equal(engine.state.current.videoId,ids[3]);
  engine.skip();assert.equal(engine.state.current.videoId,ids[1]);
  engine.skip();assert.equal(engine.state.rotationNumber,2);
  assert.equal(engine.state.current.videoId,ids[2],'deferred new video leads next rotation');
  assert.deepEqual(engine.publicState().queue.map(v=>v.videoId),[ids[0],ids[3],ids[1]]);
});

test('Play Now parks interrupted current at the exact position for next playback',t=>{
  const {engine}=engineFixture(t);
  engine.add(ids[0]);engine.add(ids[1]);engine.add(ids[2]);
  engine.seek(123);
  const selected=engine.state.queue.at(-1).id;
  engine.playNow(selected);
  assert.equal(engine.state.current.videoId,ids[2]);
  assert.equal(engine.state.priorityQueue[0].videoId,ids[0]);
  assert.equal(engine.state.priorityQueue[0].position,123);
  assert.equal(engine.state.recycledQueue.length,0);
  engine.skip();assert.equal(engine.state.current.videoId,ids[0]);
  assert.equal(engine.state.current.position,123,'interrupted playhead is resumed');
});

test('Bulk move, sorting and shuffle affect Upcoming only and support permanent IDs',t=>{
  const {engine}=engineFixture(t);
  engine.add(ids[0]);engine.add(ids[1],'Zulu');engine.add(ids[2],'Alpha');engine.add(ids[3],'Beta');
  const [a,b,c]=engine.state.queue.map(v=>v.id);
  assert.throws(()=>engine.moveMany([a,'missing'],'nextRotation'),/not found/);
  assert.deepEqual(engine.state.queue.map(v=>v.id),[a,b,c]);
  engine.moveMany([a,b],'nextRotation');
  assert.deepEqual(engine.state.nextRotationQueue.map(v=>v.id),[a,b]);
  engine.move(b,'playNext');assert.equal(engine.state.priorityQueue[0].id,b);
  engine.sortUpcoming('title');assert.deepEqual(engine.state.queue.map(v=>v.id),[c]);
  engine.sortUpcoming('shuffle');assert.equal(engine.state.priorityQueue[0].id,b);
  engine.reorder(a,0); // deferred lane
  engine.remove(a);assert.deepEqual(engine.state.nextRotationQueue,[]);
  assert.throws(()=>engine.move(b,'invalid'),/destination/);
});

test('Voting considers priority and upcoming but never offers recycled while unplayed remain',t=>{
  const {engine}=engineFixture(t);
  engine.add(ids[0]);engine.add(ids[1]);engine.add(ids[2],null,{destination:'playNext'});
  engine.startVote();assert.equal(engine.state.vote.choices[0],engine.state.priorityQueue[0].id);
  const next=engine.state.priorityQueue[0].id;
  engine.voteChoice(1,'viewer');engine.move(next,'recycled');
  assert.deepEqual(engine.getVotes(),[0,0,0,0]);
  assert.equal(engine.state.vote.choices[0],null);
  engine.conclude();assert.equal(engine.state.current.videoId,ids[1]);
  assert.equal(engine.state.rotationNumber,1);
});

test('Unavailable items never enter recycled pool or repeat endlessly',t=>{
  const {engine}=engineFixture(t);
  engine.add(ids[0]);engine.add(ids[1]);
  engine.failVideo();assert.equal(engine.state.history[0].unavailable,true);
  assert.equal(engine.state.recycledQueue.length,0);
  engine.failVideo();assert.equal(engine.state.current,null);
  assert.equal(engine.state.rotationNumber,1);
});

test('Playlist import respects destinations and duplicates without a total queue cap',t=>{
  const {engine}=engineFixture(t);
  engine.add(ids[0]);engine.add(ids[1]);engine.skip();
  const videos=[
    {videoId:ids[2],title:'Recent',publishedAt:'2025-01-01'},
    {videoId:ids[3],title:'Old',publishedAt:'2020-02-02'},
    {videoId:ids[0],title:'Duplicate in recycled'},
  ];
  const res=engine.importPlaylist(videos,{destination:'nextRotation',order:'oldest'});
  assert.equal(res.added,2);assert.equal(res.skipped,1);
  assert.deepEqual(engine.state.nextRotationQueue.map(v=>v.videoId),[ids[3],ids[2]]);
  assert.equal(engine.state.current.videoId,ids[1]);
  assert.throws(()=>engine.importPlaylist(videos,{destination:'invalid'}),/destination/);
  assert.throws(()=>engine.importPlaylist(videos,{order:'descending'}),/ordering/);
  assert.throws(()=>engine.importPlaylist(videos,{skipDuplicates:'no'}),/duplicate option/);
  assert.equal(engine.state.nextRotationQueue.length,2);
  // More than 2,000 recycled entries must not stop a new import.
  engine.state.recycledQueue=Array.from({length:2500},(_,i)=>({id:`extra${i}`,videoId:ids[4],title:'Extra'}));
  assert.equal(engine.importPlaylist([{videoId:ids[5],title:'New'}],{skipDuplicates:false}).added,1);
  assert.ok(engine.storedCount()>2500);
});

test('HTTP queue lane actions are authenticated and survive a real server restart',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-rotation-http-'));t.after(async()=>{if(app?.server.listening)await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  let app,base;
  const start=async()=>{app=createApp({dataDir:dir,port:0,env:{ADMIN_TOKEN:'test-password'},twitchEnabled:false,titleResolver:async()=>null});const a=await app.listen();base=`http://127.0.0.1:${a.port}`;};
  const api=async(route,data,cookie='')=>{const res=await fetch(`${base}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});return {code:res.status,json:await res.json()};};
  await start();t.after(async()=>{if(app.server.listening)await app.close();});
  const auth=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'test-password'})});
  const cookie=auth.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('control',{action:'add',url:ids[0]})).code,401);
  await api('control',{action:'add',url:ids[0]},cookie);
  await api('control',{action:'add',url:ids[1],destination:'playNext'},cookie);
  await api('control',{action:'add',url:ids[2],destination:'nextRotation'},cookie);
  let state=(await (await fetch(`${base}/api/operator`,{headers:{Cookie:cookie}})).json());
  assert.equal(state.priorityQueue.length,1);assert.equal(state.nextRotationQueue.length,1);
  const id=state.priorityQueue[0].id;
  assert.equal((await api('control',{action:'move',id,destination:'recycled'},cookie)).code,200);
  state=(await (await fetch(`${base}/api/operator`,{headers:{Cookie:cookie}})).json());
  assert.equal(state.priorityQueue.length,0);assert.equal(state.recycledQueue.length,1);
  await app.close();await start();
  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'test-password'})});
  const cookie2=login.headers.get('set-cookie').split(';')[0];
  state=(await (await fetch(`${base}/api/operator`,{headers:{Cookie:cookie2}})).json());
  assert.equal(state.recycledQueue[0].id,id);assert.equal(state.current.videoId,ids[0]);
  assert.equal(state.rotationNumber,1);
});
