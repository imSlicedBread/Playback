import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PlaybackEngine} from '../lib/engine.js';
import {normalizeSettings, validateSettings} from '../lib/config.js';
import {TwitchConnector, parseAdminCommand} from '../lib/twitch.js';
import {createApp} from '../lib/http.js';

const ids=['dQw4w9WgXcQ','jNQXAC9IVRw','aqz-KE-bpKQ','LXb3EKWsInQ'];
class Socket extends EventEmitter {
  writes=[];
  write(value){this.writes.push(value);}
  destroy(){}
}
function fixture(t,{mode='anonymous',whitelist=['alice']}={}){
  const clock={now:1000000},engine=new PlaybackEngine(null,{clock:()=>clock.now});
  engine.saveSettings({...engine.settings,twitchChannel:'station',twitchMode:mode,twitchAdminWhitelist:whitelist});
  engine.add(ids[0],'First');engine.add(ids[1],'Second');
  let socket,sequence=0,titleSchedules=0;
  const connector=new TwitchConnector(engine,{env:{TWITCH_USERNAME:'bot',TWITCH_OAUTH_TOKEN:'test'},
    connect:()=>{socket=new Socket();return socket;},onCatalogChange:()=>titleSchedules++});
  connector.start();socket.emit('secureConnect');t.after(()=>connector.stop());
  function send(text,{username='alice',userId='123',channel='station',messageId=`message-${++sequence}`,tags='',advance=true}={}){
    if(advance)clock.now+=2000;
    const line=`@id=${messageId};user-id=${userId}${tags?';'+tags:''} :${username}!${username}@${username}.tmi.twitch.tv PRIVMSG #${channel} :${text}\r\n`;
    socket.emit('data',Buffer.from(line));
  }
  return {engine,connector,clock,send,get socket(){return socket;},get titleSchedules(){return titleSchedules;}};
}

test('Whitelist normalizes names, validates limits, and never shares its default array',()=>{
  assert.deepEqual(validateSettings({twitchAdminWhitelist:[' @Alice ','ALICE','bob_2']}).twitchAdminWhitelist,['alice','bob_2']);
  assert.deepEqual(normalizeSettings().twitchAdminWhitelist,[]);
  const a=normalizeSettings(),b=normalizeSettings();a.twitchAdminWhitelist.push('alice');assert.deepEqual(b.twitchAdminWhitelist,[]);
  for(const value of [null,'alice',{},[null],[''],['@'],['bad-name'],['a'.repeat(26)],['alice bob'],['a\nb']]){
    assert.throws(()=>validateSettings({twitchAdminWhitelist:value}),/whitelist|usernames/i);
  }
  assert.equal(validateSettings({twitchAdminWhitelist:Array.from({length:100},(_,i)=>`user${i}`)}).twitchAdminWhitelist.length,100);
  assert.throws(()=>validateSettings({twitchAdminWhitelist:Array.from({length:101},(_,i)=>`user${i}`)}),/100/);
});

test('Admin parser is strict and independent from viewer commands',()=>{
  assert.deepEqual(parseAdminCommand('!PaUsE'),{name:'pause'});
  assert.deepEqual(parseAdminCommand('!seek 90.5'),{name:'seek',position:90.5});
  assert.deepEqual(parseAdminCommand(`!add ${ids[0]} | Custom title`),{name:'add',url:ids[0],title:'Custom title'});
  for(const input of ['!skip','!vote 1','!request URL','!whitelist alice','hello','!pauseplease'])assert.equal(parseAdminCommand(input),null);
  for(const input of ['!pause now','!volume 101','!volume -1','!volume 1.5','!volume 2e1','!seek NaN','!seek -1','!seek 0x10','!add','!add URL extra','!add URL |','!add URL | '+ 'a'.repeat(181)]){
    assert.match(parseAdminCommand(input).error,/Usage:/);
  }
});

for(const mode of ['anonymous','authenticated'])test(`Real connector dispatches transport and audio commands in ${mode} mode`,t=>{
  const f=fixture(t,{mode}),{engine,connector,send}=f;
  send('!PAUSE');assert.equal(engine.state.current.paused,true);
  send('!resume');assert.equal(engine.state.current.paused,false);
  send('!seek 42.5');assert.equal(engine.state.current.position,42.5);
  send('!replay');assert.equal(engine.state.current.position,0);
  send('!volume 25');assert.deepEqual(engine.state.audio,{volume:25,muted:false});
  send('!mute');assert.deepEqual(engine.state.audio,{volume:25,muted:true});
  send('!volume 60');assert.deepEqual(engine.state.audio,{volume:60,muted:true});
  send('!unmute');assert.deepEqual(engine.state.audio,{volume:60,muted:false});
  send('!volume 0');assert.deepEqual(engine.state.audio,{volume:0,muted:true});
  send('!unmute');assert.deepEqual(engine.state.audio,{volume:50,muted:false});
  send('!forceskip');assert.equal(engine.state.current.videoId,ids[1]);
  send('!previous');assert.equal(engine.state.current.videoId,ids[0]);
  assert.ok(connector.adminActivity.every(item=>item.success));
  assert.ok(!f.socket.writes.some(line=>line.includes('PRIVMSG')),'no chat replies');
});

