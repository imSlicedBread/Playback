/** YouTube playlist metadata only. Does not download or redistribute videos. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cleanDiscoveredTitle} from './title-metadata.js';

export const MAX_PLAYLIST_BATCH=500;
const PLAYLIST_ID=/^[A-Za-z0-9_-]{10,160}$/;
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bad=(message,status=400)=>Object.assign(new Error(message),{status});

export function parsePlaylistUrl(raw){
  if(typeof raw!=='string'||raw.length>2048)throw bad('Paste a YouTube playlist URL');
  let url;try{url=new URL(raw.trim());}catch{throw bad('Invalid YouTube playlist URL');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.port||url.username||url.password||!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host))
    throw bad('Only HTTPS YouTube playlist links are supported');
  if(!['/playlist','/watch','/'].includes(url.pathname))throw bad('Use a YouTube playlist or watch link with a list= parameter');
  const id=url.searchParams.get('list');
  if(!PLAYLIST_ID.test(id||''))throw bad('Missing or invalid YouTube playlist ID (list=...)');
  return {playlistId:id,url:`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`};
}
export function playlistWindow(start=1,limit=250){
  if(!Number.isInteger(start)||start<1||start>100000)throw bad('Start position must be 1–100000');
  if(!Number.isInteger(limit)||limit<1||limit>MAX_PLAYLIST_BATCH)throw bad(`Extract 1–${MAX_PLAYLIST_BATCH} videos per batch`);
  return {start,limit,end:start+limit-1};
}
function normalizeEntries(entries,window){
  if(!Array.isArray(entries))throw bad('YouTube did not return a playlist video list',502);
  let unavailable=0;
  const videos=[];
  for(const entry of entries.slice(0,window.limit)){
    if(!entry||typeof entry!=='object'){unavailable++;continue;}
    const id=entry.videoId||entry.id;
    const title=entry.title??entry.snippet?.title;
    if(!VIDEO_ID.test(id||'')||entry.availability==='private'||entry.availability==='needs_auth' ||
      /^(\[(?:Private|Deleted) video\]|(?:Private|Deleted) video)$/i.test(String(title||''))){unavailable++;continue;}
    const clean=cleanDiscoveredTitle(title,id)||`YouTube · ${id}`;
    const duration=typeof entry.duration==='number'&&Number.isFinite(entry.duration)&&entry.duration>=0&&entry.duration<=86400?entry.duration:0;
    const index=Number.isInteger(entry.playlist_index)&&entry.playlist_index>0?entry.playlist_index:
      Number.isInteger(entry.position)&&entry.position>0?entry.position:
      Number.isInteger(entry.index)&&entry.index>0?entry.index:window.start+videos.length+unavailable;
    // yt-dlp --flat-playlist may expose upload_date/release_date; YouTube API
    // playlistItem timestamps are playlist-add dates, not publication dates.
    const published=entry.upload_date||entry.release_date||entry.publishedAt||entry.snippet?.videoPublishedAt;
    let publishedAt=null;
    if(typeof published==='string'){
      const d=/^\d{8}$/.test(published)?`${published.slice(0,4)}-${published.slice(4,6)}-${published.slice(6,8)}`:published;
      if(/^\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z)?$/.test(d)&&Number.isFinite(Date.parse(d)))publishedAt=new Date(d).toISOString();
    }
    videos.push({videoId:id,title:clean,duration,position:index,...(publishedAt?{publishedAt}:{})});
  }
  return {videos,unavailable};
}
export function normalizePlaylist(raw,{playlistId,start=1,limit=250,provider='yt-dlp'}={}){
  const window=playlistWindow(start,limit);
  const entries=raw?.entries;
  const {videos,unavailable}=normalizeEntries(entries,window);
  const title=typeof raw?.title==='string'?raw.title.replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,160):'';
  const total=Number.isInteger(raw?.total)&&raw.total>=0?raw.total:
    Number.isInteger(raw?.playlist_count)&&raw.playlist_count>=0?raw.playlist_count:null;
  const last=window.start+(Array.isArray(entries)?entries.length:0)-1;
  return {playlistId,title:title||`YouTube playlist ${playlistId}`,videos,unavailable,start,limit,total,
    hasMore:total!==null?last<total:entries.length===limit,provider};
}

function toolPath(env){
  if(env.YT_DLP_PATH?.trim())return env.YT_DLP_PATH.trim();
  const local=path.join(root,'tools',process.platform==='win32'?'yt-dlp.exe':'yt-dlp');
  return fs.existsSync(local)?local:(process.platform==='win32'?'yt-dlp.exe':'yt-dlp');
}
export async function extractWithYtDlp(parsed,{start,limit,env=process.env,signal,spawnImpl=spawn}={}){
  const window=playlistWindow(start,limit);
  const args=['--ignore-config','--no-warnings','--no-progress','--skip-download','--flat-playlist','--dump-single-json',
    '--playlist-start',String(window.start),'--playlist-end',String(window.end),'--',parsed.url];
  if(signal?.aborted)throw bad('Playlist extraction cancelled',499);
  return new Promise((resolve,reject)=>{
    let settled=false,output=[],bytes=0,stderr='',child,timer,terminationError;
    const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(err)reject(err);else resolve(value);};
    const terminate=error=>{
      if(settled || terminationError)return;
      terminationError=error;clearTimeout(timer);
      // yt-dlp's Windows bootloader can own a child process. Kill only this
      // extraction's PID tree; never kill processes by executable name.
      if(Number.isInteger(child?.pid) && process.platform==='win32') {
        try {
          const killer=spawn(path.join(process.env.SystemRoot||'C:/Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});
          killer.once('error',()=>child.kill('SIGKILL'));
          killer.once('close',code=>{if(code!==0 && !settled)child.kill('SIGKILL');});
        } catch {child.kill('SIGKILL');}
      } else if(Number.isInteger(child?.pid)) {
        try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}
      } else child?.kill();
    };
    const abort=()=>terminate(bad('Playlist extraction cancelled',499));
    try{child=spawnImpl(toolPath(env),args,{windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:env.PATH||process.env.PATH}});}catch(e){return finish(bad(`Cannot start yt-dlp: ${e.message}`,503));}
    timer=setTimeout(()=>terminate(bad('Playlist extraction timed out. Try a smaller batch.',504)),180000);
    timer.unref?.();
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    child.stdout.on('data',chunk=>{if(terminationError)return;bytes+=chunk.length;if(bytes>12*1024*1024){terminate(bad('Playlist response exceeded safe size; try a smaller batch',413));return;}output.push(chunk);});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-3000);});
    child.once('error',e=>finish(e.code==='ENOENT'?bad('Playlist extractor not installed. Install yt-dlp or configure YOUTUBE_API_KEY; see README.',503):bad('yt-dlp could not start; check executable permissions and configuration.',503)));
    child.once('close',code=>{
      if(settled)return;
      if(terminationError)return finish(terminationError);
      if(code!==0)return finish(bad(`Playlist extraction failed (${code}). The playlist may be unavailable, restricted or require yt-dlp updating.`,502));
      try{const data=JSON.parse(Buffer.concat(output).toString('utf8'));finish(null,normalizePlaylist(data,{...window,playlistId:parsed.playlistId,provider:'yt-dlp'}));}
      catch{finish(bad('yt-dlp returned malformed playlist metadata',502));}
    });
  });
}

/** Official YouTube Data API alternative for machines without yt-dlp. */
export async function extractWithYouTubeApi(parsed,{start,limit,env=process.env,fetchImpl=globalThis.fetch,signal}={}){
  const window=playlistWindow(start,limit);
  const key=env.YOUTUBE_API_KEY;
  if(typeof key!=='string'||!key.trim())throw bad('YouTube API key is not configured',503);
  let next='',offset=0,total=null,title='',pages=0;
  const overall=AbortSignal.timeout(180000);
  const entries=[];
  while(entries.length<window.limit){
    if(++pages>Math.ceil(window.end/50)+1)throw bad('Playlist contains too many pages',413);
    const endpoint=new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    endpoint.search=new URLSearchParams({part:'snippet,contentDetails',playlistId:parsed.playlistId,key,maxResults:'50',...(next?{pageToken:next}:{})}).toString();
    const timeout=AbortSignal.timeout(12000),composite=signal?AbortSignal.any([signal,timeout,overall]):AbortSignal.any([timeout,overall]);
    let response;try{response=await fetchImpl(endpoint,{redirect:'error',signal:composite,headers:{Accept:'application/json'}});}
    catch(e){throw bad(signal?.aborted?'Playlist extraction cancelled':'YouTube Data API could not be reached',signal?.aborted?499:502);}
    if(!response.ok)throw bad(`YouTube Data API request failed (${response.status}); check API key, quota, and playlist visibility.`,502);
    if(Number(response.headers?.get?.('content-length')||0)>3*1024*1024)throw bad('YouTube returned too much metadata',502);
    let data;try{data=await response.json();}catch{throw bad('Invalid YouTube Data API response',502);}
    if(!Array.isArray(data.items))throw bad('Invalid YouTube Data API playlist data',502);
    total=Number.isInteger(data.pageInfo?.totalResults)?data.pageInfo.totalResults:total;
    if(!title&&data.items.length)title=data.items[0]?.snippet?.playlistTitle||'';
    for(const item of data.items){
      offset++;
      if(offset<window.start||offset>window.end)continue;
      entries.push({id:item.contentDetails?.videoId,title:item.snippet?.title,
        index:Number.isInteger(item.snippet?.position)?item.snippet.position+1:offset,
        availability:item.snippet?.title==='Private video'?'private':null});
    }
    next=data.nextPageToken||'';
    if(!next||!data.items.length||offset>=window.end)break;
  }
  return normalizePlaylist({title,entries,total},{...window,playlistId:parsed.playlistId,provider:'youtube-api'});
}

export async function extractYouTubePlaylist(raw,{start=1,limit=250,env=process.env,signal,spawnImpl=spawn,fetchImpl=globalThis.fetch}={}){
  const parsed=parsePlaylistUrl(raw);playlistWindow(start,limit);
  if(env.YOUTUBE_API_KEY?.trim())return extractWithYouTubeApi(parsed,{start,limit,env,signal,fetchImpl});
  return extractWithYtDlp(parsed,{start,limit,env,signal,spawnImpl});
}