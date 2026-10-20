import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../lib/http.js';
const source=fs.readFileSync(new URL('../obs-plugin/watch-controller.js',import.meta.url),'utf8');
function harness(){
 const style=()=>({values:{},priorities:{},setProperty(name,value,priority=''){this.values[name]=value;this.priorities[name]=priority;},
  getPropertyValue(name){return this.values[name]||'';},getPropertyPriority(name){return this.priorities[name]||'';},removeProperty(name){delete this.values[name];delete this.priorities[name];}});
 const listeners=new Map();
 const video={style:style(),readyState:4,duration:240,currentTime:0,paused:true,ended:false,volume:1,muted:false,
  addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);},
  pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();}};
 const player={style:style(),classList:{contains:()=>ad}};
 const document={title:'YouTube',documentElement:{style:style()},body:{style:style(),appendChild(node){node.parentElement=this;}},
  querySelector(selector){if(selector==='video.html5-main-video')return video;if(selector==='#movie_player')return player;return barrier?{getClientRects:()=>[{}],textContent:'Access required'}:null;}};
 const controls=[{style:style()},{style:style()}];
 document.querySelectorAll=selector=>selector.startsWith('.ytp-chrome-bottom')?controls:barrier?[{getClientRects:()=>[{}],textContent:'Confirmation required'}]:[];
 let ad=false,barrier=false,now=0;
 const context={window:{},document,URL,performance:{now:()=>now},location:new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ')};
 const defaults={nonce:'nonce',generation:1,videoId:'dQw4w9WgXcQ',position:35,volume:70,muted:false,paused:false,voting:false};
 return {video,player,controls,context,listeners,advance(ms){now+=ms;},setAd(value){ad=value;},setBarrier(value){barrier=value;},run(fields={}){
  document.title='YouTube';vm.runInNewContext(source.replace('__PLAYBACK_COMMAND__',JSON.stringify({...defaults,...fields})),context);
  return document.title.startsWith('fPlayback:')?JSON.parse(document.title.slice('fPlayback:nonce:'.length)):null;
 }};
}

