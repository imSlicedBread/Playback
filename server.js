import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from './lib/http.js';
import {openDashboard} from './lib/open-dashboard.js';

const PORT=Number(process.env.PORT||4177);
const HOST=process.env.HOST||'127.0.0.1';
const DATA_DIR=process.env.DATA_DIR||path.join(path.dirname(fileURLToPath(import.meta.url)),'data');
if(!Number.isInteger(PORT)||PORT<0||PORT>65535)throw new Error('Invalid PORT');
const app=createApp({host:HOST,port:PORT,dataDir:DATA_DIR});
try {
  const address=await app.listen();
  const p=address.port;
  console.log(`fKey Playback made by fKey Labs Inc. 1.0.7 ready\n  Dashboard: http://127.0.0.1:${p}/control\n  Settings:  http://127.0.0.1:${p}/settings\n  OBS:       http://127.0.0.1:${p}/player\n  Viewer:    http://127.0.0.1:${p}/vote\n  Token:     ${path.join(DATA_DIR,'admin-token.txt')}\n  State:     ${path.join(DATA_DIR,'state.json')}`);
  openDashboard({port:p});
  let closing=false;const shutdown=()=>{if(closing)return;closing=true;app.close().then(()=>process.exit(0));setTimeout(()=>process.exit(1),4000).unref();};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}catch(e){app.cleanup();console.error('Failed to start:',e.message);process.exitCode=1;}