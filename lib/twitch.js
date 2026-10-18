import {ChatAdminDispatcher} from './chat-admin.js';
export {parseAdminCommand} from './chat-admin.js';
import tls from 'node:tls';
import crypto from 'node:crypto';

export function parseIrcLine(line){
  const out={tags:{},command:'',params:[],nick:''};let rest=line;
  if(rest.startsWith('@')){const n=rest.indexOf(' ');if(n<0)return null;for(const item of rest.slice(1,n).split(';')){const [key,...value]=item.split('=');out.tags[key]=value.join('=');}rest=rest.slice(n+1);}
  if(rest.startsWith(':')){const n=rest.indexOf(' ');if(n<0)return null;out.nick=rest.slice(1,n).split('!')[0];rest=rest.slice(n+1);}
  const tail=rest.indexOf(' :');if(tail>=0){const before=rest.slice(0,tail).trim().split(/\s+/);out.command=before.shift();out.params=[...before,rest.slice(tail+2)];}
  else {const parts=rest.trim().split(/\s+/);out.command=parts.shift();out.params=parts;}
  return out;
}
export function commandFromMessage(line){
  const msg=parseIrcLine(line);if(msg?.command!=='PRIVMSG')return null;
  if(!msg.params[0]?.startsWith('#'))return null;
  const user=(msg.tags['user-id']?`id:${msg.tags['user-id']}`:`nick:${msg.nick.toLowerCase()}`);
  if(!/^id:\d+$|^nick:[a-z0-9_]+$/.test(user))return null;
  const text=msg.params.at(-1)?.trim()||'';
  const channel=msg.params[0].slice(1).toLowerCase();
  const vote=/^!vote\s+([1-4])$/i.exec(text);
  if(vote)return {kind:'vote',channel,user,choice:Number(vote[1])};
  if(/^!skip$/i.test(text))return {kind:'skip',channel,user};
  const request=/^!(?:request|suggest)\s+(\S+)(?:\s*\|\s*(.{1,180}))?$/i.exec(text);
  if(request)return {kind:'request',channel,user,url:request[1],title:request[2]||''};
  return null;
}
export function voteFromMessage(line){
  const command=commandFromMessage(line);
  if(command?.kind!=='vote')return null;
  const {kind,...rest}=command;return rest;
}