test('output lock hides transport chrome and restores its exact styles for manual interaction, ads and barriers',()=>{
 const h=harness();h.controls[0].style.setProperty('opacity','.8','important');
 h.run({locked:true});assert.equal(h.controls[0].style.values.visibility,'hidden');assert.equal(h.controls[1].style.values['pointer-events'],'none');
 h.run({locked:false});assert.equal(h.controls[0].style.values.opacity,'.8');assert.equal(h.controls[0].style.getPropertyPriority('opacity'),'important');assert.equal(h.controls[1].style.getPropertyValue('visibility'),'');
 for(const type of ['ad','barrier']){
  h.run({locked:true});if(type==='ad')h.setAd(true);else h.setBarrier(true);
  const report=h.run({locked:true});assert.equal(report.position,undefined);assert.equal(h.controls[0].style.values.opacity,'.8');
  h.setAd(false);h.setBarrier(false);
 }
 h.run({locked:true,generation:2});h.run({locked:false,generation:3});assert.equal(h.controls[0].style.values.opacity,'.8');
});
test('watch controller uses the normal matching YouTube page and applies seek only once per generation',()=>{
 const h=harness();let report=h.run();assert.equal(h.video.currentTime,35);assert.equal(h.video.paused,false);assert.equal(report.position,35);
 assert.equal(report.href,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 assert.equal(h.player.parentElement,h.context.document.body);
 assert.equal(h.player.style.values.position,'fixed');assert.equal(h.video.style.values['object-fit'],'contain');
 h.video.currentTime=40;h.run();assert.equal(h.video.currentTime,40);
 h.run({generation:2,position:90,paused:true});assert.equal(h.video.currentTime,90);assert.equal(h.video.paused,true);
 h.context.location=new URL('https://accounts.google.com/');assert.equal(h.run(),null);
 h.context.location=new URL('https://www.youtube.com/watch?v=jNQXAC9IVRw');assert.equal(h.run(),null);
});
test('watch controller recovers the delayed initial homepage without navigating account or other video pages',()=>{
 const h=harness();let destination='';
 h.context.location={origin:'https://www.youtube.com',pathname:'/',replace(url){destination=url;}};
 assert.equal(h.run(),null);assert.equal(destination,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 destination='';h.context.location={origin:'https://accounts.google.com',pathname:'/',replace(url){destination=url;}};
 assert.equal(h.run(),null);assert.equal(destination,'');
});
test('watch controller preserves audio, pause, vote and completed-video transitions',()=>{
 const h=harness();h.run({volume:0,muted:true});assert.equal(h.video.volume,0);assert.equal(h.video.muted,true);
 h.run({volume:50,muted:false});assert.equal(h.video.volume,.5);assert.equal(h.video.muted,false);
 h.run({voting:true});assert.equal(h.video.paused,true);assert.equal(h.run({voting:true}).position,undefined);
 h.run();h.video.ended=true;assert.equal(h.run().ended,true);
 // Completion remains retryable if the native request is lost.
 assert.equal(h.run().ended,true);
 assert.equal(h.run({generation:2,paused:true}).ended,undefined);
});
test('watch controller holds advertisements, missing playback and account barriers without reporting completion',()=>{
 const h=harness();h.video.ended=true;h.setAd(true);assert.match(h.run().status,/Advertisement/);assert.equal(h.video.currentTime,0);
 h.setAd(false);h.setBarrier(true);let result=h.run();assert.match(result.status,/attention/);assert.equal(result.ended,undefined);assert.equal(result.position,undefined);
 h.setBarrier(false);h.video.readyState=0;result=h.run();assert.match(result.status,/access/);assert.equal(result.ended,undefined);
 // No selector or code path clicks any sign-in or content confirmation.
 assert.doesNotMatch(source,/\.click\(|fetch\(|document\.cookie|localStorage/);
});
test('ended event reports immediately before YouTube autoplay navigates, while stale and ad events are ignored',()=>{
 const h=harness();h.run();const old=h.listeners.get('ended');old();assert.match(h.context.document.title,/"ended":true/);
 h.run({generation:2});h.context.document.title='unchanged';old();assert.equal(h.context.document.title,'unchanged');
 h.setAd(true);h.listeners.get('ended')();assert.equal(h.context.document.title,'unchanged');
 h.setAd(false);h.context.location=new URL('https://www.youtube.com/watch?v=jNQXAC9IVRw');h.listeners.get('ended')();assert.equal(h.context.document.title,'unchanged');
});
test('watchdog detects stalled and buffering playback without advancing the queue or overwriting the checkpoint',()=>{
 for(const readyState of [2,4]){
  const h=harness();h.run();h.video.readyState=readyState;
  h.advance(9999);assert.equal(h.run().recover,undefined);
  h.advance(1);const report=h.run();assert.equal(report.recover,readyState===2?'buffering':'stalled');
  assert.equal(report.position,undefined);assert.equal(report.ended,undefined);assert.equal(h.video.currentTime,35);
  h.advance(1000);assert.equal(h.run().recover,report.recover);
 }
});
test('watchdog resets on genuine progress, seeks and generation changes',()=>{
 const h=harness();h.run();h.advance(9000);h.video.currentTime=36;h.run();
 h.advance(9000);assert.equal(h.run().recover,undefined);
 h.video.currentTime=10;h.run();h.advance(9000);assert.equal(h.run().recover,undefined);
 h.run({generation:2,position:70});h.advance(9999);assert.equal(h.run({generation:2,position:70}).recover,undefined);
 h.advance(1);assert.equal(h.run({generation:2,position:70}).recover,'stalled');
});
test('watchdog holds intentional pauses, votes, advertisements and confirmation dialogs',()=>{
 for(const mode of ['paused','voting','ad','barrier']){
  const h=harness();h.run();
  const command=mode==='paused'?{paused:true}:mode==='voting'?{voting:true}:{};
  if(mode==='ad')h.setAd(true);if(mode==='barrier')h.setBarrier(true);
  h.advance(60000);const held=h.run(command);assert.equal(held.recover,undefined);
  h.setAd(false);h.setBarrier(false);assert.equal(h.run().recover,undefined);
  h.advance(9999);assert.equal(h.run().recover,undefined);
 }
});
test('watchdog gives startup time to load and resets its wait during pauses',()=>{
 const h=harness();h.video.readyState=0;h.run();h.advance(29999);assert.equal(h.run().recover,undefined);
 h.advance(1);assert.equal(h.run().recover,'startup');
 h.advance(60000);assert.equal(h.run({paused:true}).recover,undefined);
 assert.equal(h.run().recover,undefined);h.advance(30000);assert.equal(h.run().recover,'startup');
});
test('watchdog leaves blocked autoplay for manual Play and ignores old rejected play promises',async()=>{
 const h=harness();h.video.play=()=>Promise.reject(Object.assign(new Error('gesture required'),{name:'NotAllowedError'}));
 h.run();await Promise.resolve();h.advance(60000);assert.equal(h.run().recover,undefined);
 h.video.paused=false;h.video.currentTime=36;assert.equal(h.run().recover,undefined);
 h.advance(10000);assert.equal(h.run().recover,'stalled');
 const newer=harness();let reject;
 newer.video.play=()=>new Promise((resolve,no)=>{reject=no;});newer.run();
 newer.video.paused=false;newer.run({generation:2});reject(Object.assign(new Error('late'),{name:'NotAllowedError'}));await Promise.resolve();
 assert.equal(newer.context.window.__fPlaybackWatch.autoplayBlocked,false);
});
test('local worker ownership transfers explicitly and stale output cannot release or advance the active output',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-native-'));
 const app=createApp({dataDir:dir,port:0,twitchEnabled:false,chatEnabled:false,titleResolver:async()=>null,env:{ADMIN_TOKEN:'test-native'}});
 await app.listen();t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 assert.equal((await fetch(base+'/overlay')).status,200);
 const overlay=await (await fetch(base+'/assets/overlay.js')).text();assert.doesNotMatch(overlay,/worker\/|youtube\.com|iframe/);
 const post=(route,data)=>fetch(base+'/api/worker/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
 app.engine.add('dQw4w9WgXcQ','First');app.engine.add('jNQXAC9IVRw','Next');const gen=app.engine.state.generation;
 assert.equal((await post('claim',{workerId:a})).status,200);
 assert.equal((await post('claim',{workerId:b})).status,409);
 assert.equal((await post('release',{workerId:b})).status,409);
 assert.equal((await post('release',{workerId:a})).status,200);
 assert.equal((await post('claim',{workerId:b})).status,200);
 assert.equal((await post('release',{workerId:a})).status,409);
 assert.equal((await post('ended',{workerId:a,generation:gen})).status,409);
 assert.equal((await post('progress',{workerId:b,generation:gen,position:45,duration:240})).status,200);
 assert.equal(app.engine.state.current.position,45);
 app.engine.seek(100);const stale=await (await post('progress',{workerId:b,generation:gen,position:46,duration:240})).json();assert.equal(stale.accepted,false);
 assert.equal(app.engine.state.current.position,100);
});
