import { e, thumbnail } from './common.js';
const EXAMPLES=[
  {id:'a',videoId:'dQw4w9WgXcQ',title:'Sample video one — The Beginning'},
  {id:'b',videoId:'jNQXAC9IVRw',title:'Sample video two — A Journey'},
  {id:'c',videoId:'aqz-KE-bpKQ',title:'Sample video three — Adventure'},
  {id:'d',videoId:'LXb3EKWsInQ',title:'Sample video four — Highlights'}
];
export function renderVoteScreen(container,vote,settings,{preview=false}={}){
  const v=vote||{choices:EXAMPLES,counts:[5,2,9,1],remaining:20};
  const config=settings.voteScreen;
  const screen=e('div',{class:'vote-screen'+(preview?' preview-grid':'')});
  screen.style.background=settings.colors.background;
  screen.style.setProperty('--card-gap',`${config.cardGap*(preview?.5:1)}px`);
  screen.style.setProperty('--panel-alpha',String(config.panelOpacity/100));
  screen.append(e('div',{class:'vote-heading',text:config.heading||'UP NEXT'}));
  if(config.showCountdown)screen.append(e('div',{class:'countdown',text:`SELECTING IN ${Math.ceil(v.remaining)}s`}));
  if(config.instruction)screen.append(e('div',{class:'vote-instructions',text:config.instruction}));
  const cards=e('div',{class:'vote-cards'});
  for(let i=0;i<4;i++){
    const video=v.choices?.[i];
    const card=e('div',{class:`vote-card${config.accentBorders?' accent-border':''}${!video?' empty':''}`});
    const txt=e('div',{class:'vote-card-copy'});
    txt.append(e('div',{class:'number',text:`${i+1}`}),e('div',{class:'card-title',text:video?.title||'EMPTY'}));
    if(config.showVotes)txt.append(e('div',{class:'card-votes',text:`${Number(v.counts?.[i]||0)} VOTES`}));
    if(config.showThumbnails&&video){const img=e('img',{class:'vote-thumb'});img.alt='';img.src=thumbnail(video.videoId);card.append(img);}
    card.append(txt);cards.append(card);
  }
  screen.append(cards);container.replaceChildren(screen);
}