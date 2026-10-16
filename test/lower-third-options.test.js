import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PlaybackEngine,migrateState} from '../lib/engine.js';
import {DurableStore} from '../lib/store.js';
import {validateSettings,DEFAULT_SETTINGS} from '../lib/config.js';
import {applyLowerThird} from '../public/assets/common.js';
import {createApp} from '../lib/http.js';

const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const visibility=['showChannelLabel','showNowPlaying','showDuration','showSkip'];
const read=(file)=>fs.readFileSync(path.join(dir,file),'utf8');

function mockLowerThird({preview=false,frameWidth=960}={}){
  const known=['channel','nowPlaying','duration','skip'];
  const classes=()=>({contents:new Set(),toggle(name,on){if(on)this.contents.add(name);else this.contents.delete(name);},contains(name){return this.contents.has(name);}});
  const children=new Map();
  const el={style:{},classList:classes(),querySelector(selector){return children.get(selector)||null;},closest(selector){return selector==='.preview-frame'&&preview?{clientWidth:frameWidth}:null}};
  for(const k of known)children.set(`[data-lt-field="${k}"]`,{classList:classes()});
  for(const k of ['.topline','.lowerline','.title-clip'])children.set(k,{style:{},classList:classes()});
  return {el,children};
}

test('New and old saved lower thirds default to an uncluttered title-only overlay',()=>{
  const current=structuredClone(DEFAULT_SETTINGS);
  for(const key of visibility)assert.equal(current.lowerThird[key],false);
  assert.equal(current.lowerThird.titleScale,100);
  const old=migrateState({schemaVersion:1,settings:{lowerThird:{x:3,y:0,width:34,scale:100,anchor:'bottom'}}});
  for(const key of visibility)assert.equal(old.settings.lowerThird[key],false);
  assert.equal(old.settings.lowerThird.titleScale,100);
  assert.equal(old.settings.lowerThird.width,34);
});

test('Visibility switches and independent title size validate and persist across restart',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'playback-lt-'));
  t.after(()=>fs.rmSync(folder,{force:true,recursive:true}));
  const store=new DurableStore(folder);
  const engine=new PlaybackEngine(store);
  const draft=structuredClone(engine.settings);
  Object.assign(draft.lowerThird,{showChannelLabel:true,showNowPlaying:false,showDuration:false,showSkip:true,titleScale:210,scale:130});
  const before=engine.state.layoutRevision;
  engine.saveSettings(draft);
  assert.equal(engine.state.layoutRevision,before+1);
  const restored=new PlaybackEngine(store);
  assert.equal(restored.settings.lowerThird.titleScale,210);
  assert.equal(restored.settings.lowerThird.showSkip,true);
  assert.equal(restored.settings.lowerThird.showChannelLabel,true);
  assert.equal(restored.settings.lowerThird.showNowPlaying,false);
  assert.equal(restored.settings.lowerThird.showDuration,false);
  for(const bad of [49,301,NaN,Infinity,'150',null]){
    const invalid=structuredClone(draft);invalid.lowerThird.titleScale=bad;
    assert.throws(()=>validateSettings(invalid));
  }
  for(const key of visibility){const invalid=structuredClone(draft);invalid.lowerThird[key]=null;assert.throws(()=>validateSettings(invalid));}
  const unknown=structuredClone(draft);unknown.lowerThird.newUndocumentedOption=true;
  assert.throws(()=>validateSettings(unknown));
  assert.equal(new PlaybackEngine(store).settings.lowerThird.titleScale,210);
});

