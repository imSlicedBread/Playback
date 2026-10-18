import {ChatSocketReader,boundedJson} from './chat-socket.js';
import {SOOP_API,SoopAuth} from './soop-auth.js';

// Receive-only subset of the official SDK wire protocol used by fStream's
// pinned 2026-10-02 SOOP SDK. Never send chat, whispers or moderation packets.
const SEP='\x0c';
export function soopPacket(service,fields=[]){
  const body=Buffer.from(SEP+fields.join(SEP)+(fields.length?SEP:''),'utf8');
  return Buffer.concat([Buffer.from(`\x1b\x09${String(service).padStart(4,'0')}${String(body.length).padStart(6,'0')}00`,'ascii'),body]);
}
export function parseSoopPacket(data){
  const bytes=Buffer.isBuffer(data)?data:data instanceof ArrayBuffer?Buffer.from(data):ArrayBuffer.isView(data)?Buffer.from(data.buffer,data.byteOffset,data.byteLength):null;
  if(!bytes||bytes.length<14||bytes.length>128*1024||bytes[0]!==27||bytes[1]!==9)return null;
  const header=bytes.toString('ascii',2,14);if(!/^\d{10}-?\d{1,2}$/.test(header)||header.length!==12)return null;
  if(Number(header.slice(4,10))!==bytes.length-14)return null;
  const body=bytes.subarray(14).toString('utf8');if(!body.startsWith(SEP))return null;
  return {service:Number(header.slice(0,4)),result:Number(header.slice(10)),fields:body.slice(1).split(SEP)};
}
export function soopSocketUrl(row){
  const parts=String(row.chat_ip||'').split('.'),port=Number(row.chat_port)+1;
  if(parts.length!==4||parts.some(n=>!/^\d{1,3}$/.test(n)||Number(n)>255)||!Number.isInteger(port)||port<1024||port>65535||!/^\w[\w.-]{0,79}$/.test(row.id||''))throw new Error('Invalid SOOP chat address');
  return `wss://chat-${parts.map(n=>Number(n).toString(16).padStart(2,'0')).join('').toUpperCase()}.sooplive.com:${port}/Websocket/${row.id}`;
}
export function soopJoinPacket(row,clientId){
  // The official SDK used by fStream emits the optional secret as the literal
  // word "undefined" when constructed with the public client ID alone.
  const log=`log\x11\x06&\x06is_chat_sdk\x06=\x06true\x06&\x06sdk_client_id\x06=\x06${clientId}\x06&\x06sdk_client_secret\x06=\x06undefined\x12access_system\x11html5\x12`;
  return soopPacket(2,[String(row.chat_no),row.key,'5','',log]);
}
export function parseSoopAdminMessage(packet,channel){
  if(!packet||packet.result<0||![5,26].includes(packet.service))return null;
  const [text,userId]=packet.fields;
  // SOOP display names and guest IDs cannot grant operator privileges.
  if(typeof text!=='string'||!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,79}$/.test(userId||''))return null;
  const flags=packet.fields[packet.service===5?6:5];
  if(!/^\d{1,10}(?:\|\d{1,10})?$/.test(flags||''))return null;
  const flag1=Number(flags.split('|')[0]);
  if(flag1>0xffffffff||(flag1&16)!==0)return null; // Official SDK isGuest bit.
  return {platform:'soop',channel,username:userId,userId,text:text.replace(/\r/g,''),messageId:null};
}

export class SoopConnector extends ChatSocketReader {
  constructor(engine,options={}){
    super(engine,'soop',options);this.env=options.env||process.env;
    this.auth=options.auth||new SoopAuth({env:this.env,dataDir:options.dataDir,fetchImpl:this.fetchImpl});
    this.renewal=null;
  }
  reset(){if(this.renewal!=null)this.cancelDelay(this.renewal);this.renewal=null;super.reset();}
  async open(epoch){
    let token=await this.auth.accessToken({signal:this.abort.signal});
    if(!this.current(epoch))return;
    let row;
    for(let attempt=0;attempt<2;attempt++){
      const response=await this.fetchImpl(SOOP_API+'/broad/access/chatinfo',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
        body:new URLSearchParams({access_token:token}),signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(10000)])});
      const data=await boundedJson(response,128*1024);
      if(!this.current(epoch))return;
      if(response.ok&&Number(data.result)>0&&Array.isArray(data.data)){
        row=data.data.find(item=>typeof item.id==='string'&&item.id.toLowerCase()===this.engine.settings.soopChannel);
        if(!row||!Number(row.broad_no))throw Object.assign(new Error('Broadcast is offline or not authorized.'),{state:'WAITING_FOR_LIVE'});
        break;
      }
      if(response.ok)throw Object.assign(new Error('SOOP has no available live chat. Check the broadcaster and approved chat scope.'),{state:'WAITING_FOR_LIVE'});
      if(response.status>=500)throw new Error('SOOP service unavailable');
      if(attempt===0){token=await this.auth.accessToken({forceRefresh:true,signal:this.abort.signal});if(!this.current(epoch))return;}
      else throw Object.assign(new Error('Reconnect SOOP and grant broad_access_chatinfo.'),{state:'AUTH_ERROR'});
    }
    const channel=this.engine.settings.soopChannel,clientId=this.env.SOOP_CLIENT_ID;
    if(!/^[a-zA-Z0-9_-]{1,200}$/.test(clientId||''))throw Object.assign(new Error('Set SOOP_CLIENT_ID.'),{state:'CONFIG_REQUIRED'});
    if(typeof row.key!=='string'||!row.key||row.key.length>8192||/[\u0000-\u001f]/.test(row.key)||!/^\d{1,20}$/.test(String(row.chat_no)))throw new Error('Invalid SOOP chat ticket');
    const socket=this.webSocketFactory(soopSocketUrl(row),'chat');socket.binaryType='arraybuffer';
    let joined=false,loginReceived=false;
    this.attach(socket,epoch,()=>socket.send(soopPacket(16,[token,'16'])),raw=>{
      const packet=parseSoopPacket(raw);if(!packet)return;
      if(packet.result<0){this.retry('SOOP rejected the chat session; retrying.');return;}
      if(packet.service===1&&!loginReceived){
        loginReceived=true;
        socket.send(soopJoinPacket(row,clientId));return;
      }
      if(packet.service===2&&loginReceived){
        if(packet.fields[0]!==String(row.chat_no)||packet.fields[1]?.toLowerCase()!==channel){this.retry('SOOP joined a different broadcast; retrying.');return;}
        if(!joined){joined=true;this.ready();this.keepAlive(epoch);this.scheduleRenewal(epoch);}return;
      }
      if(packet.service===88||packet.service===3){this.retry('SOOP broadcast ended or chat disconnected; retrying.');return;}
      if(joined){const message=parseSoopAdminMessage(packet,channel);if(message)this.adminDispatcher.handleMessage(message);}
    });
  }
  keepAlive(epoch){
    this.heartbeat=this.delay(()=>{
      if(!this.current(epoch))return;
      try{this.socket.send(soopPacket(0));this.keepAlive(epoch);}catch{this.retry();}
    },60000);this.heartbeat?.unref?.();
  }
  scheduleRenewal(epoch){
    const expiresAt=this.auth.credentials?.expiresAt;if(!expiresAt)return;
    this.renewal=this.delay(()=>{if(this.current(epoch)){this.reset();this.connect();}},Math.max(1000,Math.min(2147483647,expiresAt-Date.now()-60000)));
    this.renewal?.unref?.();
  }
}
