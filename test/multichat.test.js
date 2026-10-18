import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PlaybackEngine} from '../lib/engine.js';
import {ChatAdminDispatcher} from '../lib/chat-admin.js';
import {KickConnector,KICK_SOCKET_URL} from '../lib/kick.js';
import {SoopConnector,soopPacket,soopJoinPacket,parseSoopPacket,soopSocketUrl,parseSoopAdminMessage} from '../lib/soop.js';
import {SoopAuth,SOOP_API} from '../lib/soop-auth.js';
import {validateSettings,normalizeSettings} from '../lib/config.js';
import {createApp} from '../lib/http.js';

class Socket {
  sent=[];closed=false;
  send(value){this.sent.push(value);}
  close(){this.closed=true;}
  open(){this.onopen?.({});}
  receive(data){this.onmessage?.({data});}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const row={id:'owner',nick:'Owner',chat_ip:'1.2.3.4',chat_port:9000,broad_no:100,chat_no:456,key:'fake-ticket'};
function setup(t,platform,options={}){
  const clock={now:Date.parse('2026-10-18T12:00:00Z')},engine=new PlaybackEngine(null,{clock:()=>clock.now});
  engine.saveSettings({...engine.settings,kickEnabled:true,kickChannel:'owner',kickChatroomId:'456',kickAdminWhitelist:['alice'],soopEnabled:true,soopChannel:'owner',soopAdminWhitelist:['alice']});
  engine.add('dQw4w9WgXcQ','First');engine.add('jNQXAC9IVRw','Second');
  const dispatcher=new ChatAdminDispatcher(engine),sockets=[],timers=[];
  const readerOptions={adminDispatcher:dispatcher,webSocketFactory:(url,protocol)=>{const socket=new Socket();Object.assign(socket,{url,protocol});sockets.push(socket);return socket;},
    delay:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},cancelDelay:timer=>{timer.cancelled=true;},...options};
  const reader=platform==='kick'?new KickConnector(engine,readerOptions):new SoopConnector(engine,readerOptions);
  reader.start();t.after(()=>reader.stop());
  return {engine,clock,dispatcher,reader,sockets,timers};
}
function kickMessage(clock,{username='alice',id='one',content='!pause',channel='chatrooms.456.v2',...extra}={}){
  return JSON.stringify({event:'App\\Events\\ChatMessageEvent',channel,data:JSON.stringify({id,content,chatroom_id:456,type:'message',created_at:new Date(clock.now).toISOString(),sender:{id:123,username},...extra})});
}
function kickReady(socket){socket.open();socket.receive(JSON.stringify({event:'pusher_internal:subscription_succeeded',channel:'chatrooms.456.v2',data:{}}));}
function soopReady(socket){socket.open();socket.receive(soopPacket(1,['owner','16']));socket.receive(soopPacket(2,['456','owner','','10','']));}
const soopOptions={env:{SOOP_CLIENT_ID:'fake-client'},auth:{accessToken:async()=> 'fake-token'},fetchImpl:async()=>Response.json({result:1,data:[row]})};

test('Kick subscribes only outbound, requires confirmed subscription, reads trusted sender identities and answers pings',async t=>{
  const f=setup(t,'kick');await flush();const socket=f.sockets[0];assert.equal(socket.url,KICK_SOCKET_URL);
  socket.open();socket.receive(kickMessage(f.clock));assert.equal(f.engine.state.current.paused,false);
  assert.equal(f.reader.status.state,'CONNECTING');
  socket.receive(JSON.stringify({event:'pusher_internal:subscription_succeeded',channel:'chatrooms.456.v2',data:{}}));
  assert.equal(f.reader.status.state,'CONNECTED');socket.receive(kickMessage(f.clock));assert.equal(f.engine.state.current.paused,true);
  f.clock.now+=2000;socket.receive(kickMessage(f.clock,{content:'!resume'}));assert.equal(f.engine.state.current.paused,true,'duplicate message ID ignored');
  socket.receive(kickMessage(f.clock,{id:'other',username:'stranger',sender:{id:555,username:'stranger',display_name:'alice'}}));
  socket.receive(kickMessage(f.clock,{id:'wrong-room',channel:'chatrooms.999.v2'}));
  socket.receive(kickMessage(f.clock,{id:'nested-room',chatroom_id:999}));
  socket.receive(kickMessage(f.clock,{id:'old',created_at:'2025-01-01T00:00:00Z'}));
  socket.receive(kickMessage(f.clock,{id:'missing-time',created_at:null}));
  assert.equal(f.dispatcher.adminActivity.length,1);
  socket.receive(JSON.stringify({event:'pusher:ping',data:{}}));
  assert.deepEqual(socket.sent.map(s=>JSON.parse(s).event),['pusher:subscribe','pusher:subscribe','pusher:pong']);
  f.engine.saveSettings({...f.engine.settings,kickAdminWhitelist:[]});socket.receive(kickMessage(f.clock,{id:'revoked',content:'!resume'}));assert.equal(f.engine.state.current.paused,true);
});

