import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_SETTINGS,validateSettings} from '../lib/config.js';
import {DurableStore} from '../lib/store.js';
import {PlaybackEngine,migrateState} from '../lib/engine.js';
import {applyLowerThird} from '../public/assets/common.js';
import {createApp} from '../lib/http.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function mockCard({preview=false,frameWidth=960}={}){
  const classes=()=>({s:new Set(),toggle(key,on){if(on)this.s.add(key);else this.s.delete(key);},contains(key){return this.s.has(key);}});
  const m=new Map();
  const el={classList:classes(),style:{},querySelector:key=>m.get(key)||null,closest:()=>preview?{clientWidth:frameWidth}:null};
  for(const key of ['channel','nowPlaying','duration','skip'])m.set(`[data-lt-field="${key}"]`,{classList:classes()});
  for(const key of ['.topline','.lowerline','.title-clip'])m.set(key,{classList:classes(),style:{}});
  return {el,m};
}
test('Old saved layouts keep automatic height and the original 89% background opacity',()=>{
  const old=migrateState({schemaVersion:1,settings:{lowerThird:{x:5,y:0,width:37,scale:110,titleScale:100,anchor:'bottom'}}});
  assert.equal(DEFAULT_SETTINGS.lowerThird.height,0);
  assert.equal(DEFAULT_SETTINGS.lowerThird.backgroundOpacity,89);
  assert.equal(old.settings.lowerThird.height,0);
  assert.equal(old.settings.lowerThird.backgroundOpacity,89);
  assert.equal(old.settings.lowerThird.width,37);
});
test('Height and opacity validate bounds and frame containment',()=>{
  const base=structuredClone(DEFAULT_SETTINGS);
  for(const height of [0,4,12.5,65]){
    const s=structuredClone(base);s.lowerThird.height=height;
    assert.equal(validateSettings(s).lowerThird.height,height);
  }
  for(const opacity of [0,1,58,89,100]){
    const s=structuredClone(base);s.lowerThird.backgroundOpacity=opacity;
    assert.equal(validateSettings(s).lowerThird.backgroundOpacity,opacity);
  }
  for(const height of [-1,1,3.9,65.1,100,NaN,Infinity,'12',null]){
    const s=structuredClone(base);s.lowerThird.height=height;
    assert.throws(()=>validateSettings(s),`height ${height} rejected`);
  }
  for(const opacity of [-1,101,'50',null,NaN,Infinity]){
    const s=structuredClone(base);s.lowerThird.backgroundOpacity=opacity;
    assert.throws(()=>validateSettings(s),`opacity ${opacity} rejected`);
  }
  const outOfFrame=structuredClone(base);
  Object.assign(outOfFrame.lowerThird,{anchor:'top',y:45,height:60});
  assert.throws(()=>validateSettings(outOfFrame),/frame/);
});
test('Lower third engine settings survive restart without changing playback generation',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'playback-height-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const store=new DurableStore(folder),engine=new PlaybackEngine(store);
  const generation=engine.state.generation,layoutRevision=engine.state.layoutRevision;
  const settings=structuredClone(engine.settings);
  Object.assign(settings.lowerThird,{height:16.2,backgroundOpacity:42,anchor:'bottom',width:52,x:6,y:2});
  engine.saveSettings(settings);
  assert.equal(engine.state.generation,generation);
  assert.equal(engine.state.layoutRevision,layoutRevision+1);
  const restored=new PlaybackEngine(store);
  assert.equal(restored.settings.lowerThird.height,16.2);
  assert.equal(restored.settings.lowerThird.backgroundOpacity,42);
  assert.equal(restored.settings.lowerThird.anchor,'bottom');
});
test('OBS renderer and preview share exact opacity, percent height, and anchor rules',()=>{
  const oldWindow=globalThis.window;
  globalThis.window={innerWidth:1920};
  try{
    for(const preview of [false,true]){
      const {el,m}=mockCard({preview,frameWidth:960});
      const layout={x:5,y:0,width:34,height:14.5,backgroundOpacity:35,anchor:'bottom',titleScale:120,scale:100};
      applyLowerThird(el,layout,{preview});
      assert.equal(el.style.height,'14.5%');
      assert.equal(el.style.bottom,'0%');
      assert.equal(el.style.top,'auto');
      assert.equal(el.style.backgroundColor,'rgba(13, 16, 16, 0.35)');
      assert.ok(el.classList.contains('manual-height'));
      assert.ok(el.classList.contains('bottom-anchored'));
      const opacityStyles=el.style.padding;
      applyLowerThird(el,{...layout,backgroundOpacity:0,anchor:'top',y:2,height:0},{preview});
      assert.equal(el.style.height,'auto');
      assert.equal(el.style.top,'2%');
      assert.equal(el.style.bottom,'auto');
      assert.equal(el.style.backgroundColor,'rgba(13, 16, 16, 0.00)');
      assert.equal(el.style.padding,opacityStyles);
      assert.ok(!el.classList.contains('manual-height'));
      assert.ok(!el.classList.contains('bottom-anchored'));
      assert.equal(m.get('.topline').classList.contains('hidden'),true);
    }
  }finally{globalThis.window=oldWindow;}
});
test('Lower Third editor exposes opacity, manual height, auto height, diagonal resize and full-width preview',()=>{
  const html=read('public/settings.html'),style=read('public/assets/style.css'),js=read('public/assets/settings.js');
  for(const id of ['ltHeight','ltOpacity','ltOpacityValue','ltAutoHeight','resizeHandle','lowerPreview'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(html,/class="lowerthird-editor-workspace"/);
  assert.match(style,/\.lowerthird-editor-workspace\{display:grid;grid-template-columns:/);
  assert.match(style,/\.preview-safe-area/);
  assert.match(style,/\.lowerthird\.bottom-anchored \.resize-handle\{top:0;bottom:auto/);
  assert.match(js,/lt\.height=round\(clamp\(start\.height\+change/);
  assert.match(js,/const change=lt\.anchor==='bottom'\?-dy:dy/);
  assert.match(js,/backgroundOpacity:number\('ltOpacity'\)/);
  assert.match(js,/draft\.lowerThird\.height=0;populateLower\(\);dirty\(\)/);
});
test('Updated lower third height and background opacity reach the public OBS state',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'playback-lt-http-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const app=createApp({dataDir:folder,port:0,host:'127.0.0.1',twitchEnabled:false,titleResolver:async()=>null,env:{ADMIN_TOKEN:'test-password'}});
  const info=await app.listen();t.after(()=>app.close());
  const base=`http://127.0.0.1:${info.port}`;
  const auth=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'test-password'})});
  assert.equal(auth.status,200);
  const cookie=auth.headers.get('set-cookie').split(';')[0];
  const operator=await(await fetch(`${base}/api/operator`,{headers:{Cookie:cookie}})).json();
  Object.assign(operator.settings.lowerThird,{height:15,backgroundOpacity:0,x:0,y:0});
  const saved=await fetch(`${base}/api/settings`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({settings:operator.settings})});
  assert.equal(saved.status,200);
  const obs=await(await fetch(`${base}/api/public`)).json();
  assert.equal(obs.settings.lowerThird.height,15);
  assert.equal(obs.settings.lowerThird.backgroundOpacity,0);
});