export class TwitchConnector {
  constructor(engine,{env=process.env,connect=tls.connect,delay=(fn,ms)=>setTimeout(fn,ms),onCatalogChange=()=>{},adminDispatcher}={}){
    this.engine=engine;this.env=env;this.connect=connect;this.delay=delay;this.socket=null;this.timer=null;this.stopped=false;this.attempt=0;this.status={state:'DISABLED',mode:'disabled',channel:'',detail:''};
    this.adminDispatcher=adminDispatcher||new ChatAdminDispatcher(engine,{onCatalogChange});
  }
  get adminActivity(){return this.adminDispatcher.adminActivity;}
  get adminMessageIds(){return this.adminDispatcher.adminMessageIds;}
  handleAdminMessage(message){
    if(message?.command!=='PRIVMSG'||this.stopped)return false;
    if(!/^[1-9]\d*$/.test(message.tags['user-id']||''))return false;
    if(message.tags['source-room-id']&&message.tags['source-room-id']!==message.tags['room-id'])return false;
    return this.adminDispatcher.handleMessage({platform:'twitch',channel:message.params[0]?.replace(/^#/,''),
      username:message.nick,userId:message.tags['user-id'],text:message.params.at(-1),messageId:message.tags.id});
  }
  start(){this.stopped=false;this.reconfigure();}
  stop(){this.stopped=true;this.reset();this.status={state:'DISABLED',mode:'disabled',channel:'',detail:''};}
  reset(){if(this.timer){clearTimeout(this.timer);this.timer=null;}if(this.socket){this.socket.removeAllListeners();this.socket.destroy();this.socket=null;}}
  reconfigure(){
    this.reset();this.attempt=0;
    const s=this.engine.settings;this.status={state:'DISABLED',mode:s.twitchMode,channel:s.twitchChannel,detail:''};
    if(s.twitchMode==='disabled'||!s.twitchChannel||this.stopped)return;
    if(s.twitchMode==='authenticated'&&(!this.env.TWITCH_USERNAME||!this.env.TWITCH_OAUTH_TOKEN)){
      this.status.state='CONFIG_REQUIRED';this.status.detail='Set TWITCH_USERNAME and TWITCH_OAUTH_TOKEN in the server environment';return;
    }
    this.open();
  }
  open(){
    if(this.stopped)return;
    const {twitchMode:mode,twitchChannel:channel}=this.engine.settings;
    if(mode==='disabled'||!channel)return;
    this.status={state:'CONNECTING',mode,channel,detail:''};
    const nick=mode==='anonymous'?`justinfan${crypto.randomInt(100000,9999999)}`:this.env.TWITCH_USERNAME;
    const pass=mode==='anonymous'?'SCHMOOPIIE':this.env.TWITCH_OAUTH_TOKEN;
    let socket;
    try{socket=this.connect({host:'irc.chat.twitch.tv',port:6697,servername:'irc.chat.twitch.tv',rejectUnauthorized:true,timeout:15000});}
    catch(e){this.retry(e.message);return;}
    this.socket=socket;let buf='';let joined=false;
    socket.on('secureConnect',()=>{
      socket.write(`PASS ${mode==='anonymous'?'SCHMOOPIIE':(pass?.startsWith('oauth:')?pass:`oauth:${pass}`)}\r\n`);
      socket.write(`NICK ${nick}\r\nCAP REQ :twitch.tv/tags twitch.tv/commands\r\nJOIN #${channel}\r\n`);
    });
    socket.on('data',chunk=>{
      buf+=chunk.toString('utf8');if(buf.length>131072){socket.destroy();return;}
      let n;while((n=buf.indexOf('\r\n'))>=0){
        const line=buf.slice(0,n);buf=buf.slice(n+2);
        if(line.startsWith('PING ')){socket.write('PONG '+line.slice(5)+'\r\n');continue;}
        const parsed=parseIrcLine(line);
        if(parsed?.command==='001'||parsed?.command==='366'||(parsed?.command==='JOIN'&&parsed.nick.toLowerCase()===nick.toLowerCase())){
          joined=true;this.attempt=0;this.status={state:'CONNECTED',mode,channel,detail:mode==='anonymous'?'Read-only anonymous IRC':'Authenticated IRC'};
        }
        if(parsed?.command==='NOTICE'&&/authentication failed|invalid nick|login unsuccessful|improperly formatted/i.test(parsed.params.at(-1)||'')){
          this.status.state='AUTH_ERROR';this.status.detail='Twitch rejected chat authentication';socket.destroy();return;
        }
        if(this.handleAdminMessage(parsed))continue;
        const command=commandFromMessage(line);
        if(command && command.channel===channel.toLowerCase()){
          const voter=this.engine.hashViewer('twitch',command.user);
          try {
            if(command.kind==='vote'&&this.engine.state.vote)this.engine.voteChoice(command.choice,voter);
            if(command.kind==='skip'&&this.engine.settings.skipVoting&&this.engine.state.current&&!this.engine.state.vote)this.engine.skipVote(voter);
            if(command.kind==='request'&&this.engine.settings.allowSuggestions)this.engine.suggest(command.url,command.title,voter);
          }catch{}
        }
      }
    });
    let disconnected=false;const end=reason=>{
      if(disconnected||this.stopped||this.socket!==socket)return;disconnected=true;
      this.socket=null;socket.destroy();this.retry(reason||(!joined?'Could not join channel':'Disconnected'));
    };
    socket.on('timeout',()=>end('Connection timed out'));
    socket.on('error',e=>end(e.code||e.message));
    socket.on('close',()=>end('Disconnected'));
  }
  retry(reason){
    if(this.stopped)return;
    const {twitchMode, twitchChannel}=this.engine.settings;
    this.status={state:'RETRYING',mode:twitchMode,channel:twitchChannel,detail:String(reason).slice(0,120)};
    const wait=Math.min(60000,1000*2**Math.min(this.attempt++,6));
    this.timer=this.delay(()=>{this.timer=null;this.open();},wait);
  }
}
