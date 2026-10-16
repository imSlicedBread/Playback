import {$,e,api,thumbnail,formatTime,showNotice,applyTheme,initAuth} from './common.js';
let state=null,busy=false;
async function action(action,props={}){
  if(busy)return;busy=true;
  try{await api('control',{method:'POST',data:{action,...props}});showNotice('controlMessage','Saved','success');await refresh();}
  catch(err){showNotice('controlMessage',err.message,'error');if(err.status===401)$('auth').classList.remove('hidden');}
  finally{busy=false;}
}
function drawNow(s){
  const c=s.current;const el=$('now');el.replaceChildren();$('nowId').textContent=c?.videoId||'NO VIDEO';
  $('pause').textContent=c?.paused?'▶ Resume':'Ⅱ Pause';$('pause').disabled=!c||Boolean(s.vote);
  $('skip').disabled=!c;$('replay').disabled=!c;$('back').disabled=!s.history.length;
  $('seek').disabled=!c||Boolean(s.vote);
  if(!c){el.append(e('div',{class:'empty',text:'No active video. Add videos to begin.'}));return;}
  const img=e('img',{class:'thumb'});img.src=thumbnail(c.videoId);img.alt='Video thumbnail';
  const progress=e('progress',{class:'progress',max:c.duration||1,value:Math.min(c.position||0,c.duration||1)});
  const copy=e('div',{class:'now-copy'},e('div',{class:'eyebrow',text:s.vote?'END SCREEN VOTE':(c.paused?'PAUSED':'PLAYING')}),e('h2',{text:c.title}),e('div',{class:'small-note',text:`${formatTime(c.position||0)} / ${formatTime(c.duration||0)}`}),progress);
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
$('seek').addEventListener('click',()=>action('seek',{position:Number($('seekValue').value)}));
$('addForm').addEventListener('submit',ev=>{ev.preventDefault();action('add',{url:$('newUrl').value,title:$('newTitle').value});});
$('playNew').addEventListener('click',()=>action('add',{url:$('newUrl').value,title:$('newTitle').value,now:true}));
$('bulkAdd').addEventListener('click',()=>action('bulk',{lines:$('bulk').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)}));
await initAuth(refresh);
setInterval(()=>{if($('auth').classList.contains('hidden'))refresh();},1300);