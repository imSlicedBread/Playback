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

const ADMIN_USAGE=Object.freeze({pause:'!pause',resume:'!resume',forceskip:'!forceskip',previous:'!previous',replay:'!replay',
  seek:'!seek SECONDS',volume:'!volume 0-100',mute:'!mute',unmute:'!unmute',
  add:'!add URL [| Display title]',playnext:'!playnext URL [| Display title]',playnow:'!playnow URL [| Display title]'});

/** Recognize admin verbs separately so public voting/request syntax stays stable.
 * Recognized but invalid commands return a usage error for the operator activity list. */
export function parseAdminCommand(text){
  const match=/^!(\w+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if(!match)return null;
  const name=match[1].toLowerCase();
  if(!Object.hasOwn(ADMIN_USAGE,name))return null;
  const args=(match[2]||'').trim(),command={name};
  const invalid=()=>({...command,error:`Usage: ${ADMIN_USAGE[name]}`});
  if(['add','playnext','playnow'].includes(name)){
    const video=/^([^\s|]+)(?:\s*\|\s*([^\r\n]{1,180}))?$/.exec(args);
    return video?{...command,url:video[1],title:video[2]?.trim()||''}:invalid();
  }
  if(name==='seek')return /^\d+(?:\.\d+)?$/.test(args)?{...command,position:Number(args)}:invalid();
  if(name==='volume')return /^\d{1,3}$/.test(args)&&Number(args)<=100?{...command,volume:Number(args)}:invalid();
  return args?invalid():command;
}

export class TwitchConnector {
  constructor(engine,{env=process.env,connect=tls.connect,delay=(fn,ms)=>setTimeout(fn,ms),onCatalogChange=()=>{}}={}){
    this.engine=engine;this.env=env;this.connect=connect;this.delay=delay;this.socket=null;this.timer=null;this.stopped=false;this.attempt=0;this.status={state:'DISABLED',mode:'disabled',channel:'',detail:''};
    this.onCatalogChange=onCatalogChange;
    this.adminActivity=[];this.adminMessageIds=new Map();this.adminUserTimes=new Map();this.adminStationTimes=[];
    this.activitySequence=0;
  }
  recordAdmin(username,command,success,result){
    this.adminActivity.unshift({id:++this.activitySequence,timestamp:new Date(this.engine.clock()).toISOString(),username,command:`!${command}`,success,
      result:String(result).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,180)});
    this.adminActivity.length=Math.min(this.adminActivity.length,20);
  }
  handleAdminMessage(message){
    if(message?.command!=='PRIVMSG')return false;
    const command=parseAdminCommand(message.params.at(-1)||'');
    if(!command)return false;
    const settings=this.engine.settings,username=message.nick.toLowerCase(),userId=message.tags['user-id'];
    if(this.stopped||settings.twitchMode==='disabled'||message.params[0]?.toLowerCase()!==`#${settings.twitchChannel.toLowerCase()}`||
      !/^[a-z0-9_]{1,25}$/.test(username)||!settings.twitchAdminWhitelist.includes(username)||!/^[1-9]\d*$/.test(userId||''))return true;
    // Shared Chat copies appear addressed to this channel but originated elsewhere.
    if(message.tags['source-room-id']&&message.tags['source-room-id']!==message.tags['room-id'])return true;
    const now=this.engine.clock(),messageId=message.tags.id;
    for(const [id,time] of this.adminMessageIds)if(now-time>=300000)this.adminMessageIds.delete(id);
    if(messageId){
      if(this.adminMessageIds.has(messageId))return true;
      this.adminMessageIds.set(messageId,now);
      while(this.adminMessageIds.size>1000)this.adminMessageIds.delete(this.adminMessageIds.keys().next().value);
    }
    for(const [id,time] of this.adminUserTimes)if(now-time>=2000)this.adminUserTimes.delete(id);
    this.adminStationTimes=this.adminStationTimes.filter(time=>now-time<60000);
    if(this.adminUserTimes.has(userId)||this.adminStationTimes.length>=30){
      this.recordAdmin(username,command.name,false,'Rate limited: wait 2 seconds between commands; station limit is 30 per minute.');return true;
    }
    this.adminUserTimes.set(userId,now);this.adminStationTimes.push(now);
    try{
      if(command.error)throw new Error(command.error);
      const engine=this.engine,audio=engine.state.audio;
      switch(command.name){
        case 'pause':engine.pause(true);break;
        case 'resume':engine.pause(false);break;
        case 'forceskip':
          if(!engine.state.current)throw new Error('No playing video');
          engine.skip();break;
        case 'previous':engine.previous();break;
        case 'replay':engine.replay();break;
        case 'seek':engine.seek(command.position);break;
        case 'volume':engine.setAudio(command.volume,audio.muted);break;
        case 'mute':engine.setAudio(audio.volume,true);break;
        case 'unmute':engine.setAudio(audio.volume||50,false);break;
        case 'add':engine.add(command.url,command.title);break;
        case 'playnext':engine.add(command.url,command.title,{destination:'playNext'});break;
        case 'playnow':engine.add(command.url,command.title,{now:true});break;
      }
      this.recordAdmin(username,command.name,true,'Applied');
      // Metadata is best effort after the playback mutation has committed.
      if(['forceskip','previous','add','playnext','playnow'].includes(command.name)){
        try{this.onCatalogChange();}catch{}
      }
    }catch(error){this.recordAdmin(username,command.name,false,error.message||'Command failed');}
    return true;
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
