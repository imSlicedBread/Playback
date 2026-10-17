import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function mkdirPrivate(p) { fs.mkdirSync(p, { recursive: true, mode: 0o700 }); }
export function privateSecret(dir, name, bytes=32) {
  mkdirPrivate(dir);
  const p=path.join(dir,name);
  try { return fs.readFileSync(p,'utf8').trim(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const newToken=crypto.randomBytes(bytes).toString('hex');
  try { fs.writeFileSync(p,newToken+'\n',{flag:'wx',mode:0o600}); }
  catch(e){if(e.code!=='EEXIST')throw e;}
  return fs.readFileSync(p,'utf8').trim();
}

export class DurableStore {
  constructor(dir) { this.dir=path.resolve(dir); mkdirPrivate(this.dir); this.file=path.join(this.dir,'state.json'); this.previous=path.join(this.dir,'state.previous.json'); }
  load() {
    try { return JSON.parse(fs.readFileSync(this.file,'utf8')); }
    catch(e) {
      if(e.code==='ENOENT')return null;
      // Do not silently discard corrupted state. An operator can recover from backup manually.
      throw new Error(`Cannot read ${this.file}: ${e.message}. Restore from state.previous.json if necessary.`);
    }
  }
  write(state) {
    const raw=JSON.stringify(state)+'\n';
    const temp=path.join(this.dir,`state-${process.pid}-${crypto.randomBytes(5).toString('hex')}.tmp`);
    const fd=fs.openSync(temp,fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,0o600);
    try { fs.writeFileSync(fd,raw);fs.fsyncSync(fd); } finally {fs.closeSync(fd);}
    try {
      if(fs.existsSync(this.file)) fs.copyFileSync(this.file,this.previous);
      fs.renameSync(temp,this.file);
      // Sync containing directory after rename where supported.
      if(process.platform!=='win32') {let d;try {d=fs.openSync(this.dir,'r');fs.fsyncSync(d);}catch{}finally{if(d!==undefined)fs.closeSync(d);}}
    } catch(e) { try{fs.unlinkSync(temp);}catch{} throw e; }
  }
  backupLegacy(raw) {
    if(raw?.schemaVersion===2)return;
    const name=path.join(this.dir,raw?.schemaVersion===1?'state.before-rotation-migration.json':'state.before-production-migration.json');
    if(!fs.existsSync(name))fs.copyFileSync(this.file,name);
  }
}

export function processLock(dir) {
  mkdirPrivate(dir);
  const file=path.join(dir,'.instance.lock');
  for(let n=0;n<2;n++) {
    try {fs.writeFileSync(file,String(process.pid),{flag:'wx',mode:0o600});return ()=>{try{if(fs.readFileSync(file,'utf8').trim()===String(process.pid))fs.unlinkSync(file);}catch{}};}
    catch(e) {
      if(e.code!=='EEXIST')throw e;
      const pid=Number(fs.readFileSync(file,'utf8'));
      if(pid>0) {try {process.kill(pid,0);throw new Error(`Another Playback process (PID ${pid}) uses ${dir}`);}catch(error){if(error.code!=='ESRCH')throw error;}}
      fs.unlinkSync(file);
    }
  }
  throw new Error('Could not acquire instance lock');
}
