import {$,api,applyTheme,formatTime,applyLowerThird,setTicker} from './common.js?v=1.5.1';
import {renderVoteScreen} from './vote-screen.js';
import {applyYouTubeAudio} from './youtube-audio.js';
const clean=new URL(location.href).searchParams.get('clean')==='1';
const hud=$('hud'),voteMount=$('voteMount');
let data=null,player=null,ytReady=false,appliedGen=-1,lastAudioKey='',workerId=null,lastClaim=0,lastAck=0,visibleVote='',reportedEndGen=-1,reportedErrorGen=-1;
try{workerId=sessionStorage.getItem('playback-worker-id');}catch{}
if(!/^[0-9a-f-]{36}$/i.test(workerId||''))workerId=crypto.randomUUID();
try{sessionStorage.setItem('playback-worker-id',workerId);}catch{}
let isWorker=false;
let lastLoad=0,apiScript=null,playerStarted=0,playerEpoch=0;
function hide(el,yes){el.classList.toggle('hidden',yes);}
async function claim(){
  if(isWorker||Date.now()-lastClaim<3500)return;
  lastClaim=Date.now();
  try{const result=await api('worker/claim',{method:'POST',data:{workerId}});workerId=result.workerId;isWorker=true;lastAck=0;}
  catch{isWorker=false;}
}
async function asWorker(type,fields={}){
  if(!isWorker)return null;
  try{return await api(`worker/${type}`,{method:'POST',data:{workerId,...fields}});}
  catch(e){if(e.status===409||e.status===403)isWorker=false;return null;}
}
function concealCaptions(){
  if(!data?.settings.hideCaptions||!player)return;
  try{player.setOption('captions','track',{});}catch{}
  try{player.unloadModule('captions');}catch{}
  try{player.unloadModule('cc');}catch{}
}
function updateHud(s,{refreshTicker=false}={}){
  applyLowerThird(hud,s.settings.lowerThird);
  $('hudChannel').textContent=s.settings.channelLabel||'fKey Playback';
  $('hudDuration').textContent=`DURATION ${formatTime(s.current?.duration||NaN)}`;
  $('hudSkip').textContent=`SKIP ${s.skipCount}/${s.settings.skipThreshold}`;
  const title=s.current?.title||'';
  const wasHidden=hud.classList.contains('hidden');
  hide(hud,clean||!s.settings.showLowerThird||!s.current||Boolean(s.vote));
  if(refreshTicker||(wasHidden&&!hud.classList.contains('hidden'))||hud.dataset.title!==title||hud.dataset.width!==String(s.settings.lowerThird.width)||hud.dataset.scroll!==String(s.settings.scrollTitles)||hud.dataset.layoutRevision!==String(s.layoutRevision)){
    hud.dataset.title=title;hud.dataset.width=String(s.settings.lowerThird.width);hud.dataset.scroll=String(s.settings.scrollTitles);hud.dataset.layoutRevision=String(s.layoutRevision);
    setTicker($('hudTitle'),title,s.settings.scrollTitles);
  }
}
function updateVote(s){
  const currentKey=s.vote?`${s.vote.id}:${s.vote.remaining}:${(s.vote.counts||[]).join(',')}:${s.layoutRevision}`:'none';
  if(currentKey===visibleVote)return;
  visibleVote=currentKey;
  if(!s.vote){voteMount.replaceChildren();hide(voteMount,true);return;}
  renderVoteScreen(voteMount,s.vote,s.settings);
  hide(voteMount,false);
}
function syncAudio(s,{force=false}={}){
  if(!player||!ytReady)return;
  const audio=s.audio||{volume:100,muted:false};
  const key=`${audio.volume}:${audio.muted}`;
  if((force||key!==lastAudioKey)&&applyYouTubeAudio(player,audio))lastAudioKey=key;
}
function applyPlayback(s){
  if(!player||!ytReady)return;
  const c=s.current;
  const newGeneration=appliedGen!==s.generation;
  syncAudio(s,{force:newGeneration});
  if(!c){
    if(appliedGen!==s.generation){try{player.stopVideo();}catch{}}appliedGen=s.generation;return;
  }
  if(appliedGen!==s.generation){
    try{const config={videoId:c.videoId,startSeconds:Math.max(0,c.position||0)};
      if(c.paused||s.vote)player.cueVideoById(config);else player.loadVideoById(config);
      appliedGen=s.generation;lastLoad=Date.now();reportedEndGen=-1;reportedErrorGen=-1;
      concealCaptions();
    }catch{}
  } else if(s.vote||c.paused){
    try{if(player.getPlayerState()===1)player.pauseVideo();}catch{}
  } else {
    try{
      const state=player.getPlayerState();
      if(state===-1||state===2||state===5)player.playVideo();
      // An iframe can remain unstarted after boot-time network failure. Retry
      // the saved video without advancing the queue or resetting its position.
      if((state===-1||state===5)&&Date.now()-lastLoad>=15000){
        player.loadVideoById({videoId:c.videoId,startSeconds:Math.max(0,c.position||0)});lastLoad=Date.now();
      }
    }catch{}
  }
}
async function poll(){
  try{
    const s=await api('public?compact=1');data=s;applyTheme(s.settings.colors);
    updateHud(s);updateVote(s);
    hide($('waiting'),!!s.current||!!s.vote);
    if(ytReady)applyPlayback(s);
    await claim();
    if(isWorker&&Date.now()-lastAck>7800){lastAck=Date.now();await asWorker('layout-ack',{layoutRevision:s.layoutRevision,clean});}
  }catch{}
}
setInterval(poll,1100);poll();
setInterval(async()=>{
  if(!player||!ytReady||!data||!isWorker)return;
  await claim();
  if(!data.current||data.vote)return;
  try{
    // An unready or previous iframe must not overwrite saved resume progress.
    if(appliedGen!==data.generation||![1,2].includes(player.getPlayerState())||player.getVideoData?.().video_id!==data.current.videoId)return;
    const position=player.getCurrentTime(),duration=player.getDuration();
    // getVideoData() supplies metadata once YouTube has loaded it, without
    // depending on the oEmbed service or requiring a YouTube API key.
    let title=null,videoId=null;
    try{const metadata=player.getVideoData?.();
      if(metadata?.video_id===data.current.videoId){title=metadata.title;videoId=metadata.video_id;}
    }catch{}
    if(Number.isFinite(position)&&position>=0)await asWorker('progress',{generation:data.generation,position,duration:Number.isFinite(duration)?duration:0,title,videoId});
  }catch{}
},2000);
window.onYouTubeIframeAPIReady=()=>{
  if(!window.YT?.Player||player)return;
  const epoch=++playerEpoch;
  playerStarted=Date.now();
  player=new YT.Player('ytMount',{
    height:'100%',width:'100%',host:'https://www.youtube-nocookie.com',
    playerVars:{autoplay:1,controls:0,playsinline:1,enablejsapi:1,cc_load_policy:0,iv_load_policy:3,rel:0,origin:location.origin},
    events:{onReady:()=>{if(epoch!==playerEpoch)return;ytReady=true;poll();},onStateChange:ev=>{
      if(epoch!==playerEpoch||!ytReady)return;
      if(ev.data===window.YT.PlayerState.PLAYING){concealCaptions();if(data)syncAudio(data,{force:true});}
      if(ev.data===window.YT.PlayerState.ENDED && data?.current && !data.vote && reportedEndGen!==data.generation){
        reportedEndGen=data.generation;asWorker('ended',{generation:data.generation}).then(r=>{if(r?.accepted)poll();});
      }
    },onApiChange:()=>{if(epoch===playerEpoch)concealCaptions();},onError:ev=>{
      if(epoch!==playerEpoch)return;
      // HTML5 startup failure is a player failure, not proof that this video
      // is unavailable. Rebuild after the readiness timeout without skipping.
      if(ev.data===5){ytReady=false;playerStarted=Date.now();return;}
      if(!data?.current||data.vote||reportedErrorGen===data.generation)return;
      reportedErrorGen=data.generation;asWorker('error',{generation:data.generation}).then(()=>poll());
    }}
  });
};
window.addEventListener('resize',()=>{if(data)updateHud(data,{refreshTicker:true});});

function ensureYouTube(){
  if(ytReady)return;
  if(player){
    if(Date.now()-playerStarted<30000)return;
    playerEpoch++;
    try{player.destroy();}catch{}
    player=null;appliedGen=-1;lastAudioKey='';
    const mount=document.createElement('div');mount.id='ytMount';mount.className='yt-frame';
    const old=$('ytMount');if(old)old.replaceWith(mount);else $('stage').prepend(mount);
  }
  if(window.YT?.Player){try{window.onYouTubeIframeAPIReady();}catch{player=null;}return;}
  apiScript?.remove();
  apiScript=document.createElement('script');apiScript.src='https://www.youtube.com/iframe_api';apiScript.async=true;
  document.head.append(apiScript);
}
setInterval(ensureYouTube,15000);
window.addEventListener('online',ensureYouTube);
ensureYouTube();
