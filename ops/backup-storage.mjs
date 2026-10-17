/** Creates a consistent database backup without stopping the running station. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {backupDatabase,DATABASE_NAME} from '../lib/sqlite-store.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):path.join(root,'data');
if(process.argv.length>3){console.error('Usage: node ops/backup-storage.mjs [destination.sqlite3]');process.exit(2);}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const destination=process.argv[2]||path.join(dir,'backups',`playback-${stamp}.sqlite3`);
try{console.log(`Playback database backup: ${backupDatabase(path.join(dir,DATABASE_NAME),destination)}`);}
catch(err){console.error(`Backup failed: ${err.message}`);process.exitCode=1;}