test('Actual OBS renderer and settings preview collapse hidden rows and scale title separately',()=>{
  const oldWindow=globalThis.window;
  globalThis.window={innerWidth:1920};
  try {
    const {el,children}=mockLowerThird();
    applyLowerThird(el,{x:3,y:0,width:34,anchor:'bottom',scale:100,titleScale:100});
    assert.equal(el.classList.contains('no-topline'),true);
    assert.equal(el.classList.contains('no-bottomline'),true);
    assert.equal(children.get('.topline').classList.contains('hidden'),true);
    assert.equal(children.get('.lowerline').classList.contains('hidden'),true);
    assert.equal(children.get('.title-clip').style.fontSize,'31px');
    // Title size grows without affecting padding or the other text sizes.
    const oldPadding=el.style.padding;
    applyLowerThird(el,{x:3,y:0,width:34,anchor:'bottom',scale:100,titleScale:200,showSkip:true});
    assert.equal(children.get('.title-clip').style.fontSize,'62px');
    assert.equal(el.style.padding,oldPadding);
    assert.equal(children.get('[data-lt-field="skip"]').classList.contains('hidden'),false);
    assert.equal(children.get('.lowerline').classList.contains('hidden'),false);
    assert.equal(children.get('.lowerline').classList.contains('only-right'),true);
    const {el:preview,children:pc}=mockLowerThird({preview:true,frameWidth:960});
    applyLowerThird(preview,{x:3,y:0,width:34,anchor:'bottom',scale:100,titleScale:200},{preview:true});
    assert.equal(pc.get('.title-clip').style.fontSize,'31px');
    assert.equal(pc.get('.topline').classList.contains('hidden'),true);
  } finally {globalThis.window=oldWindow;}
});

test('Lower Third editor exposes all toggles with same field IDs as OBS and refreshes ticker when settings change',()=>{
  const settings=read('public/settings.html');
  const obs=read('public/player.html');
  const script=read('public/assets/settings.js');
  const playerScript=read('public/assets/player.js');
  for(const id of ['ltShowChannel','ltShowNowPlaying','ltShowDuration','ltShowSkip','ltTitleScale']){
    assert.ok(settings.includes(`id="${id}"`),`missing ${id}`);
    assert.ok(script.includes(id),`missing JS wiring for ${id}`);
  }
  for(const marker of ['channel','nowPlaying','duration','skip']){
    assert.ok(settings.includes(`data-lt-field="${marker}"`));
    assert.ok(obs.includes(`data-lt-field="${marker}"`));
  }
  assert.match(playerScript,/hud\.dataset\.layoutRevision/);
  assert.match(settings,/style\.css\?v=1\.2\.1/);
  assert.match(obs,/style\.css\?v=1\.2\.1/);
});

test('Saved lower-third visibility reaches OBS public API and survives server restart',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'playback-lt-http-'));
  t.after(()=>fs.rmSync(folder,{force:true,recursive:true}));
  const make=async()=>{const app=createApp({dataDir:folder,port:0,host:'127.0.0.1',twitchEnabled:false,titleResolver:async()=>null,env:{ADMIN_TOKEN:'test-password'}});const a=await app.listen();return {app,base:`http://127.0.0.1:${a.port}`};};
  const first=await make();
  let active=first;
  t.after(async()=>{if(active?.app?.server.listening)await active.app.close();});
  const login=await fetch(first.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'test-password'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const operator=await(await fetch(first.base+'/api/operator',{headers:{Cookie:cookie}})).json();
  const settings=operator.settings;
  Object.assign(settings.lowerThird,{titleScale:255,showNowPlaying:true,showChannelLabel:false,showDuration:false,showSkip:true});
  let res=await fetch(first.base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({settings})});
  assert.equal(res.status,200);
  const data=await(await fetch(first.base+'/api/public')).json();
  assert.equal(data.settings.lowerThird.titleScale,255);
  assert.equal(data.settings.lowerThird.showNowPlaying,true);
  assert.equal(data.settings.lowerThird.showSkip,true);
  assert.equal(data.settings.lowerThird.showDuration,false);
  const invalid={...settings,lowerThird:{...settings.lowerThird,titleScale:999}};
  res=await fetch(first.base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({settings:invalid})});
  assert.equal(res.status,400);
  assert.equal((await(await fetch(first.base+'/api/public')).json()).layoutRevision,data.layoutRevision);
  await first.app.close(); active=await make();
  const migrated=await(await fetch(active.base+'/api/public')).json();
  assert.equal(migrated.settings.lowerThird.titleScale,255);
  assert.equal(migrated.settings.lowerThird.showNowPlaying,true);
  assert.equal(migrated.settings.lowerThird.showSkip,true);
  assert.equal(migrated.settings.lowerThird.showChannelLabel,false);
});