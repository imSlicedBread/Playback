import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SoopAuth,SOOP_API} from '../lib/soop-auth.js';

// Independent, one-shot desktop OAuth setup. No fKey service or public callback.
export function createSoopSetup({auth,clientId,onConnected=()=>{},onTimeout=()=>{},timeoutMs=600000}){
  const nonce=crypto.randomBytes(24).toString('hex');
  let busy=false,finished=false,timeout;
  const server=http.createServer(async(req,res)=>{
    const headers={'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'};
    const reply=(status,text)=>{res.writeHead(status,headers);res.end(text);};
    if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${req.socket.localPort}`)return reply(403,'Local OAuth setup only.');
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname===`/start/${nonce}`&&!finished){
      const destination=new URL(SOOP_API+'/auth/code');destination.search=new URLSearchParams({client_id:clientId,response_type:'code',scope:'broad_access_chatinfo',state:nonce}).toString();
      res.writeHead(302,{...headers,Location:destination.href,'Set-Cookie':`pb_soop_setup=${nonce}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`});return res.end();
    }
    const cookie=(req.headers.cookie||'').split(';').map(value=>value.trim());
    if(url.pathname!=='/callback'||!cookie.includes(`pb_soop_setup=${nonce}`)||(url.searchParams.has('state')&&url.searchParams.get('state')!==nonce))return reply(403,'Start the connection from the private URL printed in your terminal.');
    const code=url.searchParams.get('code');
    if(finished||busy)return reply(409,'This setup is already processing or complete.');
    if(!code||code.length>4096)return reply(400,'SOOP did not return an authorization code. Check application approval and try again.');
    busy=true;
    try{
      await auth.exchangeCode(code);finished=true;
      res.setHeader('Set-Cookie','pb_soop_setup=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      reply(200,'SOOP connected to Playback. You may close this tab. In Playback Settings, enable SOOP, enter your account login ID, save, and click Reconnect SOOP.');
      clearTimeout(timeout);server.close();onConnected();
    }catch{busy=false;reply(502,'SOOP connection failed. Check client credentials, approved scope and redirect URL, then restart setup.');}
  });
  server.on('listening',()=>{timeout=setTimeout(()=>{finished=true;server.close();onTimeout();},timeoutMs);});
  server.on('close',()=>clearTimeout(timeout));server.on('error',()=>clearTimeout(timeout));
  return {server,nonce};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dataDir=process.env.DATA_DIR||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
  if(!process.env.SOOP_CLIENT_ID||!process.env.SOOP_CLIENT_SECRET){
    console.error('Set SOOP_CLIENT_ID and SOOP_CLIENT_SECRET for your own SOOP developer application. Register http://127.0.0.1:4180/callback and obtain broad_access_chatinfo approval.');
    process.exitCode=1;
  }else{
    const {server,nonce}=createSoopSetup({auth:new SoopAuth({dataDir}),clientId:process.env.SOOP_CLIENT_ID,
      onConnected:()=>console.log('SOOP tokens saved locally. Enable SOOP in Playback Settings and click Reconnect SOOP.'),
      onTimeout:()=>console.error('SOOP setup timed out. Run npm run connect:soop again.')});
    server.on('error',error=>{console.error('Cannot start local SOOP callback:',error.code);process.exitCode=1;});
    server.listen(4180,'127.0.0.1',()=>console.log(`Open http://127.0.0.1:4180/start/${nonce} in your browser. Registered SOOP redirect: http://127.0.0.1:4180/callback`));
  }
}
