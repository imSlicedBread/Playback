import {ChatSocketReader,boundedJson} from './chat-socket.js';

// Matches fStream's production read-only Kick adapter; this is an unofficial
// outbound Pusher transport, not Kick's official public-webhook integration.
export const KICK_SOCKET_URL='wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=7.4.0&flash=false';
const id=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value)?value:null;

export function parseKickAdminMessage(raw,{channel,chatroomId,startedAt,now}){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>128*1024)return null;
  let envelope,data;try{envelope=JSON.parse(raw);data=typeof envelope.data==='string'?JSON.parse(envelope.data):envelope.data;}catch{return null;}
  if(envelope.event!=='App\\Events\\ChatMessageEvent'||!['chatrooms.'+chatroomId,'chatrooms.'+chatroomId+'.v2'].includes(envelope.channel))return null;
  if(!data||data.type&&!['message','reply'].includes(data.type))return null;
  if(data.chatroom_id!==undefined&&id(data.chatroom_id)!==chatroomId)return null;
  const sender=data.sender,userId=id(sender?.id),username=sender?.username;
  if(!userId||typeof username!=='string'||!data.id||typeof data.id!=='string'||data.id.length>128||typeof data.content!=='string')return null;
  const timestamp=Date.parse(data.created_at);
  if(!Number.isFinite(timestamp)||timestamp<startedAt-2000||timestamp<now-300000||timestamp>now+30000)return null;
  return {platform:'kick',channel,username,userId,messageId:data.id,text:data.content};
}

export class KickConnector extends ChatSocketReader {
  constructor(engine,options={}){super(engine,'kick',options);}
  async open(epoch){
    const settings=this.engine.settings,channel=settings.kickChannel;
    let chatroomId=settings.kickChatroomId;
    if(!chatroomId){
      for(const version of ['v2','v1']){
        const response=await this.fetchImpl(`https://kick.com/api/${version}/channels/${encodeURIComponent(channel)}`,{redirect:'error',headers:{Accept:'application/json','User-Agent':'fKey Playback','Referer':`https://kick.com/${channel}`},signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(10000)])});
        if(!response.ok){await response.body?.cancel();continue;}
        const data=await boundedJson(response,512*1024);chatroomId=id(data.chatroom?.id);if(chatroomId)break;
      }
      if(!chatroomId)throw Object.assign(new Error('Kick channel lookup failed. Check the channel or enter its chatroom ID.'),{state:'CONFIG_REQUIRED'});
    }
    if(!this.current(epoch))return;
    const socket=this.webSocketFactory(KICK_SOCKET_URL),startedAt=this.engine.clock();
    this.attach(socket,epoch,()=>{
      for(const suffix of ['.v2',''])socket.send(JSON.stringify({event:'pusher:subscribe',data:{channel:`chatrooms.${chatroomId}${suffix}`}}));
    },raw=>{
      if(typeof raw!=='string'||Buffer.byteLength(raw)>128*1024)return;
      const envelope=JSON.parse(raw);
      if(envelope.event==='pusher:ping'){socket.send(JSON.stringify({event:'pusher:pong',data:{}}));return;}
      if(envelope.event==='pusher:error'){this.retry('Kick rejected the subscription; retrying.');return;}
      if(envelope.event==='pusher_internal:subscription_succeeded'&&[`chatrooms.${chatroomId}.v2`,`chatrooms.${chatroomId}`].includes(envelope.channel))this.ready();
      const message=parseKickAdminMessage(raw,{channel,chatroomId,startedAt,now:this.engine.clock()});
      if(message&&this.status.state==='CONNECTED')this.adminDispatcher.handleMessage(message);
    });
  }
}
