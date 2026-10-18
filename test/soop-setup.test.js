import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createSoopSetup} from '../ops/connect-soop.mjs';

test('Independent localhost SOOP setup requires a private start link and cookie, rejects mismatched state and exchanges codes only once',{timeout:10000},async t=>{
  let finish,exchanges=0;
  const completed=new Promise(resolve=>{finish=resolve;});
  const {server,nonce}=createSoopSetup({clientId:'public-client',auth:{exchangeCode:async code=>{assert.equal(code,'private-code');exchanges++;await completed;}}});
  t.after(()=>{finish();return new Promise(resolve=>server.close(resolve));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/callback?code=private-code')).status,403);
  assert.equal((await fetch(base+'/start/wrong',{redirect:'manual'})).status,403);
  const start=await fetch(base+'/start/'+nonce,{redirect:'manual'});
  assert.equal(start.status,302);assert.equal(start.headers.get('cache-control'),'no-store');
  const destination=new URL(start.headers.get('location'));assert.equal(destination.origin,'https://openapi.sooplive.com');
  assert.equal(destination.searchParams.get('scope'),'broad_access_chatinfo');
  const cookie=start.headers.get('set-cookie').split(';')[0];assert.match(start.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  const headers={Cookie:cookie};
  assert.equal((await fetch(base+'/callback?code=private-code&state=wrong',{headers})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{
    http.get(base+'/callback?code=private-code',{headers:{...headers,Host:'attacker.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);
  });
  assert.equal(wrongHost,403);
  const result=fetch(base+'/callback?code=private-code&state='+nonce,{headers});
  while(exchanges===0)await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await fetch(base+'/callback?code=private-code',{headers})).status,409);
  finish();const response=await result;assert.equal(response.status,200);
  assert.equal((await response.text()).includes('private-code'),false);assert.equal(exchanges,1);
});
