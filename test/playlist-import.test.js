import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createApp} from '../lib/http.js';
import {PlaybackEngine} from '../lib/engine.js';
import {parsePlaylistUrl,playlistWindow,normalizePlaylist,extractWithYtDlp,extractWithYouTubeApi} from '../lib/playlist-import.js';

const playlistId='PL0123456789abcdefghijklmnop';
const playlistUrl=`https://www.youtube.com/playlist?list=${playlistId}`;
const ids=['dQw4w9WgXcQ','jNQXAC9IVRw','aqz-KE-bpKQ','LXb3EKWsInQ'];
const video=(videoId,title)=>({videoId,title});

function fixtureExtractor(videos=ids.slice(0,3).map((id,i)=>video(id,`Video ${i+1}`))){
  const calls=[];
  const fn=async(url,{start,limit,signal})=>{
    calls.push({url,start,limit,signal});
    return {title:'Test playlist',playlistId,videos,unavailable:0,total:videos.length,hasMore:false,provider:'fixture'};
  };
  return {fn,calls};
}
async function serverFixture(t,extractor){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-playlist-'));
  let app=createApp({dataDir:dir,port:0,twitchEnabled:false,titleResolver:async()=>null,playlistExtractor:extractor,env:{ADMIN_TOKEN:'playlist-secret'}});
  let addr=await app.listen();let base=`http://127.0.0.1:${addr.port}`;
  t.after(async()=>{if(app.server.listening)await app.close();fs.rmSync(dir,{force:true,recursive:true});});
  const post=async(route,data,cookie='')=>{
    const response=await fetch(`${base}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
    return {status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  const session=await post('login',{token:'playlist-secret'});
  const cookie=session.cookie.split(';')[0];
  const state=()=>fetch(`${base}/api/operator`,{headers:{Cookie:cookie}}).then(r=>r.json());
  return {post,state,cookie,dir,base,stop:async()=>{await app.close();},restart:async()=>{
    app=createApp({dataDir:dir,port:0,twitchEnabled:false,titleResolver:async()=>null,playlistExtractor:extractor,env:{ADMIN_TOKEN:'playlist-secret'}});
    addr=await app.listen();base=`http://127.0.0.1:${addr.port}`;
    return fetch(`${base}/api/operator`,{headers:{Cookie:cookie}}).then(r=>r.json());
  }};
}

test('Playlist URLs accept playlist or watch+list and reject untrusted/unsafe links',()=>{
  assert.deepEqual(parsePlaylistUrl(`https://music.youtube.com/watch?v=${ids[0]}&list=${playlistId}`),{playlistId,url:playlistUrl});
  assert.deepEqual(parsePlaylistUrl(playlistUrl),{playlistId,url:playlistUrl});
  for(const url of [
    'http://www.youtube.com/playlist?list='+playlistId,
    'https://youtube.com.attacker.invalid/playlist?list='+playlistId,
    'https://www.youtube.com:8443/playlist?list='+playlistId,
    'https://evil.example/playlist?list='+playlistId,
    'https://youtube.com/redirect?list='+playlistId,
    'https://youtube.com/playlist',
    'https://youtube.com/playlist?list=---',
    '--playlist-start 5',
    'https://username:pass@youtube.com/playlist?list='+playlistId
  ]) assert.throws(()=>parsePlaylistUrl(url));
  assert.deepEqual(playlistWindow(251,500),{start:251,limit:500,end:750});
  assert.throws(()=>playlistWindow(0,100));
  assert.throws(()=>playlistWindow(1,501));
});

test('Extractor cleans titles, retains playlist order, and excludes unavailable videos',()=>{
  const data=normalizePlaylist({title:'  Great\n Playlist ',playlist_count:5,entries:[
    {id:ids[0],title:'Stream One',playlist_index:1,duration:120},
    {id:ids[1],title:'[Private video]',playlist_index:2},
    {id:'bad',title:'bad',playlist_index:3},
    {id:ids[2],title:'Stream\n Two',playlist_index:4},
  ]},{playlistId,start:1,limit:4});
  assert.equal(data.title,'Great  Playlist');
  assert.deepEqual(data.videos.map(v=>v.videoId),[ids[0],ids[2]]);
  assert.deepEqual(data.videos.map(v=>v.position),[1,4]);
  assert.equal(data.videos[0].duration,120);
  assert.equal(data.unavailable,2);
  assert.equal(data.hasMore,true);
});

