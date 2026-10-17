/** Best-effort YouTube title discovery; no API key and no dependency on the OBS player. */
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;

export function isPlaceholderTitle(title,videoId){
  return !title || title===`YouTube · ${videoId}`;
}

export function cleanDiscoveredTitle(raw,videoId){
  if(!VIDEO_ID.test(videoId||'') || typeof raw!=='string')return null;
  const title=raw.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,180).trim();
  if(!title || title===videoId || title===`YouTube · ${videoId}` || /^YouTube(?: video)?$/i.test(title))return null;
  return title;
}

export async function fetchYouTubeTitle(videoId,{fetchImpl=globalThis.fetch,signal}={}){
  if(!VIDEO_ID.test(videoId||''))return null;
  // The destination is fixed; a video ID never becomes a user-controlled fetch URL.
  const url=`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  try{
    const timeout=AbortSignal.timeout(5000);
    const requestSignal=signal?AbortSignal.any([timeout,signal]):timeout;
    const response=await fetchImpl(url,{headers:{Accept:'application/json'},redirect:'error',signal:requestSignal});
    if(!response.ok)return null;
    const size=Number(response.headers?.get?.('content-length')||0);
    if(size>65536)return null;
    const contentType=response.headers?.get?.('content-type')||'';
    if(contentType&&!contentType.toLowerCase().includes('json'))return null;
    const json=await response.json();
    return cleanDiscoveredTitle(json?.title,videoId);
  }catch{return null;}
}

/** Bounded background lookups: queue imports must not flood YouTube or block HTTP responses. */
export class TitleMetadataQueue{
  constructor(engine,{resolver=fetchYouTubeTitle,concurrency=2}={}){
    this.engine=engine;this.resolver=resolver;this.concurrency=concurrency;
    this.pending=new Set();this.seen=new Set();this.cache=new Map();this.controllers=new Set();this.active=0;this.closed=false;
  }
  enqueue(videoIds){
    if(this.closed)return;
    // One pass over the catalog, rather than copying/scanning it once per ID.
    const items=[this.engine.state.current,...(this.engine.allQueued?.()||this.engine.state.queue),...this.engine.state.suggestions];
    const unresolved=new Set(items.filter(v=>v&&isPlaceholderTitle(v.title,v.videoId)).map(v=>v.videoId));
    for(const id of videoIds){
      if(!VIDEO_ID.test(id||'')||this.pending.size>=500||!unresolved.has(id))continue;
      if(this.cache.has(id)){this.engine.applyDiscoveredTitle(id,this.cache.get(id));continue;}
      if(this.seen.has(id))continue;
      this.seen.add(id);this.pending.add(id);
    }
    this.pump();
  }
  pump(){
    while(!this.closed&&this.active<this.concurrency&&this.pending.size){
      const id=this.pending.values().next().value;this.pending.delete(id);
      const controller=new AbortController();this.controllers.add(controller);this.active++;
      Promise.resolve().then(()=>this.resolver(id,{signal:controller.signal})).then(title=>{
        if(!this.closed&&title){
          const clean=cleanDiscoveredTitle(title,id);
          if(clean){this.cache.set(id,clean);this.engine.applyDiscoveredTitle(id,clean);}
        }
      }).catch(()=>{}).finally(()=>{this.controllers.delete(controller);this.active--;this.pump();});
    }
  }
  close(){this.closed=true;this.pending.clear();for(const controller of this.controllers)controller.abort();}
}
