import {$,api,applyTheme,applyLowerThird,formatTime,setTicker} from './common.js';
import {renderVoteScreen} from './vote-screen.js';
const hud=$('hud'),voteMount=$('voteMount');
let titleKey='',voteKey='';
async function refresh(){
 try{
  const s=await api('public?compact=1');
  applyTheme(s.settings.colors);applyLowerThird(hud,s.settings.lowerThird);
  $('hudChannel').textContent=s.settings.channelLabel||'fKey Playback';
  $('hudDuration').textContent=`DURATION ${formatTime(s.current?.duration||NaN)}`;
  $('hudSkip').textContent=`SKIP ${s.skipCount}/${s.settings.skipThreshold}`;
  hud.classList.toggle('hidden',!s.settings.showLowerThird||!s.current||Boolean(s.vote));
  const nextTitle=JSON.stringify([s.current?.title,s.layoutRevision,s.settings.scrollTitles]);
  if(nextTitle!==titleKey){titleKey=nextTitle;setTicker($('hudTitle'),s.current?.title||'',s.settings.scrollTitles);}
  const nextVote=JSON.stringify([s.vote,s.layoutRevision]);
  if(nextVote!==voteKey){
   voteKey=nextVote;voteMount.classList.toggle('hidden',!s.vote);
   if(s.vote)renderVoteScreen(voteMount,s.vote,s.settings);else voteMount.replaceChildren();
  }
 }catch{
  hud.classList.add('hidden');voteMount.classList.add('hidden');titleKey='';voteKey='';
 }finally{setTimeout(refresh,1000);}
}
// Visuals only: this source never claims playback or loads another YouTube player.
refresh();
