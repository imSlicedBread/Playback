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
const queueLanes={playNext:'priorityQueue',current:'upcomingQueue',recycled:'recycledQueue',nextRotation:'nextRotationQueue'};
let activeQueueLane='current';
const queueSelection=new Set();
function currentLaneVideos(s=state){return s?.[queueLanes[activeQueueLane]]||[];}
function updateBulkMove(){
  const all=currentLaneVideos(),visible=new Set(all.map(v=>v.id));
  $('queueMoveSelected').disabled=![...queueSelection].some(id=>visible.has(id));
  $('queueSelectAll').checked=all.length>0&&all.every(v=>queueSelection.has(v.id));
}
// Polling updates metadata every 1.3s. Queue rows must retain their actual DOM
// nodes: replacing an open native <select> closes its popup before a user can
// choose a destination. Key each row by the durable queue-entry ID instead.
const queueRows=new Map();
function makeQueueRow(v,i,lane,list){
  // Action handlers refer to the latest snapshot, not the stale video/index from
  // the moment the row was first built. This also preserves correct reordering
  // when another video moves while the user is looking at this row.
  const view={video:v,index:i,lane,total:list.length};
  const img=e('img');img.alt='';img.src=thumbnail(v.videoId);
  const selected=e('input',{type:'checkbox',class:'queue-select',title:'Select video for bulk move'});
  selected.addEventListener('change',()=>{
    if(selected.checked)queueSelection.add(view.video.id);
    else queueSelection.delete(view.video.id);
    updateBulkMove();
  });
  const title=e('strong');
  const videoId=e('span');
  const playHistory=e('small',{class:'small-note'});
  const info=e('div',{},title,videoId,playHistory);
  const actions=e('div',{class:'queue-actions'});
  const moveTo=(destination)=>action('move',{id:view.video.id,destination});
  const target=e('select',{class:'queue-move-select',title:'Move to rotation lane', 'aria-label':'Choose rotation lane'},
    ...[['current','Current'],['nextRotation','Next rotation'],['recycled','Recycle']].map(([value,label])=>e('option',{value,text:label})));
  const play=e('button',{class:'small',text:'Play',title:'Play now, resume interrupted video next',onClick:()=>action('playNow',{id:view.video.id})});
  const playNext=e('button',{class:'small',text:'Play Next',onClick:()=>moveTo('playNext')});
  const move=e('button',{class:'small',text:'Move',onClick:()=>moveTo(target.value)});
  const previous=e('button',{class:'small',text:'↑',onClick:()=>action('reorder',{id:view.video.id,to:view.index-1})});
  const next=e('button',{class:'small',text:'↓',onClick:()=>action('reorder',{id:view.video.id,to:view.index+1})});
  const remove=e('button',{class:'small danger',text:'×',title:'Remove from all rotations',onClick:()=>action('remove',{id:view.video.id})});
  actions.append(play,playNext,target,move,previous,next,remove);
  const element=e('div',{class:'queue-item smart-queue-item'},selected,img,info,actions);
  const update=(video,index,nextLane,total)=>{
    view.video=video;view.index=index;view.lane=nextLane;view.total=total;
    selected.checked=queueSelection.has(video.id);
    if(img.dataset.videoId!==video.videoId){img.src=thumbnail(video.videoId);img.dataset.videoId=video.videoId;}
    if(title.textContent!==video.title)title.textContent=video.title;
    if(videoId.textContent!==video.videoId)videoId.textContent=video.videoId;
    const history=`Plays ${video.playCount||0}${video.lastPlayedRotation?` · Last rotation ${video.lastPlayedRotation}`:''}`;
    if(playHistory.textContent!==history)playHistory.textContent=history;
    playNext.disabled=nextLane==='playNext';
    previous.disabled=index===0;
    next.disabled=index===total-1;
    // IMPORTANT: Do not reset target.value on ordinary live polls. Its value
    // may be a destination the user chose but has not clicked Move for yet.
    if(target.dataset.sourceLane!==nextLane){
      target.value=nextLane==='playNext'?'current':nextLane;
      target.dataset.sourceLane=nextLane;
    }
  };
  update(v,i,lane,list.length);
  return {element,update};
}
function drawQueue(s){
  const counts=s.rotationCounts||{playNext:0,upcoming:s.queue?.length||0,recycled:0,nextRotation:0};
  const playable=(counts.playNext||0)+(counts.upcoming||0);
  $('queueCount').textContent=`${playable} AVAILABLE`;
  $('rotationNumber').textContent=`ROTATION ${s.rotationNumber||1}`;
  $('rotationSummary').textContent=`${counts.playNext} priority · ${counts.upcoming} upcoming · ${counts.recycled} recycled · ${counts.nextRotation} deferred`;
  for(const [lane,count] of Object.entries({playNext:counts.playNext,current:counts.upcoming,recycled:counts.recycled,nextRotation:counts.nextRotation})){
    document.querySelector(`[data-count="${lane}"]`).textContent=count||0;
  }
  for(const tab of document.querySelectorAll('[data-queue-lane]')){
    const active=tab.dataset.queueLane===activeQueueLane;
    tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));
  }
  const list=currentLaneVideos(s),container=$('queue');
  const visible=new Set(list.map(v=>v.id));
  for(const [id,row] of queueRows){
    if(!visible.has(id)){row.element.remove();queueRows.delete(id);}
  }
  if(!list.length){
    const msg=activeQueueLane==='recycled'?'No completed videos in this rotation.':activeQueueLane==='nextRotation'?'Nothing deferred to the next rotation.':'No videos in this lane.';
    if(!container.firstElementChild?.classList.contains('empty')||container.childElementCount!==1){
      container.replaceChildren(e('div',{class:'empty',text:msg}));
    }else if(container.firstElementChild.textContent!==msg){container.firstElementChild.textContent=msg;}
  }else{
    container.querySelector(':scope > .empty')?.remove();
    for(const [index,video] of list.entries()){
      let row=queueRows.get(video.id);
      if(!row){row=makeQueueRow(video,index,activeQueueLane,list);queueRows.set(video.id,row);}
      else row.update(video,index,activeQueueLane,list.length);
      // Moving an already-positioned node would also collapse a native select
      // popup. Only insert when the list's actual order has changed.
      if(container.children[index]!==row.element){
        container.insertBefore(row.element,container.children[index]||null);
      }
    }
  }
  $('queueHelp').textContent=activeQueueLane==='recycled'?'Recycled videos return automatically after the current Upcoming queue is exhausted.':activeQueueLane==='nextRotation'?'These videos join Upcoming at the start of the next rotation.': 'Play Next overrides normal Upcoming order; already played videos stay in Recycled.';
  updateBulkMove();
}
for(const tab of document.querySelectorAll('[data-queue-lane]'))tab.addEventListener('click',()=>{
  activeQueueLane=tab.dataset.queueLane;queueSelection.clear();drawQueue(state);
});
$('queueSelectAll').addEventListener('change',()=>{
  for(const v of currentLaneVideos())if($('queueSelectAll').checked)queueSelection.add(v.id);else queueSelection.delete(v.id);
  drawQueue(state);
});
$('queueMoveSelected').addEventListener('click',async()=>{
  const ids=currentLaneVideos().filter(v=>queueSelection.has(v.id)).map(v=>v.id);
  if(!ids.length)return;
  await action('moveMany',{ids,destination:$('queueMoveTarget').value});queueSelection.clear();drawQueue(state);
});
$('queueApplySort').addEventListener('click',()=>action('sortUpcoming',{order:$('queueSort').value}));
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
$('addForm').addEventListener('submit',ev=>{ev.preventDefault();action('add',{url:$('newUrl').value,title:$('newTitle').value,destination:$('addDestination').value});});
$('playNew').addEventListener('click',()=>action('add',{url:$('newUrl').value,title:$('newTitle').value,now:true}));
$('bulkAdd').addEventListener('click',()=>action('bulk',{lines:$('bulk').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),destination:$('addDestination').value}));
// Extract playlist metadata first; only import the checked entries on confirmation.
// Preview is not part of drawNow() or refresh(): live polling must preserve selection.
let playlistPreview=null,playlistBusy=false;
function previewSelection(){
  const selected=[...$('playlistVideos').querySelectorAll('input[type="checkbox"]:checked')];
  $('playlistSelected').textContent=`${selected.length} of ${playlistPreview?.videos.length||0} selected`;
  $('playlistImportButton').disabled=playlistBusy||!selected.length;
  $('playlistCopyLinks').disabled=playlistBusy||!selected.length;
  $('playlistExportCsv').disabled=playlistBusy||!selected.length;
  return selected.map(input=>Number(input.dataset.index));
}
function setPlaylistBusy(value){
  playlistBusy=value;
  $('playlistExtractButton').disabled=value;
  $('playlistImportButton').disabled=value||!previewSelection().length;
  $('playlistNextButton').disabled=value;
  $('playlistSelectAll').disabled=value;
  $('playlistSelectNone').disabled=value;
}
function clearPlaylistImporter(){
  // A completed import should leave the screen ready for another playlist.
  // Keep destination/order/duplicate preferences, and keep the success notice.
  playlistPreview=null;
  $('playlistPreview').classList.add('hidden');
  $('playlistVideos').replaceChildren();
  $('playlistName').textContent='';
  $('playlistCount').textContent='';
  $('playlistSelected').textContent='0 of 0 selected';
  $('playlistNextButton').classList.add('hidden');
  $('playlistUrl').value='';
  $('playlistStart').value='1';
  $('playlistUrl').focus();
}
function renderPlaylistPreview(result){
  playlistPreview=result;
  $('playlistPreview').classList.remove('hidden');
  $('playlistName').textContent=result.title;
  $('playlistCount').textContent=`${result.videos.length} available · ${result.unavailable} unavailable/skipped · positions ${result.start}–${result.start+result.limit-1}${Number.isInteger(result.total)?` · ${result.total} playlist entries`:''}`;
  $('playlistVideos').replaceChildren();
  const existing=new Set([state?.current?.videoId,...(state?.queue||[]).map(v=>v.videoId),...(state?.recycledQueue||[]).map(v=>v.videoId),...(state?.nextRotationQueue||[]).map(v=>v.videoId)]);
  const rows=document.createDocumentFragment();
  result.videos.forEach((video,index)=>{
    const checkbox=e('input',{type:'checkbox'});
    checkbox.checked=true;checkbox.dataset.index=String(index);
    const image=e('img');image.src=thumbnail(video.videoId);image.alt='';image.loading='lazy';
    const label=e('label',{class:'playlist-video-row'},checkbox,image,e('span',{text:video.title,title:video.title}),e('small',{text:`#${video.position}${existing.has(video.videoId)?' · already queued':''}`}));
    rows.append(label);
  });
  $('playlistVideos').append(rows);
  $('playlistNextButton').classList.toggle('hidden',!result.hasMore);
  previewSelection();
}
async function extractPlaylist({next=false}={}){
  if(playlistBusy)return;
  const url=$('playlistUrl').value.trim();
  const start=next&&playlistPreview?playlistPreview.start+playlistPreview.limit:Number($('playlistStart').value);
  const limit=Number($('playlistLimit').value);
  if(!url||!Number.isInteger(start)||start<1||!Number.isInteger(limit)||limit<1){showNotice('playlistStatus','Enter a playlist link and valid batch settings.','error');return;}
  $('playlistPreview').classList.add('hidden');playlistPreview=null;
  setPlaylistBusy(true);
  $('playlistStart').value=String(start);
  showNotice('playlistStatus',`Extracting videos ${start}–${start+limit-1} from YouTube. This can take a minute for a large playlist…`);
  try{
    const result=await api('playlist/extract',{method:'POST',data:{url,start,limit}});
    renderPlaylistPreview(result);
    showNotice('playlistStatus',result.videos.length?`Extracted ${result.videos.length} available videos. Select the ones you want, then import.`:'No available videos in this playlist batch. Try a different range.','success');
  }catch(err){
    showNotice('playlistStatus',err.message,'error');
    if(err.status===401)$('auth').classList.remove('hidden');
  }finally{setPlaylistBusy(false);}
}
$('playlistExtractForm').addEventListener('submit',ev=>{ev.preventDefault();void extractPlaylist();});
$('playlistNextButton').addEventListener('click',()=>void extractPlaylist({next:true}));
$('playlistVideos').addEventListener('change',previewSelection);
$('playlistSelectAll').addEventListener('click',()=>{$('playlistVideos').querySelectorAll('input[type="checkbox"]').forEach(el=>{el.checked=true;});previewSelection();});
$('playlistSelectNone').addEventListener('click',()=>{$('playlistVideos').querySelectorAll('input[type="checkbox"]').forEach(el=>{el.checked=false;});previewSelection();});
function selectedPlaylistVideos(){
  return previewSelection().map(index=>playlistPreview.videos[index]);
}
$('playlistCopyLinks').addEventListener('click',async()=>{
  if(!playlistPreview||playlistBusy)return;
  const links=selectedPlaylistVideos().map(video=>`https://www.youtube.com/watch?v=${video.videoId}`).join('\n');
  if(!links)return;
  try{await navigator.clipboard.writeText(links);showNotice('playlistStatus',`Copied ${selectedPlaylistVideos().length} video URLs.`,'success');}
  catch{showNotice('playlistStatus','Clipboard unavailable. Use Export Selected CSV instead.','error');}
});
$('playlistExportCsv').addEventListener('click',()=>{
  if(!playlistPreview||playlistBusy)return;
  const videos=selectedPlaylistVideos();if(!videos.length)return;
  // Guard spreadsheet applications against formula injection in untrusted video titles.
  const csvValue=value=>{
    let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s=`'${s}`;
    return `"${s.replaceAll('"','""')}"`;
  };
  const rows=[['Playlist position','Video ID','Title','YouTube URL','Duration (seconds)'],
    ...videos.map(v=>[v.position,v.videoId,v.title,`https://www.youtube.com/watch?v=${v.videoId}`,v.duration||''])];
  const csv=rows.map(row=>row.map(csvValue).join(',')).join('\r\n');
  const blob=new Blob([String.fromCharCode(0xFEFF),csv],{type:'text/csv;charset=utf-8'});
  const download=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=download;link.download=`playback-playlist-${playlistPreview.playlistId}-${playlistPreview.start}.csv`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(download),1000);
  showNotice('playlistStatus',`Exported ${videos.length} playlist videos to CSV.`,'success');
});

$('playlistImportButton').addEventListener('click',async()=>{
  if(playlistBusy||!playlistPreview)return;
  const indexes=previewSelection();if(!indexes.length)return;
  setPlaylistBusy(true);
  try{
    const result=await api('playlist/import',{method:'POST',data:{id:playlistPreview.id,indexes,skipDuplicates:$('playlistSkipDuplicates').checked,destination:$('playlistDestination').value,order:$('playlistOrder').value}});
    // Do this only after the server confirms a successful import; failures leave
    // the extracted videos and user selection intact for retry.
    clearPlaylistImporter();
    showNotice('playlistStatus',`Imported ${result.added} videos into ${result.destination}. Skipped ${result.skipped} duplicates. ${result.queued} videos ready in rotation. Ready for another playlist.`,'success');
    await refresh();
  }catch(err){showNotice('playlistStatus',err.message,'error');if(err.status===401)$('auth').classList.remove('hidden');}
  finally{setPlaylistBusy(false);previewSelection();}
});
await initAuth(refresh);
setInterval(()=>{if($('auth').classList.contains('hidden'))refresh();},1300);