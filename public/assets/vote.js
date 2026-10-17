import {$,e,api,thumbnail,formatTime,applyTheme,showNotice} from './common.js';
let state=null;
async function sendVote(index){try{await api('vote',{method:'POST',data:{choice:index}});showNotice('voteMessage',`Vote recorded for option ${index}. You can change it until voting closes.`,'success');await refresh();}catch(e){showNotice('voteMessage',e.message,'error');}}
async function refresh(){
  try{
    const s=await api('public?compact=1');state=s;applyTheme(s.settings.colors);
    $('nowStatus').textContent=s.vote?'SELECT NEXT':s.current?.paused?'PAUSED':s.current?'PLAYING':'WAITING';
    $('nowTitle').textContent=s.current?.title||'Waiting for video';
    $('countdown').textContent=s.vote?`${s.vote.remaining}s REMAINING`:'VOTING OPENS AT END OF VIDEO';
    $('skipSection').classList.toggle('hidden',Boolean(s.vote)||!s.settings.skipVoting||!s.current);
    $('skipReadout').textContent=`${s.skipCount} of ${s.settings.skipThreshold} votes`;
    $('suggestForm').classList.toggle('hidden',!s.settings.allowSuggestions);
    const options=$('choices');options.replaceChildren();
    if(s.vote){for(let i=0;i<4;i++){
      const v=s.vote.choices[i];const card=e('div',{class:'panel stack'});
      if(v){const img=e('img',{class:'thumb'});img.style.width='100%';img.style.maxWidth='100%';img.src=thumbnail(v.videoId);img.alt='';
        card.append(img,e('div',{class:'eyebrow',text:`OPTION ${i+1} · ${s.vote.counts[i]} VOTES`}),e('h3',{text:v.title}),e('button',{class:'primary',text:`Vote ${i+1}`,onClick:()=>sendVote(i+1)}));}
      else card.append(e('div',{class:'empty',text:`Option ${i+1} unavailable`}));options.append(card);
    }} else options.append(e('div',{class:'empty',text:'Options will appear here when the current video ends.'}));
  }catch(e){showNotice('voteMessage',e.message,'error');}
}
$('skipVote').addEventListener('click',async()=>{try{await api('skip-vote',{method:'POST',data:{}});showNotice('voteMessage','Skip vote recorded.','success');await refresh();}catch(e){showNotice('voteMessage',e.message,'error');}});
$('suggestForm').addEventListener('submit',async(ev)=>{ev.preventDefault();try{await api('suggestion',{method:'POST',data:{url:$('suggestUrl').value,title:$('suggestTitle').value}});showNotice('suggestMessage','Submitted for operator review.','success');$('suggestUrl').value='';$('suggestTitle').value='';}catch(e){showNotice('suggestMessage',e.message,'error');}});
await refresh();setInterval(refresh,1700);