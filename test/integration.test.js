import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createApp} from '../lib/http.js';

const videoIds=['dQw4w9WgXcQ','jNQXAC9IVRw','aqz-KE-bpKQ','LXb3EKWsInQ'];
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
async function startApp(t,dir,titleResolver=async()=>null){
  const app=createApp({dataDir:dir,port:0,host:'127.0.0.1',twitchEnabled:false,titleResolver,env:{ADMIN_TOKEN:'testing-token'}});
  const address=await app.listen();return {app,base:`http://127.0.0.1:${address.port}`};
}
async function post(base,route,data,cookie='',origin=''){
  const resp=await fetch(`${base}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{'Cookie':cookie}:{}),...(origin?{'Origin':origin}:{})},body:JSON.stringify(data)});
  return {status:resp.status,body:await resp.json(),cookie:resp.headers.get('set-cookie')};
}
async function setup(t,titleResolver){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-http-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const {app,base}=await startApp(t,dir,titleResolver);t.after(async()=>{if(app.server.listening)await app.close();});return {app,base,dir};}

test('Assets and operator endpoints are separated and locked',async t=>{
  const {base}=await setup(t);
  assert.equal((await fetch(`${base}/control`)).status,200);
  assert.equal((await fetch(`${base}/settings`)).status,200);
  assert.equal((await fetch(`${base}/player?clean=1`)).status,200);
  assert.equal((await fetch(`${base}/vote`)).status,200);
  assert.equal((await fetch(`${base}/assets/style.css`)).status,200);
  assert.equal((await fetch(`${base}/assets/../../server.js`)).status,404);
  assert.equal((await fetch(`${base}/api/operator`)).status,401);
  assert.equal((await post(base,'control',{action:'skip'})).status,401);
  assert.equal((await post(base,'login',{token:'wrong'})).status,401);
  const health=await (await fetch(`${base}/api/health`)).json();assert.equal(health.ok,true);
  assert.equal((await post(base,'login',{token:'testing-token'},'','http://malicious.example')).status,403);
});

test('Operator login, persistent queue, lease, duration heartbeat, stale generation and restart',async t=>{
  const {app,base,dir}=await setup(t);
  const login=await post(base,'login',{token:'testing-token'});
  assert.equal(login.status,200);const cookie=login.cookie.split(';')[0];assert.ok(cookie.startsWith('pb_session='));
  const add=await post(base,'control',{action:'add',url:videoIds[0],title:'Station test'},cookie);assert.equal(add.status,200);
  assert.equal((await post(base,'control',{action:'add',url:videoIds[1]},cookie)).status,200);
  let state=await (await fetch(`${base}/api/operator`,{headers:{Cookie:cookie}})).json();assert.equal(state.queue.length,1);
  assert.equal(state.current.title,'Station test');const gen=state.generation;
  const workerId=crypto.randomUUID();const claim=await post(base,'worker/claim',{workerId});assert.equal(claim.status,200);
  assert.equal((await post(base,'worker/claim',{workerId:crypto.randomUUID()})).status,409);
  const old=await post(base,'worker/progress',{workerId,generation:gen-1,position:200,duration:305});assert.equal(old.body.accepted,false);
  const beat=await post(base,'worker/progress',{workerId,generation:gen,position:88,duration:305});assert.equal(beat.body.accepted,true);
  assert.equal((await post(base,'worker/layout-ack',{workerId,layoutRevision:state.layoutRevision,clean:false})).status,200);
  state=await (await fetch(`${base}/api/operator`,{headers:{Cookie:cookie}})).json();assert.equal(state.outputs.length,1);
  await app.close();
  const next=await startApp(t,dir);t.after(async()=>{if(next.app.server.listening)await next.app.close();});
  const restored=await (await fetch(`${next.base}/api/public`)).json();
  assert.equal(restored.current.position,88);assert.equal(restored.current.duration,305);
  assert.equal(restored.queue.length,1);assert.equal(restored.current.title,'Station test');
});

test('Settings changes apply to public snapshots, keep output geometry and validate strictly',async t=>{
  const {base}=await setup(t);const login=await post(base,'login',{token:'testing-token'});const cookie=login.cookie.split(';')[0];
  const original=await (await fetch(`${base}/api/operator`,{headers:{Cookie:cookie}})).json();
  const draft=original.settings;draft.lowerThird={x:4,y:0,width:45,scale:125,anchor:'top'};draft.colors.accent='#33BBEE';draft.voteScreen.heading='NEXT EPISODE';
  let result=await post(base,'settings',{settings:draft},cookie);assert.equal(result.status,200);
  let publicData=await (await fetch(`${base}/api/public`)).json();
  assert.equal(publicData.settings.lowerThird.anchor,'top');assert.equal(publicData.settings.colors.accent,'#33BBEE');assert.equal(publicData.settings.voteScreen.heading,'NEXT EPISODE');
  const lastRevision=publicData.layoutRevision;
  result=await post(base,'settings',{settings:{...draft,lowerThird:{...draft.lowerThird,anchor:'under'}}},cookie);
  assert.equal(result.status,400);
  publicData=await (await fetch(`${base}/api/public`)).json();assert.equal(publicData.layoutRevision,lastRevision);
});

test('Viewer vote cookie, operator selection, malicious input rejection, and moderation',async t=>{
  const {base}=await setup(t);const login=await post(base,'login',{token:'testing-token'});const cookie=login.cookie.split(';')[0];
  for(const id of videoIds)assert.equal((await post(base,'control',{action:'add',url:id},cookie)).status,200);
  const initial=await (await fetch(`${base}/api/public`)).json();
  assert.equal((await post(base,'worker/claim',{workerId:'00000000-0000-4000-8000-000000000000'})).status,200);
  assert.equal((await post(base,'worker/ended',{workerId:'00000000-0000-4000-8000-000000000000',generation:initial.generation})).status,200);
  let status=await (await fetch(`${base}/api/public`)).json();assert.ok(status.vote);
  const vote=await post(base,'vote',{choice:2});assert.equal(vote.status,200);assert.deepEqual(vote.body.counts,[0,1,0,0]);
  const viewerCookie=vote.cookie.split(';')[0];
  const changed=await post(base,'vote',{choice:1},viewerCookie);assert.deepEqual(changed.body.counts,[1,0,0,0]);
  assert.equal((await post(base,'vote',{choice:0},viewerCookie)).status,400);
  assert.equal((await post(base,'suggestion',{url:'https://evil.com/',title:'malicious'})).status,400);
  await post(base,'control',{action:'choose',choice:2},cookie);
  status=await (await fetch(`${base}/api/public`)).json();assert.equal(status.vote,null);
  const suggestion=await post(base,'suggestion',{url:videoIds[0],title:'Viewer pick'});
  assert.equal(suggestion.status,200);
  assert.equal((await post(base,'control',{action:'moderate',id:suggestion.body.id,approved:true},cookie)).status,200);
});

test('YouTube player page advertises Referer policy required by embedded playback',async t=>{
  const {base}=await setup(t);
  const response=await fetch(`${base}/player`);
  assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.match(response.headers.get('content-security-policy')||'',/frame-src https:\/\/www\.youtube-nocookie\.com/);
});


test('Real titles for current and queued videos are fetched, persisted, and exposed to the OBS source',async t=>{
  const requested=[];
  const names={[videoIds[0]]:'ScreamblerRun: Stream lost to ingest offline', [videoIds[1]]:'Next video: The long stream'};
  const {app,base,dir}=await setup(t,async id=>{requested.push(id);return names[id]||null;});
  const login=await post(base,'login',{token:'testing-token'});const cookie=login.cookie.split(';')[0];
  const first=await post(base,'control',{action:'add',url:videoIds[0]},cookie);
  assert.equal(first.status,200);
  assert.equal((await post(base,'control',{action:'add',url:videoIds[1]},cookie)).status,200);
  assert.equal((await post(base,'control',{action:'add',url:videoIds[2],title:'User supplied title'},cookie)).status,200);
  let state;
  for(let i=0;i<30;i++){
    state=await (await fetch(`${base}/api/public`)).json();
    if(state.current.title===names[videoIds[0]]&&state.queue[0].title===names[videoIds[1]])break;
    await wait(20);
  }
  assert.equal(state.current.title,names[videoIds[0]]);
  assert.equal(state.queue[0].title,names[videoIds[1]]);
  assert.equal(state.queue[1].title,'User supplied title');
  assert.deepEqual(requested.slice(0,2),videoIds.slice(0,2));
  assert.ok(!requested.includes(videoIds[2]),'operator-entered titles must not trigger lookups');
  await app.close();
  const restart=await startApp(t,dir);t.after(async()=>{if(restart.app.server.listening)await restart.app.close();});
  const recovered=await (await fetch(`${restart.base}/api/public`)).json();
  assert.equal(recovered.current.title,names[videoIds[0]]);
  assert.equal(recovered.queue[0].title,names[videoIds[1]]);
});

test('YouTube iframe title metadata changes OBS lower-third output without operator edits',async t=>{
  const {base}=await setup(t);
  const login=await post(base,'login',{token:'testing-token'});const cookie=login.cookie.split(';')[0];
  await post(base,'control',{action:'add',url:videoIds[0]},cookie);
  const initial=await (await fetch(`${base}/api/public`)).json();
  assert.equal(initial.current.title,`YouTube · ${videoIds[0]}`);
  const workerId=crypto.randomUUID();await post(base,'worker/claim',{workerId});
  const metadata=await post(base,'worker/progress',{workerId,generation:initial.generation,position:11,duration:315,
    videoId:videoIds[0],title:'ScreamblerRun: Stream lost to ingest offline'});
  assert.equal(metadata.body.accepted,true);
  const corrected=await (await fetch(`${base}/api/public`)).json();
  assert.equal(corrected.current.title,'ScreamblerRun: Stream lost to ingest offline');
  const html=await (await fetch(`${base}/player`)).text();
  const playerScript=await (await fetch(`${base}/assets/player.js`)).text();
  assert.match(html,/id="hudTitle"/);
  assert.match(playerScript,/getVideoData/);
  assert.match(playerScript,/setTicker/);
  assert.equal((await post(base,'worker/progress',{workerId,generation:initial.generation,position:13,duration:315,
    videoId:videoIds[1],title:'Wrong video'})).status,200);
  assert.equal((await (await fetch(`${base}/api/public`)).json()).current.title,corrected.current.title);
});

test('Restored seek bar uses the official sidebar logo and seeks the authoritative playhead',async t=>{
  const {base}=await setup(t);
  const [control,settings,script,logo] = await Promise.all([
    fetch(`${base}/control`).then(r=>r.text()),
    fetch(`${base}/settings`).then(r=>r.text()),
    fetch(`${base}/assets/control.js`).then(r=>r.text()),
    fetch(`${base}/assets/logo.png`)
  ]);
  assert.match(control,/<img src="\/assets\/logo\.png" alt="fKey Playback logo" class="brand-mark"><span>Playback<small class="sub">made by fKey Labs Inc\.<\/small><\/span>/);
  assert.match(settings,/<img src="\/assets\/logo\.png" alt="fKey Playback logo" class="brand-mark"><span>Playback<small class="sub">made by fKey Labs Inc\.<\/small><\/span>/);
  assert.doesNotMatch(control,/<span>fKey Playback<small/);
  assert.match(control,/id="seekSlider"[^>]*type="range"|type="range"[^>]*id="seekSlider"/);
  assert.match(control,/id="seekCurrent"/);
  assert.match(control,/id="seekTotal"/);
  assert.match(script,/seekSlider'\)\.addEventListener\('input'/);
  assert.match(script,/seekSlider'\)\.addEventListener\('change'/);
  assert.match(script,/action\('seek',\{position\}\)/);
  assert.equal(logo.status,200);
  assert.match(logo.headers.get('content-type'),/image\/png/);
  assert.ok((await logo.arrayBuffer()).byteLength>12000);
  const login=await post(base,'login',{token:'testing-token'});
  const cookie=login.cookie.split(';')[0];
  await post(base,'control',{action:'add',url:videoIds[0],title:'Seeking test'},cookie);
  const initial=await (await fetch(`${base}/api/public`)).json();
  const workerId=crypto.randomUUID();
  await post(base,'worker/claim',{workerId});
  await post(base,'worker/progress',{workerId,generation:initial.generation,position:40,duration:600});
  const move=await post(base,'control',{action:'seek',position:450},cookie);
  assert.equal(move.status,200);
  const after=await (await fetch(`${base}/api/public`)).json();
  assert.equal(after.current.position,450);
  assert.equal(after.current.duration,600);
  assert.ok(after.generation>initial.generation);
  const stale=await post(base,'worker/progress',{workerId,generation:initial.generation,position:42,duration:600});
  assert.equal(stale.body.accepted,false);
  assert.equal((await (await fetch(`${base}/api/public`)).json()).current.position,450);
});

test('Dashboard controls saved OBS audio through authenticated volume/mute action and survives restarts',async t=>{
  const {app,base,dir}=await setup(t);
  const [control,source,audioModule] = await Promise.all([
    fetch(`${base}/control`).then(r=>r.text()),
    fetch(`${base}/assets/player.js`).then(r=>r.text()),
    fetch(`${base}/assets/youtube-audio.js`).then(r=>r.text())
  ]);
  assert.match(control,/id="volumeSlider"[^>]*max="100"/);
  assert.match(control,/id="muteToggle"/);
  assert.match(source,/syncAudio\(s/);
  assert.match(source,/applyYouTubeAudio\(player,audio\)/);
  assert.match(source,/syncAudio\(data,\{force:true\}\)/);
  assert.match(audioModule,/\.setVolume\(/);
  assert.match(audioModule,/\.mute\(/);
  assert.match(audioModule,/\.unMute\(/);
  assert.deepEqual((await (await fetch(`${base}/api/public`)).json()).audio,{volume:100,muted:false});
  assert.equal((await post(base,'control',{action:'audio',volume:18,muted:false})).status,401);
  const login=await post(base,'login',{token:'testing-token'});
  const cookie=login.cookie.split(';')[0];
  await post(base,'control',{action:'add',url:videoIds[0]},cookie);
  const before=await (await fetch(`${base}/api/public`)).json();
  const revision=before.generation, layoutRevision=before.layoutRevision;
  assert.equal((await post(base,'control',{action:'audio',volume:18,muted:false},cookie)).status,200);
  let output=await (await fetch(`${base}/api/public`)).json();
  assert.deepEqual(output.audio,{volume:18,muted:false});
  assert.equal(output.layoutRevision,layoutRevision);
  assert.equal(output.generation,revision);
  assert.equal((await post(base,'control',{action:'audio',volume:18,muted:true},cookie)).status,200);
  output=await (await fetch(`${base}/api/public`)).json();
  assert.deepEqual(output.audio,{volume:18,muted:true});
  for(const volume of [-1,101,14.5,'70']){
    assert.equal((await post(base,'control',{action:'audio',volume,muted:false},cookie)).status,400);
  }
  assert.equal((await post(base,'control',{action:'audio',volume:60,muted:'false'},cookie)).status,400);
  assert.deepEqual((await (await fetch(`${base}/api/public`)).json()).audio,{volume:18,muted:true});
  // An unrelated Settings Save must not overwrite the operator's audio level.
  const settings=output.settings;
  settings.voteSeconds=21;
  assert.equal((await post(base,'settings',{settings},cookie)).status,200);
  assert.deepEqual((await (await fetch(`${base}/api/public`)).json()).audio,{volume:18,muted:true});
  await app.close();
  const restart=await startApp(t,dir);
  t.after(async()=>{if(restart.app.server.listening)await restart.app.close();});
  const recovered=await (await fetch(`${restart.base}/api/public`)).json();
  assert.deepEqual(recovered.audio,{volume:18,muted:true});
});