import path from 'node:path'; import {pathToFileURL} from 'node:url';
const root=process.argv[2],count=Number(process.argv[3]||350);
const {PlaybackEngine}=await import(pathToFileURL(path.join(root,'lib/engine.js')));
const engine=new PlaybackEngine(null);
const videos=Array.from({length:count},(_,i)=>({id:`entry-${i}`,videoId:String(i).padStart(11,'0'),title:`2025 Archive #${i} — Playback performance test video with a realistic longer title`,duration:1800,position:0,paused:false,playCount:0,addedAt:'2026-10-16T00:00:00Z'}));
engine.state.current={...videos[0],position:120};engine.state.queue=videos.slice(1);engine.save();
const decorate=s=>({...s,twitch:{state:'disabled',mode:'disabled'},workerActive:true});const full=decorate(engine.operatorState());
if(process.argv.includes('--bundle'))console.log(JSON.stringify({full,first:engine.dashboardState?decorate(engine.dashboardState()):full,delta:engine.dashboardState?decorate(engine.dashboardState(engine.catalogRevision)):full}));
else console.log(JSON.stringify(full));