test('Kick lookup falls back to v1, permits manual chatroom IDs and never follows redirects',async t=>{
  const calls=[];const f=setup(t,'kick',{fetchImpl:async(url,options)=>{calls.push({url,options});return calls.length===1?new Response('',{status:403}):Response.json({chatroom:{id:456}});}});
  f.engine.saveSettings({...f.engine.settings,kickChatroomId:''});await flush();
  assert.equal(calls.length,2);assert.match(calls[0].url,/kick\.com\/api\/v2\/channels\/owner$/);
  assert.match(calls[1].url,/\/v1\//);assert.ok(calls.every(c=>c.options.redirect==='error'));
  kickReady(f.sockets[0]);assert.equal(f.reader.status.state,'CONNECTED');
});

test('Reader cancellation invalidates pending lookups, retry callbacks and old socket events',async t=>{
  let resolve;const deferred=new Promise(r=>{resolve=r;});
  const f=setup(t,'kick',{fetchImpl:()=>deferred});f.engine.saveSettings({...f.engine.settings,kickChatroomId:''});await flush();
  f.reader.stop();resolve(Response.json({chatroom:{id:456}}));await flush();assert.equal(f.sockets.length,0);
  f.engine.saveSettings({...f.engine.settings,kickChatroomId:'456'});f.reader.start();await flush();const socket=f.sockets[0];kickReady(socket);const staleMessage=socket.onmessage;
  socket.onclose();const timer=f.timers.findLast(timer=>!timer.cancelled);assert.equal(f.reader.status.state,'RETRYING');
  f.reader.stop();assert.equal(timer.cancelled,true);timer.fn();staleMessage({data:kickMessage(f.clock)});assert.equal(f.engine.state.current.paused,false);
});

test('SOOP packet codec follows SDK framing, UTF-8 byte lengths and rejects malformed frames',()=>{
  const packet=soopPacket(5,['!add dQw4w9WgXcQ | 한국어','alice','','','','Nickname','0','0']);
  assert.equal(Number(packet.toString('ascii',6,12)),packet.length-14);
  assert.equal(parseSoopPacket(packet).fields[0],'!add dQw4w9WgXcQ | 한국어');
  assert.equal(parseSoopAdminMessage(parseSoopPacket(packet),'owner').username,'alice');
  for(const data of [Buffer.from('invalid'),Buffer.from(packet.subarray(0,packet.length-1)),Buffer.alloc(140000),'fake'])assert.equal(parseSoopPacket(data),null);
  assert.equal(soopSocketUrl(row),'wss://chat-01020304.sooplive.com:9001/Websocket/owner');
  assert.throws(()=>soopSocketUrl({...row,chat_ip:'attacker.example'}));
  assert.equal(parseSoopAdminMessage(parseSoopPacket(soopPacket(9,['!pause','alice'])),'owner'),null,'whispers are excluded');
  assert.equal(parseSoopAdminMessage(parseSoopPacket(soopPacket(5,['!pause','alice(n)'])),'owner'),null,'guest identities are excluded');
  assert.equal(parseSoopAdminMessage(parseSoopPacket(soopPacket(5,['!pause','alice','','','','Nickname','16'])),'owner'),null,'guest flag cannot impersonate a listed account');
});

test('SOOP logs in with OAuth token, joins the authorized broadcast and accepts only whitelisted login IDs',async t=>{
  const f=setup(t,'soop',soopOptions);await flush();const socket=f.sockets[0];assert.equal(socket.protocol,'chat');
  soopReady(socket);assert.equal(f.reader.status.state,'CONNECTED');
  assert.ok(socket.sent[0].equals(soopPacket(16,['fake-token','16'])));
  assert.ok(socket.sent[1].equals(soopJoinPacket(row,'fake-client')));
  socket.receive(soopPacket(5,['!pause','stranger','','','','alice','0']));assert.equal(f.engine.state.current.paused,false);
  socket.receive(soopPacket(5,['!pause','alice','','','','Display name','0']));assert.equal(f.engine.state.current.paused,true);
  f.clock.now+=2000;socket.receive(soopPacket(26,['!resume','alice','1','','Other display name','0']));assert.equal(f.engine.state.current.paused,false);
  const heartbeat=f.timers.findLast(timer=>timer.ms===60000&&!timer.cancelled);heartbeat.fn();
  assert.ok(socket.sent.at(-1).equals(soopPacket(0)));
  assert.ok(socket.sent.every(packet=>[0,2,16].includes(parseSoopPacket(packet).service)),'no outgoing chat/moderation packets');
  socket.receive(soopPacket(88,[]));assert.equal(f.reader.status.state,'RETRYING');assert.equal(socket.closed,true);
});

test('SOOP refuses commands before joining, wrong-channel sessions, missing credentials and stale asynchronous responses',async t=>{
  const f=setup(t,'soop',soopOptions);await flush();const socket=f.sockets[0];socket.open();
  socket.receive(soopPacket(5,['!pause','alice']));assert.equal(f.engine.state.current.paused,false);
  socket.receive(soopPacket(1,['owner','16']));socket.receive(soopPacket(2,['456','other-owner']));assert.equal(f.reader.status.state,'RETRYING');
  const missing=setup(t,'soop',{env:{}});await flush();assert.equal(missing.reader.status.state,'CONFIG_REQUIRED');assert.equal(missing.sockets.length,0);
  const offline=setup(t,'soop',{...soopOptions,fetchImpl:async()=>Response.json({result:1,data:[]})});await flush();assert.equal(offline.sockets.length,0);assert.match(offline.reader.status.detail,/live/);
  let renewals=0;const unavailable=setup(t,'soop',{...soopOptions,auth:{accessToken:async()=>{renewals++;return 'fake-token';}},fetchImpl:async()=>Response.json({result:-1})});
  await flush();assert.equal(unavailable.reader.status.state,'WAITING_FOR_LIVE');assert.equal(renewals,1,'offline broadcasts must not repeatedly rotate OAuth credentials');
});

test('Platform whitelists and identities are independent; the station-wide rate budget is shared',()=>{
  const engine=new PlaybackEngine(null),dispatcher=new ChatAdminDispatcher(engine);
  engine.saveSettings({...engine.settings,kickEnabled:true,kickChannel:'owner',kickAdminWhitelist:['alice'],soopEnabled:true,soopChannel:'owner',soopAdminWhitelist:[]});engine.add('dQw4w9WgXcQ');
  const message={channel:'owner',username:'alice',userId:'123',text:'!pause',messageId:'same'};
  dispatcher.handleMessage({...message,platform:'soop'});assert.equal(engine.state.current.paused,false);
  dispatcher.handleMessage({...message,platform:'kick'});assert.equal(engine.state.current.paused,true);
  engine.saveSettings({...engine.settings,soopAdminWhitelist:['alice']});
  dispatcher.handleMessage({...message,platform:'soop',text:'!resume'});assert.equal(engine.state.current.paused,false,'same IDs on different platforms are distinct');
  assert.deepEqual(dispatcher.adminActivity.map(row=>row.platform),['soop','kick']);
  dispatcher.adminStationTimes=Array(30).fill(engine.clock());
  dispatcher.handleMessage({...message,platform:'soop',messageId:'new'});assert.equal(engine.state.current.paused,false);assert.match(dispatcher.adminActivity[0].result,/Rate limited/);
});

test('New settings normalize safely, retain old defaults and preserve every private list on old-client saves',()=>{
  assert.deepEqual(normalizeSettings().soopAdminWhitelist,[]);
  const settings=validateSettings({kickChannel:' @OWNER ',kickAdminWhitelist:[' @Alice-One ','ALICE-one'],soopAdminWhitelist:['account.id']});
  assert.equal(settings.kickChannel,'owner');assert.deepEqual(settings.kickAdminWhitelist,['alice-one']);
  for(const change of [{kickEnabled:true},{soopEnabled:true},{kickChatroomId:'0'},{kickChatroomId:'../x'},{soopAdminWhitelist:['nickname 한글']},{kickAdminWhitelist:null}])assert.throws(()=>validateSettings(change));
  const engine=new PlaybackEngine(null);engine.saveSettings({...settings,twitchAdminWhitelist:['twitch_admin']});
  const {kickEnabled,kickChannel,kickChatroomId,kickAdminWhitelist,soopEnabled,soopChannel,soopAdminWhitelist,twitchAdminWhitelist,...old}=engine.settings;
  engine.saveSettings(old);assert.deepEqual(engine.settings.kickAdminWhitelist,['alice-one']);assert.deepEqual(engine.settings.soopAdminWhitelist,['account.id']);
  assert.equal(engine.settings.kickChannel,'owner');
  for(const compact of [false,true])for(const key of ['kickAdminWhitelist','soopAdminWhitelist','twitchAdminWhitelist'])assert.equal(Object.hasOwn(engine.publicState({compact}).settings,key),false);
});

test('SOOP independent OAuth caches and renews credentials locally, preserves rotating refresh tokens and never includes the client secret in chat setup',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-soop-auth-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const env={SOOP_CLIENT_ID:'client',SOOP_CLIENT_SECRET:'private-secret',SOOP_REFRESH_TOKEN:'old-refresh'};const calls=[];
  const auth=new SoopAuth({env,dataDir:dir,fetchImpl:async(url,options)=>{
    calls.push({url,options});return Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600,scope:'broad_access_chatinfo'});
  }});
  assert.equal(await auth.accessToken(),'new-access');assert.equal(calls[0].url,SOOP_API+'/auth/token');assert.equal(calls[0].options.body.get('client_secret'),'private-secret');
  assert.equal(calls[0].options.redirect,'error');assert.equal(auth.load().refreshToken,'new-refresh');
  const disk=JSON.parse(fs.readFileSync(path.join(dir,'soop-auth.json'),'utf8'));assert.equal(disk.accessToken,'new-access');assert.equal(JSON.stringify(disk).includes('private-secret'),false);
  const reopened=new SoopAuth({env,dataDir:dir,fetchImpl:()=>{throw new Error('Unexpected network');}});assert.equal(await reopened.accessToken(),'new-access');
  await auth.accessToken({forceRefresh:true});assert.equal(calls[1].options.body.get('refresh_token'),'new-refresh');
  const reject=new SoopAuth({env,fetchImpl:async()=>Response.json({access_token:'wrong',scope:'broad_rtmp'})});await assert.rejects(()=>reject.accessToken(),/authorization/i);
});

