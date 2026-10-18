// Shared admin execution; transport adapters supply verified sender identities.
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


export class ChatAdminDispatcher {
  constructor(engine,{onCatalogChange=()=>{}}={}){
    this.engine=engine;this.onCatalogChange=onCatalogChange;
    this.adminActivity=[];this.adminMessageIds=new Map();this.adminUserTimes=new Map();this.adminStationTimes=[];this.activitySequence=0;
  }
  recordAdmin(platform,username,command,success,result){
    this.adminActivity.unshift({id:++this.activitySequence,timestamp:new Date(this.engine.clock()).toISOString(),platform,username,command:`!${command}`,success,
      result:String(result).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,180)});
    this.adminActivity.length=Math.min(this.adminActivity.length,20);
  }
  handleMessage(message){
    if(typeof message.text!=='string'||message.text.length>4096)return false;
    const command=parseAdminCommand(message.text);if(!command)return false;
    const {platform}=message,settings=this.engine.settings;
    if(!['twitch','kick','soop'].includes(platform))return true;
    const enabled=platform==='twitch'?settings.twitchMode!=='disabled':settings[platform+'Enabled'];
    const username=typeof message.username==='string'?message.username.toLowerCase():'';
    const pattern=platform==='twitch'?/^[a-z0-9_]{1,25}$/:/^[a-z0-9_][a-z0-9_.-]{0,79}$/;
    if(!enabled||!pattern.test(username)||!settings[platform+'AdminWhitelist'].includes(username)||
      typeof message.channel!=='string'||message.channel.toLowerCase()!==settings[platform+'Channel'].toLowerCase()||
      typeof message.userId!=='string'||!message.userId||message.userId.length>100)return true;
    const now=this.engine.clock(),messageId=message.messageId?`${platform}:${message.channel}:${message.messageId}`:null;
    const accountId=`${platform}:${message.userId}`;
    for(const [id,time] of this.adminMessageIds)if(now-time>=300000)this.adminMessageIds.delete(id);
    if(messageId){
      if(this.adminMessageIds.has(messageId))return true;
      this.adminMessageIds.set(messageId,now);
      while(this.adminMessageIds.size>1000)this.adminMessageIds.delete(this.adminMessageIds.keys().next().value);
    }
    for(const [id,time] of this.adminUserTimes)if(now-time>=2000)this.adminUserTimes.delete(id);
    this.adminStationTimes=this.adminStationTimes.filter(time=>now-time<60000);
    if(this.adminUserTimes.has(accountId)||this.adminStationTimes.length>=30){
      this.recordAdmin(platform,username,command.name,false,'Rate limited: wait 2 seconds between commands; station limit is 30 per minute.');return true;
    }
    this.adminUserTimes.set(accountId,now);this.adminStationTimes.push(now);
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
      this.recordAdmin(platform,username,command.name,true,'Applied');
      // Metadata is best effort after the playback mutation has committed.
      if(['forceskip','previous','add','playnext','playnow'].includes(command.name)){
        try{this.onCatalogChange();}catch{}
      }
    }catch(error){this.recordAdmin(platform,username,command.name,false,error.message||'Command failed');}
    return true;
  }
}
