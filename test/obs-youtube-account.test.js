import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createApp} from '../lib/http.js';
import {DEFAULT_SETTINGS,validateSettings} from '../lib/config.js';

test('OBS account mode defaults off and accepts only a boolean',()=>{
 assert.equal(DEFAULT_SETTINGS.youtubeAccountPlayback,false);assert.equal(validateSettings({}).youtubeAccountPlayback,false);
 assert.equal(validateSettings({youtubeAccountPlayback:true}).youtubeAccountPlayback,true);
 for(const value of ['true',1,null,{},[]])assert.throws(()=>validateSettings({youtubeAccountPlayback:value}),/toggle/);
});

test('OBS account setting saves/reloads through authenticated HTTP and survives saves from older dashboards',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-obs-account-'));let app;
 const start=async()=>{app=createApp({dataDir:dir,port:0,twitchEnabled:false,chatEnabled:false,titleResolver:async()=>null,env:{ADMIN_TOKEN:'obs-test-token'}});await app.listen();return 'http://127.0.0.1:'+app.server.address().port;};
 t.after(async()=>{if(app?.server.listening)await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 let base=await start();const post=(route,data,cookie='')=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 assert.equal((await post('settings',{settings:{youtubeAccountPlayback:true}})).status,401);
 const login=await post('login',{token:'obs-test-token'});const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await post('settings',{settings:{youtubeAccountPlayback:true}},cookie)).status,200);assert.equal(app.engine.settings.youtubeAccountPlayback,true);
 const legacy={...app.engine.settings,channelLabel:'Old dashboard save'};delete legacy.youtubeAccountPlayback;
 assert.equal((await post('settings',{settings:legacy},cookie)).status,200);assert.equal(app.engine.settings.youtubeAccountPlayback,true);
 const publicState=await (await fetch(base+'/api/public?compact=1')).json();assert.equal(publicState.settings.youtubeAccountPlayback,true);
 assert.ok(!('twitchAdminWhitelist' in publicState.settings));
 const first=app.engine.add('dQw4w9WgXcQ','Restricted entry');app.engine.add('jNQXAC9IVRw','Next entry');
 const current=app.engine.state.current.id,generation=app.engine.state.generation;
 const workerId='00000000-0000-0000-0000-000000000001';assert.equal((await post('worker/claim',{workerId})).status,200);
 const held=await (await post('worker/error',{workerId,generation})).json();assert.equal(held.held,true);assert.equal(app.engine.state.current.id,current);assert.equal(app.engine.state.history.length,0);
 await app.close();base=await start();assert.equal(app.engine.state.current.id,current);assert.equal(app.engine.settings.youtubeAccountPlayback,true);assert.equal(app.engine.settings.channelLabel,'Old dashboard save');
 const setup=await (await fetch(base+'/youtube-setup')).text();assert.match(setup,/Sign in inside OBS/);assert.match(setup,/Members-only playback remains unverified/);
 const settings=await (await fetch(base+'/settings')).text();assert.match(settings,/id="youtubeAccountPlayback"/);assert.ok(!settings.includes('chrome-player'));
 assert.equal((await fetch(base+'/chrome-player')).status,404);assert.ok(!fs.existsSync(new URL('../chrome-extension',import.meta.url)));
 const player=await (await fetch(base+'/player?clean=1')).text();assert.match(player,/id="accountRetry"/);assert.match(player,/id="accountNotice"/);
 assert.equal((await post('worker/claim',{workerId})).status,200);
 assert.equal((await post('settings',{settings:{...app.engine.settings,youtubeAccountPlayback:false}},cookie)).status,200);
 assert.equal((await post('worker/error',{workerId,generation:app.engine.state.generation})).status,200);assert.notEqual(app.engine.state.current?.id,current);assert.equal(app.engine.state.history.at(-1).unavailable,true);
 const snapshot=app.engine.publicState({compact:true});assert.ok(!JSON.stringify(snapshot).includes('obs-test-token'));
});

test('OBS setup copies only the local player URL and explains a denied clipboard request',async()=>{
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',addEventListener(type,fn){this[type]=fn;}});return nodes.get(id);};let copied='',fail=false;
 const code=fs.readFileSync(new URL('../public/assets/youtube-setup.js',import.meta.url),'utf8');
 vm.runInNewContext(code,{URL,location:{href:'http://127.0.0.1:4191/youtube-setup'},document:{getElementById:$},navigator:{clipboard:{writeText:async text=>{if(fail)throw Error('denied');copied=text;}}}});
 assert.equal($('restoreUrl').textContent,'http://127.0.0.1:4191/player');await $('copyPlayer').click();assert.equal(copied,'http://127.0.0.1:4191/player');
 fail=true;await $('copyPlayer').click();assert.match($('copyStatus').textContent,/Copy the player URL shown/);
});
