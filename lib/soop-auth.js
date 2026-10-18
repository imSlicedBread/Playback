import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {mkdirPrivate} from './store.js';
import {boundedJson} from './chat-socket.js';

export const SOOP_API='https://openapi.sooplive.com';
const authError=()=>Object.assign(new Error('SOOP authorization is missing or expired. Run npm run connect:soop with your own SOOP application credentials.'),{state:'AUTH_ERROR'});

export class SoopAuth {
  constructor({env=process.env,dataDir,fetchImpl=globalThis.fetch}={}){
    this.env=env;this.fetchImpl=fetchImpl;this.file=dataDir?path.join(dataDir,'soop-auth.json'):null;
    this.credentials=null;
  }
  seed(){return crypto.createHash('sha256').update(`${this.env.SOOP_CLIENT_ID||''}\0${this.env.SOOP_ACCESS_TOKEN||''}\0${this.env.SOOP_REFRESH_TOKEN||''}`).digest('hex');}
  load(){
    if(!/^[a-zA-Z0-9_-]{1,200}$/.test(this.env.SOOP_CLIENT_ID||''))throw Object.assign(new Error('Set SOOP_CLIENT_ID and run npm run connect:soop, or configure SOOP_ACCESS_TOKEN.'),{state:'CONFIG_REQUIRED'});
    if(this.file){
      try{
        const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
        if(data.seed===this.seed())this.credentials=data;
      }catch(error){if(error.code!=='ENOENT')throw authError();}
    }
    this.credentials??={seed:this.seed(),accessToken:this.env.SOOP_ACCESS_TOKEN||'',refreshToken:this.env.SOOP_REFRESH_TOKEN||'',expiresAt:null};
    return this.credentials;
  }
  save(data){
    const previous=this.credentials||this.load();
    if(typeof data.access_token!=='string'||!data.access_token||data.access_token.length>8192)throw authError();
    if(data.refresh_token!==undefined&&data.refresh_token!==null&&(typeof data.refresh_token!=='string'||data.refresh_token.length>8192))throw authError();
    const next={seed:this.seed(),accessToken:data.access_token,refreshToken:data.refresh_token||previous.refreshToken,
      expiresAt:Number.isFinite(Number(data.expires_in))&&Number(data.expires_in)>0?Date.now()+Number(data.expires_in)*1000:null};
    if(this.file){
      mkdirPrivate(path.dirname(this.file));const temp=this.file+'.'+crypto.randomUUID()+'.tmp';
      try{fs.writeFileSync(temp,JSON.stringify(next)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,this.file);}
      finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
    }
    this.credentials=next;return next.accessToken;
  }
  async request(fields,signal){
    if(!this.env.SOOP_CLIENT_SECRET)throw authError();
    const response=await this.fetchImpl(SOOP_API+'/auth/token',{method:'POST',redirect:'error',
      headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:new URLSearchParams({client_id:this.env.SOOP_CLIENT_ID,client_secret:this.env.SOOP_CLIENT_SECRET,...fields}),
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
    if(!response.ok){await response.body?.cancel();throw authError();}
    const data=await boundedJson(response,64*1024);
    if(data.scope&&!String(data.scope).split(/\s+/).includes('broad_access_chatinfo'))throw authError();
    return this.save(data);
  }
  async accessToken({forceRefresh=false,signal}={}){
    const credentials=this.load();
    if(!forceRefresh&&credentials.accessToken&&(!credentials.expiresAt||credentials.expiresAt>Date.now()+60000))return credentials.accessToken;
    if(!credentials.refreshToken)throw authError();
    return this.request({grant_type:'refresh_token',refresh_token:credentials.refreshToken},signal);
  }
  exchangeCode(code){this.load();return this.request({grant_type:'authorization_code',code});}
}
