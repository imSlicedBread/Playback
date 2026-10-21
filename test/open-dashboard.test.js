import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dashboardBrowserCommand,openDashboard,openExistingDashboard} from '../lib/open-dashboard.js';

test('duplicate interactive launch opens only a healthy Playback dashboard',async()=>{
  const calls=[];
  const options={port:4177,env:{PB_OPEN_BROWSER:'1'},launch:options=>calls.push(options)};
  assert.equal(await openExistingDashboard({...options,fetchHealth:async(url,request)=>{
    assert.equal(url,'http://127.0.0.1:4177/api/health');
    assert.ok(request.signal instanceof AbortSignal);
    return {ok:true,json:async()=>({ok:true,app:'fKey Playback'})};
  }}),true);
  assert.equal(calls.length,1);assert.equal(calls[0].port,4177);
  for(const health of [{ok:true,app:'Other app'},{ok:false,app:'fKey Playback'},null]) {
    assert.equal(await openExistingDashboard({...options,fetchHealth:async()=>({ok:true,json:async()=>health})}),false);
  }
  assert.equal(await openExistingDashboard({...options,fetchHealth:async()=>({ok:false})}),false);
  assert.equal(await openExistingDashboard({...options,fetchHealth:async()=>{throw new Error('offline');}}),false);
  assert.equal(await openExistingDashboard({...options,env:{PB_OPEN_BROWSER:'0'},fetchHealth:()=>{throw new Error('must not probe');}}),false);
  assert.equal(calls.length,1);
});

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function mockLauncher() {
  const calls=[];
  return {
    calls,
    spawnProcess(command,args,options) {
      const child=new EventEmitter();
      child.unref=()=>{child.unrefCalled=true;};
      calls.push({command,args,options,child});
      return child;
    }
  };
}

test('Dashboard opens in default browser only when interactive launcher opts in',()=>{
  const m=mockLauncher();
  assert.equal(openDashboard({port:4177,env:{},platform:'win32',spawnProcess:m.spawnProcess}),false);
  assert.equal(m.calls.length,0);
  assert.equal(openDashboard({port:4177,env:{PB_OPEN_BROWSER:'0'},platform:'win32',spawnProcess:m.spawnProcess}),false);
  assert.equal(m.calls.length,0);
  assert.equal(openDashboard({port:4177,env:{PB_OPEN_BROWSER:'1'},platform:'win32',spawnProcess:m.spawnProcess}),true);
  assert.equal(m.calls.length,1);
  assert.equal(m.calls[0].command,'cmd.exe');
  assert.deepEqual(m.calls[0].args,['/d','/c','start "" "http://127.0.0.1:4177/control"']);
  assert.equal(m.calls[0].options.stdio,'ignore');
  assert.equal(m.calls[0].options.detached,true);
  assert.equal(m.calls[0].options.windowsVerbatimArguments,true);
  assert.equal(m.calls[0].child.unrefCalled,true);
});

test('Browser launches the *actual* bound port and never opens the OBS /player page',()=>{
  for(const platform of ['win32','darwin','linux']) {
    const command=dashboardBrowserCommand(48721,platform);
    assert.equal(command.url,'http://127.0.0.1:48721/control');
    assert.ok(command.args.join(' ').includes('http://127.0.0.1:48721/control'));
    assert.ok(!command.args.join(' ').includes('/player'));
    assert.equal(command.command,platform==='win32'?'cmd.exe':platform==='darwin'?'open':'xdg-open');
  }
  assert.throws(()=>dashboardBrowserCommand(0),RangeError);
  assert.throws(()=>dashboardBrowserCommand(65536),RangeError);
  assert.throws(()=>dashboardBrowserCommand('4177'),RangeError);
});

test('Headless Linux skips auto-open; desktop Linux opens only when opted in',()=>{
  const m=mockLauncher();
  assert.equal(openDashboard({port:4177,env:{PB_OPEN_BROWSER:'1'},platform:'linux',spawnProcess:m.spawnProcess}),false);
  assert.equal(m.calls.length,0);
  assert.equal(openDashboard({port:4177,env:{PB_OPEN_BROWSER:'1',WAYLAND_DISPLAY:'wayland-0'},platform:'linux',spawnProcess:m.spawnProcess}),true);
  assert.deepEqual(m.calls[0].args,['http://127.0.0.1:4177/control']);
});

test('A missing/default-browser failure does not terminate Playback',()=>{
  const warnings=[];
  const logger={warn:(msg)=>warnings.push(msg)};
  assert.equal(openDashboard({port:4177,env:{PB_OPEN_BROWSER:'1'},platform:'win32',spawnProcess:()=>{throw new Error('missing browser');},logger}),false);
  assert.match(warnings[0],/missing browser/);
  const m=mockLauncher();
  assert.equal(openDashboard({port:4177,env:{PB_OPEN_BROWSER:'1'},platform:'win32',spawnProcess:m.spawnProcess,logger}),true);
  m.calls[0].child.emit('error',new Error('no URL handler'));
  assert.match(warnings[1],/no URL handler/);
});

test('Windows double-click and Unix interactive launchers opt in; supervised autostart remains headless',()=>{
  const win=fs.readFileSync(path.join(root,'start-player.bat'),'utf8');
  const sh=fs.readFileSync(path.join(root,'start-player.sh'),'utf8');
  const supervisor=fs.readFileSync(path.join(root,'ops/start-player-supervised.bat'),'utf8');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  assert.match(win,/PB_OPEN_BROWSER=1/);
  assert.match(sh,/PB_OPEN_BROWSER/);
  assert.doesNotMatch(supervisor,/PB_OPEN_BROWSER=1/);
  assert.match(server,/const address=await app\.listen\(\);[\s\S]*?openDashboard\(\{port:p\}\)/);
});
