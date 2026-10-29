import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../lib/http.js';

test('overlay follows visible output, rejects stale readiness, and preserves public privacy',async t=>{
  let now=10000;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-overlay-'));
  const app=createApp({dataDir:dir,port:0,clock:()=>now,twitchEnabled:false,chatEnabled:false,titleResolver:async()=>null});
  await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const post=async(route,data)=>{const r=await fetch(base+'/api/worker/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,...await r.json()};};
  const overlay=()=>fetch(base+'/api/overlay').then(r=>r.json());
  const workerId='00000000-0000-0000-0000-000000000001';
  app.engine.add('dQw4w9WgXcQ','First');app.engine.add('jNQXAC9IVRw','Second');
  // Ordinary browser sources and old plugins retain their existing behavior.
  assert.equal((await overlay()).current.title,'First');
  await post('claim',{workerId,displaySync:true});
  const firstGeneration=app.engine.state.generation;
  app.engine.skip();
  const generation=app.engine.state.generation,videoId=app.engine.state.current.videoId;
  assert.equal((await overlay()).current.title,'First');
  assert.equal((await fetch(base+'/api/public').then(r=>r.json())).current.title,'Second');
  assert.equal((await post('display',{workerId,generation:firstGeneration,videoId,displayReady:true})).accepted,false);
  assert.equal((await post('display',{workerId,generation,videoId:'dQw4w9WgXcQ',displayReady:true})).accepted,false);
  assert.equal((await post('display',{workerId:'wrong',generation,videoId,displayReady:true})).status,409);
  assert.equal((await post('display',{workerId,generation,videoId,displayReady:false})).accepted,false);
  assert.equal((await overlay()).current.title,'First');
  assert.equal((await post('display',{workerId,generation,videoId,displayReady:true})).accepted,true);
  now+=299;assert.equal((await overlay()).current.title,'First');
  // Repeated readiness must not keep delaying the title.
  await post('display',{workerId,generation,videoId,displayReady:true});
  now++;assert.equal((await overlay()).current.title,'Second');
  app.engine.state.current.title='Discovered title';
  assert.equal((await overlay()).current.title,'Discovered title');
  app.engine.previous();assert.equal((await overlay()).current.title,'Discovered title');
  await post('display',{workerId,generation:app.engine.state.generation,videoId:app.engine.state.current.videoId,displayReady:true});
  now+=300;assert.equal((await overlay()).current.title,'First');
  app.engine.skip();now+=12001;
  const expired=await overlay();assert.equal(expired.current.title,'Discovered title');
  assert.equal(expired.settings.twitchAdminWhitelist,undefined);
  assert.equal(expired.chatAdminActivity,undefined);
});