test('Chat adding uses durable entry IDs, destination order, custom titles, and interrupted positions',t=>{
  const f=fixture(t),{engine,send}=f;
  send(`!add https://youtu.be/${ids[2]} | Third`);
  assert.deepEqual(engine.state.queue.map(v=>v.videoId),[ids[1],ids[2]]);
  assert.equal(engine.state.queue[1].title,'Third');
  send(`!playnext ${ids[3]}`);assert.equal(engine.state.priorityQueue[0].videoId,ids[3]);
  engine.seek(84);const interrupted=engine.state.current.id;
  send(`!playnow ${ids[2]} | Immediate`);
  assert.equal(engine.state.current.title,'Immediate');
  assert.equal(engine.state.priorityQueue[0].id,interrupted);
  assert.equal(engine.state.priorityQueue[0].position,84);
  send('!forceskip');assert.equal(engine.state.current.id,interrupted);assert.equal(engine.state.current.position,84);
  assert.equal(f.titleSchedules,4);
});

test('Only listed sender logins with a valid user ID and local channel origin qualify',t=>{
  const {engine,connector,send,socket}=fixture(t);const before=JSON.stringify(engine.state);
  send('!pause',{username:'stranger',tags:'display-name=alice;mod=1;badges=moderator/1'});
  send('!pause',{username:'station',tags:'badges=broadcaster/1'});
  send('!pause',{userId:''});send('!pause',{userId:'0'});send('!pause',{userId:'not-a-number'});
  send('!pause',{channel:'elsewhere'});
  send('!pause',{tags:'source-room-id=111;room-id=222'});
  send('!pause',{tags:'source-room-id=111'});
  socket.emit('data',Buffer.from(':alice!alice@alice.tmi.twitch.tv PRIVMSG #station :!pause\r\n'));
  assert.equal(JSON.stringify(engine.state),before);assert.deepEqual(connector.adminActivity,[]);
  send('!pause',{username:'ALICE',tags:'source-room-id=222;room-id=222'});
  assert.equal(engine.state.current.paused,true);
  engine.saveSettings({...engine.settings,twitchAdminWhitelist:[]});
  send('!resume');assert.equal(engine.state.current.paused,true);assert.equal(connector.adminActivity.length,1);
});

test('Malformed commands and invalid engine actions report errors without changing station state',t=>{
  const {engine,connector,send}=fixture(t);
  for(const command of ['!pause please','!seek 86401','!volume 200','!add https://example.com/video','!playnext invalid','!playnow invalid']){
    const before=JSON.stringify(engine.state);send(command);
    assert.equal(JSON.stringify(engine.state),before,command);assert.equal(connector.adminActivity[0].success,false);
  }
  engine.startVote();
  for(const command of ['!pause','!resume','!seek 4']){const before=JSON.stringify(engine.state);send(command);assert.equal(JSON.stringify(engine.state),before);}
  send('!forceskip');assert.equal(engine.state.vote,null);assert.equal(engine.state.current.videoId,ids[1]);
  engine.state.current=null;engine.state.history=[];
  for(const command of ['!pause','!resume','!forceskip','!previous','!replay','!seek 4']){
    const before=JSON.stringify(engine.state);send(command);assert.equal(JSON.stringify(engine.state),before,command);
    assert.equal(connector.adminActivity[0].success,false);
  }
});

test('Viewer skip, votes, and requests retain their meaning even for chat admins',t=>{
  const {engine,connector,send}=fixture(t);
  send('!skip');assert.equal(engine.state.skipBallots[engine.hashViewer('twitch','id:123')],true);
  assert.equal(engine.state.current.videoId,ids[0]);
  send(`!request ${ids[2]} | Suggestion`);assert.equal(engine.state.suggestions.length,1);
  engine.startVote();send('!vote 1');assert.deepEqual(engine.getVotes(),[1,0,0,0]);
  assert.deepEqual(connector.adminActivity,[]);
});

test('A failed durable chat mutation reports failure and restores playback state',t=>{
  const {engine,connector,send}=fixture(t);
  const saved=structuredClone(engine.state);
  engine.store={load:()=>structuredClone(saved),write:()=>{throw new Error('disk full');}};
  send(`!playnow ${ids[2]}`);
  assert.deepEqual(engine.state,saved);
  assert.equal(connector.adminActivity[0].success,false);assert.match(connector.adminActivity[0].result,/persist.*disk full/);
});

test('Duplicate IDs are ignored across reconnects, expire after five minutes, and remain bounded',t=>{
  const f=fixture(t),{connector,send,clock}=f;
  send('!pause',{messageId:'same'});const revision=f.engine.state.revision;
  connector.reconfigure();f.socket.emit('secureConnect');
  send('!resume',{messageId:'same'});assert.equal(f.engine.state.revision,revision);
  clock.now+=300000;send('!resume',{messageId:'same'});assert.equal(f.engine.state.current.paused,false);
  for(let n=0;n<1100;n++)send('!pause',{advance:false});
  assert.equal(connector.adminMessageIds.size,1000);
  assert.equal(connector.adminActivity.length,20);
  assert.ok(connector.adminActivity.every(item=>item.username==='alice'&&!Object.hasOwn(item,'text')));
});