test('yt-dlp adapter uses subprocess argument array with fixed YouTube destination (no shell)',async()=>{
  let args,command,options;
  const spawnImpl=(cmd,a,opts)=>{
    command=cmd;args=a;options=opts;
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    process.nextTick(()=>{child.stdout.end(JSON.stringify({title:'Test',playlist_count:3,entries:[
      {id:ids[0],title:'A'},{id:ids[1],title:'B'}]}));child.emit('close',0);});
    return child;
  };
  const got=await extractWithYtDlp(parsePlaylistUrl(`https://youtube.com/watch?list=${playlistId}&v=${ids[0]}`),{start:10,limit:2,env:{YT_DLP_PATH:'test-yt-dlp'},spawnImpl});
  assert.equal(command,'test-yt-dlp');
  assert.equal(options.shell,false);
  assert.deepEqual(args.slice(-2),['--',playlistUrl]);
  assert.deepEqual(args.slice(args.indexOf('--playlist-start'),args.indexOf('--playlist-start')+4),['--playlist-start','10','--playlist-end','11']);
  assert.deepEqual(got.videos.map(v=>v.videoId),ids.slice(0,2));
});

test('Official YouTube Data API extracts multiple pages and keeps playlist order',async()=>{
  const called=[];
  const fetchImpl=async url=>{
    const u=new URL(url);called.push(u);
    const isSecond=u.searchParams.has('pageToken');
    return {ok:true,headers:{get:()=>null},json:async()=>({pageInfo:{totalResults:4},
      items:(isSecond?[{id:3},{id:4}]:[{id:1},{id:2}]).map((v,i)=>({contentDetails:{videoId:ids[v.id-1]},snippet:{title:`Title ${v.id}`,position:v.id-1,playlistTitle:'Sample'}})),
      nextPageToken:isSecond?undefined:'page-2'})};
  };
  const parsed=parsePlaylistUrl(playlistUrl);
  const result=await extractWithYouTubeApi(parsed,{start:2,limit:3,env:{YOUTUBE_API_KEY:'secret-key'},fetchImpl});
  assert.equal(result.videos.length,3);
  assert.deepEqual(result.videos.map(v=>v.videoId),ids.slice(1));
  assert.deepEqual(result.videos.map(v=>v.position),[2,3,4]);
  assert.ok(called.every(u=>u.hostname==='www.googleapis.com'&&u.pathname==='/youtube/v3/playlistItems'));
});

test('Extraction preview is authenticated, import is selective and atomic, playback survives restarts',async t=>{
  const fixture=fixtureExtractor();const site=await serverFixture(t,fixture.fn);
  const anonymous=await site.post('playlist/extract',{url:playlistUrl});assert.equal(anonymous.status,401);
  const invalid=await site.post('playlist/extract',{url:'https://evil.org/playlist?list='+playlistId},site.cookie);
  assert.equal(invalid.status,400);assert.equal(fixture.calls.length,0);
  const extracted=await site.post('playlist/extract',{url:playlistUrl,start:1,limit:250},site.cookie);
  assert.equal(extracted.status,200);assert.equal(extracted.json.videos.length,3);
  assert.equal(fixture.calls[0].url,playlistUrl);
  assert.equal((await site.post('playlist/import',{id:extracted.json.id,indexes:[0]},'')).status,401);
  assert.equal((await site.post('playlist/import',{id:extracted.json.id,indexes:[0,0]},site.cookie)).status,400);
  assert.equal((await site.post('playlist/import',{id:extracted.json.id,indexes:[100]},site.cookie)).status,400);
  let state=await site.state();assert.equal(state.current,null);
  const saved=await site.post('playlist/import',{id:extracted.json.id,indexes:[2,0]},site.cookie);
  assert.equal(saved.status,200);assert.equal(saved.json.added,2);
  state=await site.state();assert.equal(state.current.videoId,ids[0]);assert.deepEqual(state.queue.map(x=>x.videoId),[ids[2]]);
  assert.equal((await site.post('control',{action:'seek',position:145},site.cookie)).status,200);
  const generation=(await site.state()).generation;
  const repeat=await site.post('playlist/import',{id:extracted.json.id,indexes:[0,1,2],skipDuplicates:true},site.cookie);
  assert.equal(repeat.json.added,1);assert.equal(repeat.json.skipped,2);
  state=await site.state();assert.equal(state.current.position,145);assert.equal(state.generation,generation);
  assert.deepEqual(state.queue.map(x=>x.videoId),[ids[2],ids[1]]);
  await site.stop();const restored=await site.restart();
  assert.equal(restored.current.position,145);assert.deepEqual(restored.queue.map(x=>x.videoId),[ids[2],ids[1]]);
});

