import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(){
 const nodes=new Map(),timers=[],requests=[],scripts=[],instances=[];let now=100000,failLoad=false;
 const element=()=>({classList:{toggle(){},contains(){return false;}},dataset:{},replaceChildren(){},prepend(){},remove(){this.removed=true;},replaceWith(mount){nodes.set('ytMount',mount);}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const snapshot={generation:7,current:{videoId:'dQw4w9WgXcQ',position:123,paused:false},vote:null,audio:{volume:40,muted:false},layoutRevision:1,settings:{colors:{},lowerThird:{},skipThreshold:3}};
 const window={addEventListener(){}};
 const context={URL,window,location:{href:'http://127.0.0.1:4177/player',origin:'http://127.0.0.1:4177'},sessionStorage:{getItem(){return null;},setItem(){}},crypto:{randomUUID:()=> '00000000-0000-0000-0000-000000000001'},Date:{now:()=>now},$,applyTheme(){},applyLowerThird(){},setTicker(){},renderVoteScreen(){},applyYouTubeAudio:()=>true,formatTime:()=>'',setInterval:(fn,ms)=>timers.push({fn,ms}),document:{createElement:element,head:{append:s=>scripts.push(s)}},api:async(route,options)=>{requests.push({route,options});if(route.startsWith('public'))return structuredClone(snapshot);return {workerId:'00000000-0000-0000-0000-000000000001'};}};
 const source=fs.readFileSync(new URL('../public/assets/player.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(source,context);
 function installAPI(){
  function Player(id,config){
   this.config=config;this.state=-1;this.calls=[];this.videoId=snapshot.current.videoId;
   this.loadVideoById=value=>{if(failLoad)throw new Error('not ready');this.calls.push(['load',value]);};
   this.cueVideoById=value=>this.calls.push(['cue',value]);this.playVideo=()=>this.calls.push(['play']);this.pauseVideo=()=>this.calls.push(['pause']);
   this.getPlayerState=()=>this.state;this.getCurrentTime=()=>0;this.getDuration=()=>200;this.getVideoData=()=>({video_id:this.videoId});this.destroy=()=>this.destroyed=true;
   instances.push(this);
  }
  window.YT={Player,PlayerState:{PLAYING:1,ENDED:0}};context.YT=window.YT;
 }
 return {snapshot,timers,requests,scripts,instances,installAPI,run:code=>vm.runInNewContext(code,context),advance:ms=>now+=ms,set failLoad(v){failLoad=v;}};
}

test('OBS retries a missing YouTube API and rebuilds an iframe that never becomes ready',()=>{
 const h=harness();assert.equal(h.scripts.length,1);h.run('ensureYouTube()');assert.equal(h.scripts.length,2);assert.equal(h.scripts[0].removed,true);
 h.installAPI();h.run('ensureYouTube();ensureYouTube()');assert.equal(h.instances.length,1);
 h.advance(30001);h.run('ensureYouTube()');assert.equal(h.instances.length,2);assert.equal(h.instances[0].destroyed,true);
});

test('OBS retries a failed initial load and unstarted playback at the saved position',async()=>{
 const h=harness();h.installAPI();h.run('ensureYouTube()');const player=h.instances[0];h.failLoad=true;
 player.config.events.onReady();await h.run('poll()');assert.equal(player.calls.length,0);
 h.failLoad=false;await h.run('poll()');assert.equal(player.calls[0][0],'load');assert.equal(player.calls[0][1].startSeconds,123);
 player.calls.length=0;h.advance(15001);await h.run('poll()');assert.ok(player.calls.some(c=>c[0]==='play'));assert.equal(player.calls.find(c=>c[0]==='load')[1].startSeconds,123);
});

test('OBS recovery preserves paused playback and skips startup progress from wrong/unready videos',async()=>{
 const h=harness();h.snapshot.current.paused=true;h.installAPI();h.run('ensureYouTube()');const player=h.instances[0];await h.run('poll()');player.config.events.onReady();await h.run('poll()');
 assert.ok(player.calls.some(c=>c[0]==='cue'));h.advance(40000);await h.run('poll()');assert.ok(!player.calls.some(c=>c[0]==='play'||c[0]==='load'));
 const progress=h.timers.find(t=>t.ms===2000).fn;await progress();assert.ok(!h.requests.some(r=>r.route==='worker/progress'));
 player.state=2;player.videoId='wrong';await progress();assert.ok(!h.requests.some(r=>r.route==='worker/progress'));
 player.videoId=h.snapshot.current.videoId;await progress();assert.ok(h.requests.some(r=>r.route==='worker/progress'));
});

test('Transient HTML5 startup errors recover without quarantining videos or accepting stale iframe callbacks',async()=>{
 const h=harness();h.installAPI();h.run('ensureYouTube()');const old=h.instances[0];old.config.events.onReady();await h.run('poll()');
 old.config.events.onError({data:5});assert.ok(!h.requests.some(r=>r.route==='worker/error'));
 h.advance(30001);h.run('ensureYouTube()');assert.equal(h.instances.length,2);
 old.config.events.onReady();old.config.events.onError({data:100});assert.ok(!h.requests.some(r=>r.route==='worker/error'));
 assert.equal(h.run('ytReady'),false);h.instances[1].config.events.onReady();assert.equal(h.run('ytReady'),true);
});