test('Per-account cooldown and station-wide limits prevent mutations and recover after expiry',t=>{
  const {engine,connector,send,clock}=fixture(t,{whitelist:Array.from({length:40},(_,i)=>`user${i}`)});
  send('!pause',{username:'user0',userId:'1',advance:false});
  const revision=engine.state.revision;
  send('!resume',{username:'user0',userId:'1',advance:false});assert.equal(engine.state.revision,revision);
  assert.match(connector.adminActivity[0].result,/Rate limited/);
  for(let n=1;n<30;n++)send('!pause',{username:`user${n}`,userId:String(n+1),advance:false});
  const limitedRevision=engine.state.revision;
  send('!resume',{username:'user30',userId:'31',advance:false});assert.equal(engine.state.revision,limitedRevision);
  clock.now+=60000;send('!resume',{username:'user30',userId:'31',advance:false});assert.equal(engine.state.current.paused,false);
});

test('Whitelist persistence and activity are operator-only through real HTTP, with live revocation',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-chat-admin-'));
  const options={dataDir:dir,port:0,twitchEnabled:false,titleResolver:async()=>null,env:{ADMIN_TOKEN:'test-token'}};
  let app=createApp(options);
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  let base=`http://127.0.0.1:${(await app.listen()).port}`;
  async function request(route,data,cookie=''){
    const response=await fetch(base+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  let cookie=(await request('login',{token:'test-token'})).cookie;
  assert.equal((await request('settings',{settings:{twitchAdminWhitelist:['intruder']}})).status,401);
  assert.equal((await request('operator?compact=1')).status,401);
  assert.equal((await request('settings',{settings:{...app.engine.settings,twitchMode:'anonymous',twitchChannel:'station',twitchAdminWhitelist:[' @Alice ','alice'] }},cookie)).status,200);
  await request('control',{action:'add',url:ids[0],title:'First'},cookie);
  let socket;app.twitch.connect=()=>{socket=new Socket();return socket;};app.twitch.start();
  socket.emit('data',Buffer.from('@id=first;user-id=123 :alice!alice@alice.tmi.twitch.tv PRIVMSG #station :!pause\r\n'));
  for(const route of ['operator','operator?compact=1','operator?compact=1&catalog=omit']){
    const state=(await request(route,undefined,cookie)).body;
    assert.deepEqual(state.settings.twitchAdminWhitelist,['alice']);assert.equal(state.chatAdminActivity[0].command,'!pause');assert.equal(state.chatAdminActivity[0].success,true);
  }
  for(const route of ['public','public?compact=1']){
    const state=(await request(route)).body;
    assert.equal(Object.hasOwn(state.settings,'twitchAdminWhitelist'),false);assert.equal(Object.hasOwn(state,'chatAdminActivity'),false);
  }
  const {twitchAdminWhitelist,...oldClientSettings}=app.engine.settings;
  await request('settings',{settings:oldClientSettings},cookie);
  assert.deepEqual(app.engine.settings.twitchAdminWhitelist,['alice'],'old tabs cannot inadvertently clear the whitelist');
  await app.close();app=createApp(options);base=`http://127.0.0.1:${(await app.listen()).port}`;
  cookie=(await request('login',{token:'test-token'})).cookie;
  assert.deepEqual(app.engine.settings.twitchAdminWhitelist,['alice']);assert.deepEqual(app.twitch.adminActivity,[]);
  app.twitch.connect=()=>{socket=new Socket();return socket;};app.twitch.start();
  await request('settings',{settings:{...app.engine.settings,twitchAdminWhitelist:[]}},cookie);
  socket.emit('data',Buffer.from('@id=removed;user-id=123 :alice!alice@alice.tmi.twitch.tv PRIVMSG #station :!resume\r\n'));
  assert.equal(app.engine.state.current.paused,true);assert.deepEqual(app.twitch.adminActivity,[]);
});

test('Chat additions trigger actual background title discovery',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-chat-title-'));
  const options={dataDir:dir,port:0,twitchEnabled:false,titleResolver:async()=> 'Discovered chat title'};
  let app=createApp(options);
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  await app.listen();app.engine.saveSettings({...app.engine.settings,twitchMode:'anonymous',twitchChannel:'station',twitchAdminWhitelist:['alice']});
  const socket=new Socket();app.twitch.connect=()=>socket;app.twitch.start();
  socket.emit('data',Buffer.from(`@id=title;user-id=123 :alice!alice@alice.tmi.twitch.tv PRIVMSG #station :!add ${ids[0]}\r\n`));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.engine.state.current.title,'Discovered chat title');
  await app.close();app=createApp(options);await app.listen();
  assert.equal(app.engine.state.current.videoId,ids[0]);assert.equal(app.engine.state.current.title,'Discovered chat title');
});