test('Imports deduplicate within selected results and a malformed provider never modifies state',async t=>{
  const dupes=fixtureExtractor([video(ids[0],'One'),video(ids[0],'One again'),video(ids[1],'Two')]);
  const site=await serverFixture(t,dupes.fn);
  const result=await site.post('playlist/extract',{url:playlistUrl},site.cookie);
  const saved=await site.post('playlist/import',{id:result.json.id,indexes:[0,1,2]},site.cookie);
  assert.equal(saved.json.added,2);assert.equal(saved.json.skipped,1);
  let state=await site.state();assert.equal(state.queue.length,1);
  assert.equal((await site.post('playlist/import',{id:'no-such-id',indexes:[0]},site.cookie)).status,410);
  assert.equal((await site.post('playlist/import',{id:result.json.id,indexes:[1,2],skipDuplicates:'wrong'},site.cookie)).status,400);
  state=await site.state();assert.equal(state.queue.length,1);
});


test('Full queues and invalid video IDs are rejected atomically',()=>{
  let writes=0;
  const engine=new PlaybackEngine({load:()=>null,write:()=>{writes++;}});
  engine.add(ids[0],'Current');
  const beforeWrites=writes;
  assert.throws(()=>engine.importPlaylist([video(ids[1],'Valid'),video('not-an-id','Invalid')]),/Invalid/);
  assert.equal(engine.state.queue.length,0);
  assert.equal(writes,beforeWrites);
  engine.state.queue=Array.from({length:2000},(_,i)=>({id:`item-${i}`,videoId:ids[i%4],title:`Title ${i}`}));
  assert.throws(()=>engine.importPlaylist([video(ids[0],'Repeat')],{skipDuplicates:false}),/Not enough queue space/);
  assert.equal(engine.state.queue.length,2000);
  assert.equal(writes,beforeWrites);
});

test('Extractor previews expire and cannot import after timeout',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-playlist-expiry-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  let now=10000;
  const fixture=fixtureExtractor();
  const app=createApp({dataDir:dir,port:0,twitchEnabled:false,titleResolver:async()=>null,playlistExtractor:fixture.fn,
    clock:()=>now,env:{ADMIN_TOKEN:'test-secret'}});
  const address=await app.listen();t.after(async()=>{if(app.server.listening)await app.close();});
  const base=`http://127.0.0.1:${address.port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'test-secret'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const call=async(route,data)=>{const res=await fetch(base+'/api/'+route,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:res.status,body:await res.json()};};
  const extract=await call('playlist/extract',{url:playlistUrl});assert.equal(extract.status,200);
  now+=16*60*1000;
  const importRes=await call('playlist/import',{id:extract.body.id,indexes:[0]});assert.equal(importRes.status,410);
  assert.equal(app.engine.state.current,null);assert.equal(app.engine.state.queue.length,0);
});

test('Dashboard markup and browser wiring expose preview, selection, duplicates and batching',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const html=fs.readFileSync(path.join(root,'public/control.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'public/assets/control.js'),'utf8');
  for(const id of ['playlistExtractForm','playlistUrl','playlistStart','playlistLimit','playlistPreview','playlistVideos','playlistImportButton','playlistNextButton','playlistSkipDuplicates','playlistCopyLinks','playlistExportCsv']){
    assert.ok(html.includes(`id="${id}"`),id);
    assert.ok(js.includes(`$('${id}')`),id+' JS binding');
  }
  assert.match(js,/api\('playlist\/extract'/);
  assert.match(js,/api\('playlist\/import'/);
});