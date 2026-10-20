import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness({account=false}={}){
 const nodes=new Map(),timers=[],requests=[],scripts=[],instances=[];let now=100000,failLoad=false;
 const element=()=>{const classes=new Set(),listeners=new Map();return {textContent:'',listeners,addEventListener:(type,fn)=>listeners.set(type,fn),classList:{toggle(key,on){if(on)classes.add(key);else classes.delete(key);},contains:key=>classes.has(key)},dataset:{},replaceChildren(){},prepend(){},remove(){this.removed=true;},replaceWith(mount){nodes.set('ytMount',mount);}};};
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const snapshot={generation:7,current:{videoId:'dQw4w9WgXcQ',position:123,paused:false},vote:null,audio:{volume:40,muted:false},layoutRevision:1,settings:{colors:{},lowerThird:{},skipThreshold:3,youtubeAccountPlayback:account}};
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
 return {$,snapshot,timers,requests,scripts,instances,installAPI,run:code=>vm.runInNewContext(code,context),advance:ms=>now+=ms,set failLoad(v){failLoad=v;}};
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

test('Account mode uses regular YouTube embed and holds access errors without skipping or advancing progress',async()=>{
 const h=harness({account:true});await h.run('poll()');h.installAPI();h.run('ensureYouTube()');const p=h.instances[0];assert.equal(p.config.host,'https://www.youtube.com');assert.equal(p.config.playerVars.controls,1);
 p.config.events.onReady();await h.run('poll()');p.calls.length=0;p.config.events.onError({data:100});
 assert.equal(h.$('accountNotice').classList.contains('hidden'),false);assert.match(h.$('accountMessage').textContent,/account.*Queue held/);
 h.advance(16000);await h.run('poll()');assert.equal(p.calls.length,0,'blocked generation does not reload repeatedly');
 p.state=1;await h.timers.find(t=>t.ms===2000).fn();p.config.events.onStateChange({data:0});
 assert.ok(!h.requests.some(r=>['worker/error','worker/progress','worker/ended'].includes(r.route)));
 h.$('accountRetry').listeners.get('click')();await h.run('poll()');assert.ok(p.calls.some(c=>c[0]==='load'));assert.equal(h.$('accountNotice').classList.contains('hidden'),true);
});

test('Account embed restrictions explain failure, and a dashboard generation change clears the hold',async()=>{
 const h=harness({account:true});await h.run('poll()');h.installAPI();h.run('ensureYouTube()');const p=h.instances[0];p.config.events.onReady();await h.run('poll()');
 for(const code of [101,150]){p.config.events.onError({data:code});assert.match(h.$('accountMessage').textContent,/does not allow.*embedded/);}
 p.config.events.onError({data:153});assert.match(h.$('accountMessage').textContent,/referrer/);
 p.calls.length=0;h.snapshot.generation++;h.snapshot.current.videoId='jNQXAC9IVRw';await h.run('poll()');assert.ok(p.calls.some(c=>c[0]==='load'&&c[1].videoId==='jNQXAC9IVRw'));
 assert.equal(h.$('accountNotice').classList.contains('hidden'),true);assert.ok(!h.requests.some(r=>r.route==='worker/error'));
});

test('Saving account mode rebuilds the iframe once, preserves audio and resume position, and rejects stale callbacks',async()=>{
 const h=harness();await h.run('poll()');h.installAPI();h.run('ensureYouTube()');const original=h.instances[0];original.config.events.onReady();await h.run('poll()');
 assert.equal(original.config.host,'https://www.youtube-nocookie.com');assert.equal(original.config.playerVars.controls,0);
 h.snapshot.settings.youtubeAccountPlayback=true;await h.run('poll()');assert.equal(original.destroyed,true);assert.equal(h.instances.length,2);const signed=h.instances[1];assert.equal(signed.config.host,'https://www.youtube.com');
 original.config.events.onError({data:100});assert.ok(!h.requests.some(r=>r.route==='worker/error'));
 signed.config.events.onReady();await h.run('poll()');assert.equal(signed.calls.find(c=>c[0]==='load')[1].startSeconds,123);
 signed.config.events.onAutoplayBlocked();assert.match(h.$('accountMessage').textContent,/Interact.*Play/);
 signed.config.events.onStateChange({data:1});assert.equal(h.$('accountNotice').classList.contains('hidden'),true);
 h.snapshot.settings.youtubeAccountPlayback=false;await h.run('poll()');assert.equal(h.instances.at(-1).config.host,'https://www.youtube-nocookie.com');
});

test('Default public playback retains its automatic error report behavior',async()=>{
 const h=harness();await h.run('poll()');h.installAPI();h.run('ensureYouTube()');const p=h.instances[0];p.config.events.onReady();await h.run('poll()');p.config.events.onError({data:100});await Promise.resolve();
 assert.ok(h.requests.some(r=>r.route==='worker/error'));
});
