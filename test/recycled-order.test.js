import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PlaybackEngine,vodTitleDate,migrateState} from '../lib/engine.js';
import {SQLiteStore} from '../lib/sqlite-store.js';
import {createApp} from '../lib/http.js';
const videoId='dQw4w9WgXcQ';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-recycled-order-'));
 let store=new SQLiteStore(dir),engine=new PlaybackEngine(store);
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {get engine(){return engine;},reload(){store.close();store=new SQLiteStore(dir);engine=new PlaybackEngine(store);return engine;}};
}
const titles=engine=>engine.state.recycledQueue.map(v=>v.title);
const add=(engine,title)=>engine.add(videoId,title,{destination:'recycled'});

test('VOD title dates support year-first dates and years, rejecting invalid calendar dates',()=>{
 for(const value of ['Stream 2023-05-12','2023.05.12 VOD','VOD 2023/5/12','2023_05_12'])assert.equal(vodTitleDate(value),Date.UTC(2023,4,12));
 assert.equal(vodTitleDate('Archive 2023'),Date.UTC(2023,0,1));
 assert.equal(vodTitleDate('VOD 2023-02-29'),null);
 assert.equal(vodTitleDate('2024-02-29'),Date.UTC(2024,1,29));
 assert.equal(vodTitleDate('Archive with no date'),null);
 assert.equal(migrateState(null).recycledOrder,'manual');
 assert.equal(migrateState({schemaVersion:2,recycledOrder:'invalid'}).recycledOrder,'manual');
});

test('Recycled sorts the whole lane, uses title dates instead of upload dates and survives SQLite reload',t=>{
 const f=fixture(t),engine=f.engine;
 engine.add(videoId,'Currently playing');engine.seek(84);engine.pause(true);
 const current=structuredClone(engine.state.current),generation=engine.state.generation;
 const a=add(engine,'2024-03-01 Zebra'),b=add(engine,'2022.01.02 Alpha');
 add(engine,'Undated archive');add(engine,'2023 VOD');
 a.publishedAt='2000-01-01';b.publishedAt='2030-01-01';
 engine.sortRecycled('oldest');
 assert.deepEqual(titles(engine),['2022.01.02 Alpha','2023 VOD','2024-03-01 Zebra','Undated archive']);
 assert.deepEqual(engine.state.current,current);assert.equal(engine.state.generation,generation);
 const reloaded=f.reload();assert.equal(reloaded.state.recycledOrder,'oldest');
 add(reloaded,'2023-06-01 Middle');
 assert.deepEqual(titles(reloaded),['2022.01.02 Alpha','2023 VOD','2023-06-01 Middle','2024-03-01 Zebra','Undated archive']);
 reloaded.sortRecycled('newest');assert.equal(titles(reloaded)[0],'2024-03-01 Zebra');assert.equal(titles(reloaded).at(-1),'Undated archive');
 reloaded.sortRecycled('title');const expected=[...titles(reloaded)].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
 assert.deepEqual(titles(reloaded),expected);
 const before=titles(reloaded);assert.throws(()=>reloaded.sortRecycled('wrong'));
 assert.deepEqual(titles(reloaded),before);
});

test('single moves, bulk moves, imports, completed videos and discovered titles follow saved Recycled ordering',t=>{
 const {engine}=fixture(t);engine.add(videoId,'2023-06-01 Playing');
 engine.sortRecycled('oldest');add(engine,'2022 VOD');add(engine,'2025 VOD');
 const moved=engine.add(videoId,'2024 VOD');engine.move(moved.id,'recycled');
 const many=engine.add(videoId,'2021 VOD');engine.moveMany([many.id],'recycled');
 engine.bulkAdd([{videoId,title:'2020 VOD'}],{destination:'recycled'});
 engine.importPlaylist([{videoId,title:'2019 VOD'}],{destination:'recycled',skipDuplicates:false});
 engine.add(videoId,'Next video');engine.skip();
 assert.deepEqual(titles(engine),['2019 VOD','2020 VOD','2021 VOD','2022 VOD','2023-06-01 Playing','2024 VOD','2025 VOD']);
 const unknown=engine.add('jNQXAC9IVRw','',{destination:'recycled'});
 engine.applyDiscoveredTitle(unknown.videoId,'2018.05.06 Discovered');
 assert.equal(titles(engine)[0],'2018.05.06 Discovered');
 engine.reorder(unknown.id,engine.state.recycledQueue.length-1);
 assert.equal(engine.state.recycledOrder,'manual');
 add(engine,'2017 VOD');assert.equal(titles(engine).at(-1),'2017 VOD');
});

test('sorting spans more than one dashboard page and leaves unrelated lanes untouched',t=>{
 const {engine}=fixture(t);engine.add(videoId,'Playing');
 const upcoming=engine.add(videoId,'Upcoming');
 engine.bulkAdd(Array.from({length:300},(_,i)=>({videoId,title:`2023-01-01 Part ${300-i}`})),{destination:'recycled'});
 engine.sortRecycled('title');
 assert.equal(titles(engine)[0],'2023-01-01 Part 1');assert.equal(titles(engine).at(-1),'2023-01-01 Part 300');
 assert.deepEqual(engine.state.queue.map(v=>v.id),[upcoming.id]);
 assert.equal(engine.dashboardState().recycledOrder,'title');
});

test('Recycled HTTP sorting requires operator authentication and reports the saved order',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-recycled-http-'));
 const app=createApp({dataDir:dir,port:0,chatEnabled:false,titleResolver:async()=>null,env:{ADMIN_TOKEN:'sort-test'}});
 await app.listen();t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const post=(route,body,cookie='')=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
 assert.equal((await post('control',{action:'sortRecycled',order:'oldest'})).status,401);
 const login=await post('login',{token:'sort-test'}),cookie=login.headers.get('set-cookie').split(';')[0];await login.json();
 for(const title of ['2024 VOD','2022 VOD'])assert.equal((await post('control',{action:'add',url:videoId,title,destination:'recycled'},cookie)).status,200);
 assert.equal((await post('control',{action:'sortRecycled',order:'oldest'},cookie)).status,200);
 const state=await (await fetch(base+'/api/operator',{headers:{Cookie:cookie}})).json();
 assert.equal(state.recycledOrder,'oldest');assert.equal(state.current,null);
 assert.deepEqual(state.recycledQueue.map(v=>v.title),['2022 VOD','2024 VOD']);
 assert.equal((await post('control',{action:'sortRecycled',order:'invalid'},cookie)).status,400);
});
