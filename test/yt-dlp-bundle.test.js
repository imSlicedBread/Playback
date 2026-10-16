import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Windows yt-dlp release bundler pins an official release, checks SHA-256 and ships licenses',()=>{
  const bundler=fs.readFileSync(path.join(root,'ops/bundle-yt-dlp.py'),'utf8');
  const packageScript=fs.readFileSync(path.join(root,'ops/package-release.py'),'utf8');
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/release.yml'),'utf8');
  assert.match(bundler,/VERSION = '2026\.08\.19'/);
  assert.match(bundler,/WINDOWS_SHA256 = '[a-f0-9]{64}'/);
  assert.match(bundler,/sha256=WINDOWS_SHA256/);
  assert.match(bundler,/THIRD_PARTY_LICENSES\.txt/);
  assert.match(packageScript,/require-yt-dlp/);
  assert.match(workflow,/ops\/bundle-yt-dlp\.py/);
  assert.match(workflow,/ops\/package-release\.py --require-yt-dlp/);
  assert.match(workflow,/yt-dlp\.exe --version/);
});