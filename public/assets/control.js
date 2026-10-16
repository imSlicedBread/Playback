import {$,e,api,thumbnail,formatTime,showNotice,applyTheme,initAuth} from './common.js';
let state=null,busy=false,scrubbing=false,scrubVideoId=null;
let audioDesired=null,audioPreview=null,audioSending=false,audioTimer=null,audioEditing=false,lastAudibleVolume=50,lastAudioSend=0;
async function action(action,props={}){
  if(busy)return;busy=true;
  try{await api('control',{method:'POST',data:{action,...props}});showNotice('controlMessage','Saved','success');await refresh();}
  catch(err){showNotice('controlMessage',err.message,'error');if(err.status===401)$('auth').classList.remove('hidden');}
  finally{busy=false;}
}
function paintSeek(position,duration){
  const slider=$('seekSlider');
  const max=Number.isFinite(duration)&&duration>0?duration:0;
  const seconds=Math.max(0,Math.min(Number.isFinite(position)?position:0,max||86400));
  if(max>0){
    slider.max=String(max);
    slider.value=String(Math.min(seconds,max));
    slider.style.setProperty('--seek-fill',`${(Math.min(seconds,max)/max*100).toFixed(2)}%`);
    slider.setAttribute('aria-valuetext',`${formatTime(seconds)} of ${formatTime(max)}`);
  }else{
    slider.max='1';slider.value='0';slider.style.setProperty('--seek-fill','0%');
    slider.setAttribute('aria-valuetext','Video duration unavailable');
  }
  $('seekCurrent').textContent=formatTime(seconds);
  $('seekTotal').textContent=formatTime(max||Number.NaN);
}
function currentAudio(){return audioPreview||state?.audio||{volume:100,muted:false};}
function paintAudio(audio){
  const volume=audio.volume;
  $('volumeSlider').value=String(volume);
  $('volumeSlider').style.setProperty('--volume-fill',`${audio.muted?0:volume}%`);
  $('volumeSlider').setAttribute('aria-valuetext',`${volume} percent${audio.muted?', muted':''}`);
  $('volumePercent').textContent=`${volume}%${audio.muted?' · MUTED':''}`;
  $('muteToggle').textContent=audio.muted?'Unmute':'Mute';
  $('muteToggle').setAttribute('aria-pressed',String(audio.muted));
  $('muteToggle').setAttribute('aria-label',audio.muted?'Unmute YouTube audio':'Mute YouTube audio');
  if(volume>0)lastAudibleVolume=volume;
}
async function flushAudio(){
  clearTimeout(audioTimer);audioTimer=null;
  if(audioSending||!audioDesired)return;
  const audio=audioDesired;audioDesired=null;audioSending=true;lastAudioSend=Date.now();
  try{await api('control',{method:'POST',data:{action:'audio',...audio}});}
  catch(err){audioDesired=null;showNotice('controlMessage',err.message,'error');if(err.status===401)$('auth').classList.remove('hidden');}
  finally{
    audioSending=false;
    if(audioDesired)scheduleAudio();
    else {audioEditing=false;audioPreview=null;await refresh();}
  }
}
function scheduleAudio({immediate=false}={}){
  clearTimeout(audioTimer);
  // Limit disk writes/API requests while keeping long slider drags responsive.
  // Final changes are committed immediately when the pointer is released.
  const delay=immediate?0:Math.max(0,450-(Date.now()-lastAudioSend));
  audioTimer=setTimeout(()=>void flushAudio(),delay);
}
function queueAudio(audio,{immediate=false}={}){
  audioDesired=audio;
  audioPreview=audio;
  audioEditing=true;
  paintAudio(audio);
  scheduleAudio({immediate});
}
function drawNow(s){
  const c=s.current,el=$('now');
  if(scrubVideoId!==null && (c?.id||null)!==scrubVideoId){
    scrubbing=false;scrubVideoId=null;
  }
  el.replaceChildren();$('nowId').textContent=c?.videoId||'NO VIDEO';
  $('pause').textContent=c?.paused?'▶ Resume':'Ⅱ Pause';$('pause').disabled=!c||Boolean(s.vote);
  $('skip').disabled=!c;$('replay').disabled=!c;$('back').disabled=!s.history.length;
  $('seek').disabled=!c||Boolean(s.vote);
  const knownDuration=Number.isFinite(c?.duration)&&c.duration>0;
  $('seekSlider').disabled=!c||Boolean(s.vote)||!knownDuration;
  $('seekHint').textContent=!c?'Start a video to enable seeking.':s.vote?'Seeking is unavailable during voting.':!knownDuration?'Waiting for video duration. Use the seconds field for precise seeks.':'Drag to seek, click a position, or use arrow keys.';
  if(!scrubbing)paintSeek(c?.position||0,c?.duration||0);
  if(!c){el.append(e('div',{class:'empty',text:'No active video. Add videos to begin.'}));return;}
  const img=e('img',{class:'thumb'});img.src=thumbnail(c.videoId);img.alt='Video thumbnail';
  const copy=e('div',{class:'now-copy'},e('div',{class:'eyebrow',text:s.vote?'END SCREEN VOTE':(c.paused?'PAUSED':'PLAYING')}),e('h2',{text:c.title}));
  el.append(img,copy);
}
function makeQueueRow(v,i){
  const img=e('img');img.alt='';img.src=thumbnail(v.videoId);
  const actions=e('div',{class:'queue-actions'});
  actions.append(
    e('button',{class:'small',text:'Play',onClick:()=>action('playNow',{id:v.id})}),
    e('button',{class:'small',text:'↑',disabled:i===0,onClick:()=>action('reorder',{id:v.id,to:i-1})}),
    e('button',{class:'small',text:'↓',disabled:i===state.queue.length-1,onClick:()=>action('reorder',{id:v.id,to:i+1})}),
    e('button',{class:'small danger',text:'×',title:'Remove',onClick:()=>action('remove',{id:v.id})})
  );
  return e('div',{class:'queue-item'},img,e('div',{},e('strong',{text:v.title}),e('span',{text:v.videoId})),actions);
}
function drawQueue(s){
  $('queueCount').textContent=`${s.queue.length} IN QUEUE`;
  const container=$('queue');container.replaceChildren(...s.queue.map(makeQueueRow));
  if(!s.queue.length)container.append(e('div',{class:'empty',text:'The queue is empty.'}));
}
function drawVote(s){
  $('countdown').textContent=s.vote?`${s.vote.remaining}s REMAINING`:'INACTIVE';
  $('startVote').disabled=Boolean(s.vote)||!s.current||!s.queue.length;
  $('cancelVote').disabled=!s.vote;
  const container=$('voteSummary');container.replaceChildren();
  for(let i=0;i<4;i++){
    const c=s.vote?.choices?.[i];const div=e('div',{class:'vote-mini'},e('strong',{text:`${i+1}: ${s.vote?.counts?.[i]||0}`}),e('div',{text:c?.title||'Empty'}));
    if(c){div.style.cursor='pointer';div.tabIndex=0;div.setAttribute('role','button');div.title='Choose this video immediately';div.addEventListener('click',()=>action('choose',{choice:i+1}));div.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();action('choose',{choice:i+1});}});}
    container.append(div);
  }
}
function drawSuggestions(s){
  const container=$('suggestions');container.replaceChildren();$('suggestCount').textContent=`${s.suggestions.length} PENDING`;
  for(const v of s.suggestions){
    container.append(e('div',{class:'queue-item'},e('div',{},e('strong',{text:'REQUEST'})),e('div',{},e('strong',{text:v.title}),e('span',{text:v.videoId})),e('div',{class:'queue-actions'},
      e('button',{class:'small primary',text:'Approve',onClick:()=>action('moderate',{id:v.id,approved:true})}),e('button',{class:'small',text:'Reject',onClick:()=>action('moderate',{id:v.id,approved:false})}))));
  }
  if(!s.suggestions.length)container.append(e('div',{class:'small-note',text:'No pending suggestions.'}));
}
async function refresh(){
  try{
    const s=await api('operator');state=s;applyTheme(s.settings.colors);
    drawNow(s);drawQueue(s);drawVote(s);drawSuggestions(s);
    if(!audioEditing&&!audioSending&&!audioDesired)paintAudio(s.audio||{volume:100,muted:false});
    $('workerDot').className='dot'+(s.workerActive?' ok':'');$('workerStatus').textContent=s.workerActive?'OBS player connected':'Output unavailable';
    $('duration').textContent=formatTime(s.current?.duration||Number.NaN);
    $('skipVotes').textContent=`${s.skipCount} / ${s.settings.skipThreshold}`;
    $('twitchStatus').textContent=s.twitch.state;
    $('migration').textContent=s.migrationNotice||'';
  }catch(err){if(err.status===401)$('auth').classList.remove('hidden');}
}
$('pause').addEventListener('click',()=>action(state?.current?.paused?'play':'pause'));
$('skip').addEventListener('click',()=>action('skip'));
$('startVote').addEventListener('click',()=>action('startVote'));
$('cancelVote').addEventListener('click',()=>action('cancelVote'));
$('back').addEventListener('click',()=>action('previous'));
$('replay').addEventListener('click',()=>action('replay'));
$('seek').addEventListener('click',()=>{
  const raw=$('seekValue').value.trim(),position=Number(raw);
  if(!raw||!Number.isFinite(position)||position<0){showNotice('controlMessage','Enter a valid seek position in seconds.','error');return;}
  action('seek',{position});
});
// Keep the range input outside drawNow() so the 1.3s state refresh never
// destroys an active pointer or keyboard interaction.
$('seekSlider').addEventListener('pointerdown',()=>{
  if(!state?.current||state.vote)return;
  scrubbing=true;scrubVideoId=state.current.id;
});
$('seekSlider').addEventListener('input',()=>{
  if(!state?.current||state.vote)return;
  scrubbing=true;scrubVideoId=state.current.id;
  const slider=$('seekSlider'),seconds=Number(slider.value),duration=Number(slider.max);
  paintSeek(seconds,duration);
  $('seekValue').value=String(Math.floor(seconds));
});
$('seekSlider').addEventListener('change',async()=>{
  const c=state?.current,slider=$('seekSlider');
  if(!c||state.vote||slider.disabled||c.id!==scrubVideoId){scrubbing=false;scrubVideoId=null;await refresh();return;}
  const position=Number(slider.value);
  try{await action('seek',{position});}
  finally{scrubbing=false;scrubVideoId=null;await refresh();}
});
$('seekSlider').addEventListener('pointercancel',()=>{scrubbing=false;scrubVideoId=null;refresh();});
// Keep the slider node stable; polling must not snap an in-progress drag back.
$('volumeSlider').addEventListener('input',()=>{
  const volume=Math.round(Number($('volumeSlider').value));
  queueAudio({volume,muted:volume===0});
});
$('volumeSlider').addEventListener('change',()=>{if(audioDesired)scheduleAudio({immediate:true});});
$('muteToggle').addEventListener('click',()=>{
  const audio=currentAudio();
  const muted=!audio.muted;
  const volume=!muted&&audio.volume===0?lastAudibleVolume:audio.volume;
  queueAudio({volume,muted},{immediate:true});
});
$('addForm').addEventListener('submit',ev=>{ev.preventDefault();action('add',{url:$('newUrl').value,title:$('newTitle').value});});
$('playNew').addEventListener('click',()=>action('add',{url:$('newUrl').value,title:$('newTitle').value,now:true}));
$('bulkAdd').addEventListener('click',()=>action('bulk',{lines:$('bulk').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)}));
await initAuth(refresh);
setInterval(()=>{if($('auth').classList.contains('hidden'))refresh();},1300);