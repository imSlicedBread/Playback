/**
 * Headless Task Scheduler entrypoint. This runs in the same process as Playback:
 * no child process can outlive the scheduled task, and no browser opens in a
 * service (session 0). Keep all writable files under the configured data directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(projectRoot, 'data');
const logPath = path.join(dataDir, 'boot-service.log');
const maxLogBytes = 5 * 1024 * 1024;

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--port' || !/^\d{1,5}$/.test(args[1])) {
  console.error('Usage: node ops/boot-service.mjs --port 4177');
  process.exit(2);
}
const port = Number(args[1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid port: use 1–65535');
  process.exit(2);
}

// Never open a browser in a noninteractive task. The separate logon task does
// that in the user's desktop session once the backend is healthy.
process.env.PB_OPEN_BROWSER = '0';
process.env.NODE_ENV = 'production';
process.env.PORT = String(port);
process.chdir(projectRoot);
fs.mkdirSync(dataDir, {recursive: true});

function append(message) {
  try {
    const line = `${new Date().toISOString()} ${message}\n`;
    const size = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    if (size + Buffer.byteLength(line) > maxLogBytes) {
      fs.renameSync(logPath, `${logPath}.previous`);
    }
    fs.appendFileSync(logPath, line, {encoding:'utf8'});
  } catch (err) {
    // Do not hide errors: Task Scheduler can report a failed task.
    process.stderr.write(`Playback log error: ${err.message}\n`);
  }
}
for (const level of ['log', 'info', 'warn', 'error']) {
  console[level] = (...values) => append(`[${level}] ${util.format(...values)}`);
}
process.on('exit', code => append(`[service] Exit code ${code}`));
append(`[service] Starting fKey Playback as ${process.execPath}, port ${port}, PID ${process.pid}`);
try {
  await import('../server.js');
} catch (error) {
  console.error('Boot service could not start:', error);
  process.exitCode = 1;
}