test('Real HTTP exposes private lists and connector state only to authenticated operators and persists independent settings',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-multichat-'));let app=createApp({dataDir:dir,port:0,twitchEnabled:false,chatEnabled:false,titleResolver:async()=>null});
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  let base=`http://127.0.0.1:${(await app.listen()).port}`;
  assert.equal((await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reconnectChat',platform:'soop'})})).status,401);
  const token=fs.readFileSync(path.join(dir,'admin-token.txt'),'utf8').trim();
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const settings={...app.engine.settings,kickChannel:'owner',kickChatroomId:'456',kickAdminWhitelist:['alice'],soopChannel:'owner',soopAdminWhitelist:['account']};
  assert.equal((await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({settings})})).status,200);
  const operator=await (await fetch(base+'/api/operator?compact=1',{headers:{Cookie:cookie}})).json();assert.equal(operator.kick.state,'DISABLED');assert.equal(operator.soop.state,'DISABLED');assert.deepEqual(operator.settings.kickAdminWhitelist,['alice']);
  const pub=await (await fetch(base+'/api/public')).json();assert.equal(Object.hasOwn(pub.settings,'soopAdminWhitelist'),false);assert.equal(Object.hasOwn(pub,'soop'),false);
  await app.close();app=createApp({dataDir:dir,port:0,twitchEnabled:false,chatEnabled:false,titleResolver:async()=>null});await app.listen();
  assert.deepEqual(app.engine.settings.soopAdminWhitelist,['account']);assert.equal(app.engine.settings.kickChatroomId,'456');
});
