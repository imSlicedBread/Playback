import crypto from 'node:crypto';
import { DEFAULT_SETTINGS, normalizeSettings, validateSettings } from './config.js';
import { cleanDiscoveredTitle, isPlaceholderTitle } from './title-metadata.js';

const MAX_QUEUE=2000, MAX_HISTORY=300, MAX_SUGGESTIONS=200;
export function parseYoutube(value) {
  if (typeof value !== 'string') throw new Error('Enter a YouTube URL or video ID');
  const s=value.trim();let id=s;
  if (s.includes('/') || s.includes('?')) {
    let u; try {u=new URL(s);}catch{throw new Error('Invalid YouTube URL');}
    const host=u.hostname.toLowerCase().replace(/^www\./,'').replace(/^m\./,'');
    if(host==='youtu.be')id=u.pathname.split('/')[1];
    else if(host==='youtube.com'||host==='youtube-nocookie.com'||host==='music.youtube.com') {
      if(u.pathname==='/watch')id=u.searchParams.get('v');
      else if (/^\/(shorts|live|embed)\//.test(u.pathname)) id=u.pathname.split('/')[2];
    } else throw new Error('Only YouTube URLs are supported');
  }
  if(!/^[a-zA-Z0-9_-]{11}$/.test(id||''))throw new Error('Invalid YouTube video ID');
  return id;
}
function sanitizedTitle(t,id) {
  const value=typeof t==='string'?t.trim():'';
  if(value.length>180 || /[\u0000-\u001F\u007F]/.test(value))throw new Error('Title must have no control characters and at most 180 characters');
  return value||`YouTube · ${id}`;
}
export function normalizeVideo(raw) {
  if(typeof raw==='string')raw={url:raw};
  if(!raw||typeof raw!=='object')throw new Error('Invalid video');
  let candidate=raw.videoId??raw.youtubeId??raw.url??raw.video_url??raw.id;
  const videoId=parseYoutube(String(candidate||''));
  const title=sanitizedTitle(raw.title??raw.name,videoId);
  return { id:typeof raw.id==='string'&&raw.id!==videoId&&raw.id.length<70?raw.id:crypto.randomUUID(), videoId,title,position:0,duration:0,paused:false };
}
const copy = v=>JSON.parse(JSON.stringify(v));
function readOldSettings(raw) {
  const s=raw.settings||{};
  // Old releases used either a nested settings object or direct top-level fields.
  const merged={...s};
  if(raw.loop!==undefined&&merged.loop===undefined)merged.loop=raw.loop;
  if(raw.voteOnEnd!==undefined&&merged.voteOnEnd===undefined)merged.voteOnEnd=raw.voteOnEnd;
  if(s.lowerThirdLayout && !s.lowerThird)merged.lowerThird=s.lowerThirdLayout;
  if(s.palette && !s.colors)merged.colors=s.palette;
  if(typeof merged.lowerThird?.bottomAnchor==='boolean' && !merged.lowerThird.anchor) merged.lowerThird.anchor=merged.lowerThird.bottomAnchor?'bottom':'top';
  if(merged.lowerThird){const {bottomAnchor,...lt}=merged.lowerThird; merged.lowerThird=lt;}
  for(const key of Object.keys(merged))if(!(key in DEFAULT_SETTINGS))delete merged[key];
  try{return validateSettings(merged);}catch{return normalizeSettings({});}
}
function legacyVideo(v) {
  try{return normalizeVideo(v);}catch{return null;}
}
export function migrateState(raw) {
  if(!raw)return {
    schemaVersion:1,revision:1,layoutRevision:1,current:null,queue:[],history:[],vote:null,
    skipBallots:{},suggestions:[],settings:normalizeSettings({}),updatedAt:new Date().toISOString(),generation:1
  };
  if(raw.schemaVersion===1) {
    const next={...migrateState(null),...raw,settings:readOldSettings(raw)};
    next.queue=Array.isArray(next.queue)?next.queue.slice(0,MAX_QUEUE):[];
    next.history=Array.isArray(next.history)?next.history.slice(-MAX_HISTORY):[];
    next.suggestions=Array.isArray(next.suggestions)?next.suggestions.slice(-MAX_SUGGESTIONS):[];
    return next;
  }
  const source=raw.playback||raw;
  const queue=(raw.queue||raw.playlist?.queue||raw.playlist||[]);
  const current=source.current || raw.currentVideo || raw.nowPlaying || null;
  const cur=current?legacyVideo(current):null;
  if(cur){
    const position=source.position??source.currentTime??raw.position??raw.currentTime??current.position??current.currentTime??0;
    cur.position=Number.isFinite(Number(position))?Math.max(0,Number(position)):0;
    const duration=source.duration??current.duration??0;
    cur.duration=Number.isFinite(Number(duration))?Math.max(0,Number(duration)):0;
    cur.paused=Boolean(source.paused??raw.paused??false);
  }
  const historical=(raw.history||[]);
  const state=migrateState(null);
  state.current=cur;
  state.queue=(Array.isArray(queue)?queue:[]).map(legacyVideo).filter(Boolean).slice(0,MAX_QUEUE);
  state.history=(Array.isArray(historical)?historical:[]).map(legacyVideo).filter(Boolean).slice(-MAX_HISTORY);
  state.settings=readOldSettings(raw);
  state.migratedFrom='legacy';
  state.migrationNotice='Prior state backed up; confirm legacy queue and settings in Studio.';
  return state;
}

export class PlaybackEngine {
  constructor(store, {clock=()=>Date.now(), identitySecret='station'}={}) {
    this.store=store;this.clock=clock;this.identitySecret=identitySecret;
    const previous=store?.load?.();
    if(previous && previous.schemaVersion!==1)store?.backupLegacy?.(previous);
    this.state=migrateState(previous);
    this.lastTick=this.clock();
    this.outputAcks=new Map();
    if(!previous||previous.schemaVersion!==1)this.save();
  }
  save(){
    this.state.revision++;this.state.updatedAt=new Date(this.clock()).toISOString();
    try{this.store?.write?.(this.state);}
    catch(e){
      // The authoritative state is the last durable snapshot, never unsaved in-memory changes.
      try{this.state=migrateState(this.store.load());}catch{}
      throw Object.assign(new Error(`Could not persist state: ${e.message}`),{status:503});
    }
  }
  newVideo(url,title) {
    const id=parseYoutube(url);let name=sanitizedTitle(title,id);
    if(isPlaceholderTitle(name,id)){
      const known=[this.state.current,...this.state.queue,...this.state.history,...this.state.suggestions]
        .find(v=>v?.videoId===id&&!isPlaceholderTitle(v.title,id));
      if(known)name=known.title;
    }
    return {id:crypto.randomUUID(),videoId:id,title:name,position:0,duration:0,paused:false};
  }
  get settings(){return this.state.settings;}
  hashViewer(kind,id){return crypto.createHmac('sha256',this.identitySecret).update(`${kind}:${id}`).digest('hex');}
  rotateCurrent() {
    if(!this.state.current)return;
    const c=copy(this.state.current);this.state.history.push(c);this.state.history=this.state.history.slice(-MAX_HISTORY);
    if(this.settings.loop && this.state.queue.length<MAX_QUEUE)this.state.queue.push({...c,position:0,paused:false});
    this.state.current=null;
  }
  activateAt(index=0) {
    if(!this.state.queue.length) {this.state.current=null;this.state.vote=null;this.state.skipBallots={};this.state.generation++;return;}
    const [chosen]=this.state.queue.splice(index,1);
    this.state.current={...chosen,position:0,paused:false};this.state.vote=null;this.state.skipBallots={};this.state.generation++;
  }
  add(url,title,{now=false,front=false}={}) {
    if(this.state.queue.length>=MAX_QUEUE)throw new Error('Queue is full');
    const v=this.newVideo(url,title);
    if(now){this.rotateCurrent();this.state.queue.unshift(v);this.activateAt(0);}
    else{if(front)this.state.queue.unshift(v);else this.state.queue.push(v);if(!this.state.current)this.activateAt(0);}
    this.save();return v;
  }
  bulkAdd(lines){
    if(!Array.isArray(lines)||lines.length>300)throw new Error('Import up to 300 videos at a time');
    const videos=lines.map(line=>{
      if(typeof line==='string') {const [url,...title]=line.split(/\s*\|\s*/);return this.newVideo(url,title.join(' | '));}
      return this.newVideo(line.url||line.videoId,line.title);
    });
    if(this.state.queue.length+videos.length>MAX_QUEUE)throw new Error('Queue capacity exceeded');
    this.state.queue.push(...videos);if(!this.state.current)this.activateAt(0);
    this.save();return videos.length;
  }
  skip(){this.rotateCurrent();this.activateAt();this.save();}
  failVideo(){
    if(!this.state.current||this.state.vote)return;
    this.state.history.push({...this.state.current,unavailable:true});
    this.state.history=this.state.history.slice(-MAX_HISTORY);
    this.state.current=null;this.activateAt();this.save();
  }
  replay(){if(!this.state.current)throw new Error('Nothing to replay');this.state.current.position=0;this.state.current.paused=false;this.state.vote=null;this.state.skipBallots={};this.state.generation++;this.save();}
  previous(){
    const last=this.state.history.pop();if(!last)throw new Error('No previous video');
    if(this.state.current)this.state.queue.unshift({...this.state.current,position:0,paused:false});
    this.state.current={...last,position:0,paused:false};this.state.vote=null;this.state.skipBallots={};this.state.generation++;this.save();
  }
  remove(id) {
    const n=this.state.queue.length;this.state.queue=this.state.queue.filter(v=>v.id!==id);
    if(n===this.state.queue.length)throw new Error('Video not found in queue');
    if(this.state.vote){for(const [key,value] of Object.entries(this.state.vote.ballots)){if(this.state.vote.choices[value]===id)delete this.state.vote.ballots[key];}}
    this.save();
  }
  reorder(id,to){const i=this.state.queue.findIndex(v=>v.id===id);if(i===-1)throw new Error('Video not found');if(!Number.isInteger(to)||to<0||to>=this.state.queue.length)throw new Error('Invalid position');const [v]=this.state.queue.splice(i,1);this.state.queue.splice(to,0,v);this.save();}
  playNow(id){const i=this.state.queue.findIndex(v=>v.id===id);if(i===-1)throw new Error('Video not found');this.rotateCurrent();this.activateAt(this.state.queue.findIndex(v=>v.id===id));this.save();}
  pause(paused){if(!this.state.current||this.state.vote)throw new Error('No playing video');this.state.current.paused=Boolean(paused);this.state.generation++;this.save();}
  seek(position){if(!this.state.current||this.state.vote)throw new Error('No playing video');if(typeof position!=='number'||!Number.isFinite(position)||position<0||position>86400)throw new Error('Invalid seek time');this.state.current.position=this.state.current.duration?Math.min(position,this.state.current.duration):position;this.state.generation++;this.save();}
  applyDiscoveredTitle(videoId,title,{save=true}={}){
    const clean=cleanDiscoveredTitle(title,videoId);
    if(!clean)return false;
    let changed=false;
    for(const item of [this.state.current,...this.state.queue,...this.state.history,...this.state.suggestions]){
      if(item?.videoId===videoId&&isPlaceholderTitle(item.title,videoId)){item.title=clean;changed=true;}
    }
    if(changed&&save)this.save();
    return changed;
  }
  updatePosition(generation,position,duration,title,videoId){
    if(!this.state.current||this.state.vote||generation!==this.state.generation)return false;
    if(typeof position!=='number'||!Number.isFinite(position)||position<0||position>86400)return false;
    let changed=Math.abs(this.state.current.position-position)>0.25;
    this.state.current.position=position;
    if(typeof duration==='number'&&Number.isFinite(duration)&&duration>=0&&duration<=86400){if(Math.abs((this.state.current.duration||0)-duration)>0.2)changed=true;this.state.current.duration=duration;}
    // The title must belong to the current generation AND the matching video ID.
    if(videoId===this.state.current.videoId && this.applyDiscoveredTitle(videoId,title,{save:false}))changed=true;
    if(changed)this.save();return true;
  }
  startVote({automatic=false}={}){
    if(!this.state.current||this.state.vote)throw new Error('Voting requires an active video and no existing round');
    const choices=this.state.queue.slice(0,4).map(v=>v.id);
    if(!choices.length)throw new Error('Add a queued video to start voting');
    const wasPaused=this.state.current.paused;this.state.current.paused=true;
    this.state.vote={id:crypto.randomUUID(),choices,remaining:this.settings.voteSeconds,ballots:{},manual:!automatic,wasPaused};
    this.save();
  }
  cancelVote(){
    if(!this.state.vote)throw new Error('No active vote');
    const {manual,wasPaused}=this.state.vote;this.state.vote=null;
    if(this.state.current){this.state.current.paused=manual?wasPaused:false;if(!manual)this.state.current.position=0;}
    this.state.generation++;this.save();
  }
  ended(generation){
    if(!this.state.current||this.state.vote||generation!==this.state.generation)return false;
    if(this.settings.voteOnEnd&&this.state.queue.length)this.startVote({automatic:true});
    else {this.rotateCurrent();this.activateAt();this.save();}
    return true;
  }
  voteChoice(index,viewerHash){
    if(!this.state.vote)throw new Error('No active voting round');
    if(!Number.isInteger(index)||index<1||index>4)throw new Error('Vote must be 1-4');
    const id=this.state.vote.choices[index-1];
    if(!id||!this.state.queue.some(v=>v.id===id))throw new Error('Choice is unavailable');
    if(!(viewerHash in this.state.vote.ballots)&&Object.keys(this.state.vote.ballots).length>=20000)throw new Error('Voting capacity reached');
    this.state.vote.ballots[viewerHash]=index-1;
    this.save();return this.getVotes();
  }
  getVotes(){
    const counts=[0,0,0,0];const v=this.state.vote;
    if(v)for(const choice of Object.values(v.ballots)){if(Number.isInteger(choice)&&v.choices[choice]&&this.state.queue.some(q=>q.id===v.choices[choice]))counts[choice]++;}
    return counts;
  }
  choose(index){
    if(!this.state.vote)throw new Error('No active vote');
    if(!Number.isInteger(index)||index<1||index>4)throw new Error('Invalid choice');
    const id=this.state.vote.choices[index-1];const position=this.state.queue.findIndex(v=>v.id===id);
    if(position<0)throw new Error('Choice is unavailable');
    this.rotateCurrent();this.activateAt(this.state.queue.findIndex(v=>v.id===id));this.save();
  }
  conclude(){
    const vote=this.state.vote;if(!vote)return;
    const counts=this.getVotes();let win=-1,highest=-1;
    for(let i=0;i<4;i++){if(vote.choices[i]&&this.state.queue.some(v=>v.id===vote.choices[i])&&counts[i]>highest){win=i;highest=counts[i];}}
    if(win>=0){const id=vote.choices[win];this.rotateCurrent();this.activateAt(this.state.queue.findIndex(v=>v.id===id));}
    else{this.rotateCurrent();this.activateAt();}
    this.save();
  }
  tick(){
    const now=this.clock();let seconds=Math.floor((now-this.lastTick)/1000);
    if(seconds<=0)return;
    this.lastTick+=seconds*1000;
    if(this.state.vote){this.state.vote.remaining=Math.max(0,this.state.vote.remaining-seconds);if(this.state.vote.remaining<=0)this.conclude();else this.save();}
  }
  skipVote(viewerHash){
    if(!this.settings.skipVoting||!this.state.current||this.state.vote)throw new Error('Skip voting unavailable');
    if(!(viewerHash in this.state.skipBallots)&&Object.keys(this.state.skipBallots).length>=20000)throw new Error('Voting capacity reached');
    this.state.skipBallots[viewerHash]=true;const count=Object.keys(this.state.skipBallots).length;
    if(count>=this.settings.skipThreshold)this.skip();else this.save();return count;
  }
  suggest(url,title,viewerHash){
    if(!this.settings.allowSuggestions)throw new Error('Suggestions disabled');
    if(this.state.suggestions.length>=MAX_SUGGESTIONS)throw new Error('Suggestion inbox is full');
    if(this.state.suggestions.filter(s=>s.viewer===viewerHash).length>=3)throw new Error('Suggestion limit reached');
    const v=this.newVideo(url,title);
    this.state.suggestions.push({...v,viewer:viewerHash,createdAt:this.clock()});this.save();return v.id;
  }
  moderate(id,approved){
    const i=this.state.suggestions.findIndex(v=>v.id===id);if(i<0)throw new Error('Suggestion not found');
    if(approved && this.state.queue.length>=MAX_QUEUE)throw new Error('Queue full');
    const [v]=this.state.suggestions.splice(i,1);
    if(approved){this.state.queue.push({id:v.id,videoId:v.videoId,title:v.title,position:0,duration:0,paused:false});if(!this.state.current)this.activateAt();}
    this.save();
  }
  saveSettings(input){
    const settings=validateSettings(input);
    const changedTwitch=settings.twitchChannel!==this.settings.twitchChannel||settings.twitchMode!==this.settings.twitchMode;
    this.state.settings=settings;this.state.layoutRevision++;this.save();return {changedTwitch};
  }
  outputAck(id,layoutRevision,flags={}){this.outputAcks.set(id,{id,layoutRevision,clean:Boolean(flags.clean),timestamp:this.clock()});}
  getOutputStatus(){const now=this.clock();return [...this.outputAcks.values()].filter(x=>now-x.timestamp<16000);}
  publicState(){
    const s=this.state;const vote=s.vote?{
      id:s.vote.id,remaining:s.vote.remaining,counts:this.getVotes(),
      choices:s.vote.choices.map(id=>s.queue.find(v=>v.id===id)||null).map(v=>v&&{id:v.id,videoId:v.videoId,title:v.title})
    }:null;
    return {revision:s.revision,layoutRevision:s.layoutRevision,generation:s.generation,
      current:s.current?{...s.current}:null,queue:s.queue.map(v=>({id:v.id,videoId:v.videoId,title:v.title,duration:v.duration||0})),
      vote,skipCount:Object.keys(s.skipBallots).length,settings:copy(s.settings)};
  }
  operatorState(){return {...this.publicState(),history:copy(this.state.history.slice(-30)),suggestions:this.state.suggestions.map(({viewer,...s})=>s),outputs:this.getOutputStatus(),migrationNotice:this.state.migrationNotice||null};}
}