export const $ = id=>document.getElementById(id);
export const e=(tag,attrs={},...children)=>{
  const out=document.createElement(tag);
  for(const [k,v]of Object.entries(attrs)){
    if(k==='class')out.className=v;
    else if(k==='text')out.textContent=String(v??'');
    else if(k==='onClick')out.addEventListener('click',v);
    else if(k==='title')out.title=v;
    else if(k==='type')out.type=v;
    else if(k==='disabled')out.disabled=Boolean(v);
    else out.setAttribute(k,String(v));
  }
  for(const c of children.flat())if(c!=null)out.append(c instanceof Node?c:document.createTextNode(String(c)));
  return out;
};
export async function api(path,{method='GET',data,signal}={}){
  const options={method,credentials:'same-origin',headers:{},signal};
  if(data!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
  const res=await fetch(`/api/${path}`,options);
  const payload=await res.json().catch(()=>({error:'Unexpected server response'}));
  if(!res.ok) {const err=new Error(payload.error||`HTTP ${res.status}`);err.status=res.status;throw err;}
  return payload;
}
export function formatTime(seconds){
  if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)return '--:--';
  const sec=Math.floor(seconds),s=String(sec%60).padStart(2,'0'),m=Math.floor(sec/60);
  return m>=60?`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}:${s}`:`${m}:${s}`;
}
export function thumbnail(videoId){return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;}
export function showNotice(id,message,type=''){const el=$(id);if(!el)return;el.className=`notice ${type}`;el.textContent=message;}
export function applyTheme(colors={}){
  const styles={background:'--bg',panel:'--panel',raised:'--raised',accent:'--accent',text:'--text',healthy:'--healthy',warning:'--warning',error:'--error',info:'--info',community:'--community'};
  for(const [key,prop] of Object.entries(styles))if(/^#[a-fA-F0-9]{6}$/.test(colors[key]||'')){const style=document.documentElement.style;if(style.getPropertyValue(prop)!==colors[key])style.setProperty(prop,colors[key]);}
}
export async function initAuth(onAuthenticated){
  const form=$('loginForm'),overlay=$('auth');
  async function check(){
    try{const session=await api('session');if(session.authenticated){overlay?.classList.add('hidden');await onAuthenticated();}else overlay?.classList.remove('hidden');}
    catch{overlay?.classList.remove('hidden');}
  }
  form?.addEventListener('submit',async(ev)=>{
    ev.preventDefault();const input=$('token');
    try{await api('login',{method:'POST',data:{token:input.value}});input.value='';$('authError').textContent='';overlay?.classList.add('hidden');await onAuthenticated();}
    catch(e){$('authError').textContent=e.message;}
  });
  $('logout')?.addEventListener('click',async()=>{try{await api('logout',{method:'POST'});}catch{}overlay?.classList.remove('hidden');});
  await check();
}
export function applyLowerThird(el,layout,{preview=false}={}){
  const n=(value,defaultValue)=>typeof value==='number'&&Number.isFinite(value)?value:defaultValue;
  const x=Math.max(0,Math.min(85,n(layout?.x,3)));
  const width=Math.max(15,Math.min(90,n(layout?.width,34)));
  const y=Math.max(0,Math.min(94,n(layout?.y,0)));
  const height=n(layout?.height,0);
  const opacity=Math.max(0,Math.min(100,n(layout?.backgroundOpacity,89)));
  const scale=Math.max(.5,Math.min(2,n(layout?.scale,100)/100));
  const titleScale=Math.max(.5,Math.min(3,n(layout?.titleScale,100)/100));
  const anchor=layout?.anchor==='top'?'top':'bottom';
  el.style.left=`${Math.min(x,100-width)}%`;el.style.width=`${width}%`;
  el.style.top=anchor==='top'?`${y}%`:'auto';
  el.style.bottom=anchor==='bottom'?`${y}%`:'auto';
  el.style.height=height>=4?`${Math.min(height,100-y)}%`:'auto';
  el.style.backgroundColor=`rgba(13, 16, 16, ${(opacity/100).toFixed(2)})`;
  el.classList.toggle('manual-height',height>=4);
  el.classList.toggle('bottom-anchored',anchor==='bottom');
  // Only hide presentation elements. Viewer skip votes, playback state and duration
  // remain active even when their corresponding HUD labels are hidden.
  const show={channel:layout?.showChannelLabel===true,nowPlaying:layout?.showNowPlaying===true,
    duration:layout?.showDuration===true,skip:layout?.showSkip===true};
  for(const [key,enabled] of Object.entries(show)){
    el.querySelector(`[data-lt-field="${key}"]`)?.classList.toggle('hidden',!enabled);
  }
  const noTop=!show.channel&&!show.nowPlaying,noBottom=!show.duration&&!show.skip;
  const top=el.querySelector('.topline'),bottom=el.querySelector('.lowerline');
  top?.classList.toggle('hidden',noTop);bottom?.classList.toggle('hidden',noBottom);
  top?.classList.toggle('only-right',!show.channel&&show.nowPlaying);
  bottom?.classList.toggle('only-right',!show.duration&&show.skip);
  el.classList.toggle('no-topline',noTop);
  el.classList.toggle('no-bottomline',noBottom);
  // Scale title text independently of card padding and supporting HUD labels.
  // For the editor, measure its own 16:9 frame rather than the full browser.
  const canvasWidth=preview?(el.closest('.preview-frame')?.clientWidth||960):window.innerWidth;
  const factor=Math.max(.3,Math.min(2,canvasWidth/1920))*scale;
  const title=el.querySelector('.title-clip');
  el.style.padding=`${Math.round(15*factor)}px ${Math.round(18*factor)}px`;
  if(top)top.style.fontSize=`${Math.max(preview?6:7,Math.round(16*factor))}px`;
  if(title)title.style.fontSize=`${Math.max(preview?7:11,Math.round(31*factor*titleScale))}px`;
  if(bottom)bottom.style.fontSize=`${Math.max(preview?6:7,Math.round(14*factor))}px`;
}
export function setTicker(el,title,enabled){
  const track=e('div',{class:'marquee-track'});const first=e('span',{text:title});track.append(first);el.replaceChildren(track);
  if(!enabled)return;
  requestAnimationFrame(()=>{
    if(!el.isConnected)return;
    const length=first.getBoundingClientRect().width;
    if(length<=el.clientWidth+2)return;
    track.append(e('span',{text:title}));
    track.style.setProperty('--ticker-distance',`${length+36}px`);
    track.style.setProperty('--ticker-seconds',`${Math.max(6,(length+36)/37).toFixed(2)}s`);
    track.classList.add('moving');
  });
}
