import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=(name)=>fs.readFileSync(path.join(root,name),'utf8');

test('Completed playlist import resets only the importer inputs and preview while retaining preferences',()=>{
  const js=source('public/assets/control.js');
  const begin=js.indexOf('function clearPlaylistImporter(){');
  const end=js.indexOf('\nfunction renderPlaylistPreview',begin);
  assert.ok(begin!==-1 && end>begin,'reset function exists');
  const code=js.slice(begin,end);
  const nodes={};
  for(const name of ['playlistPreview','playlistVideos','playlistName','playlistCount','playlistSelected','playlistNextButton',
    'playlistUrl','playlistStart','playlistDestination','playlistOrder','playlistSkipDuplicates','playlistLimit']){
    nodes[name]={value:'',textContent:'test',classList:{classes:new Set(),add(v){this.classes.add(v);},contains(v){return this.classes.has(v);}},replaceChildren(){this.children=[];},focus(){this.focused=true;}};
  }
  nodes.playlistUrl.value='https://youtube.com/playlist?list=PL0123456789abcdefghijklmnop';
  nodes.playlistStart.value='251';
  nodes.playlistDestination.value='nextRotation';
  nodes.playlistOrder.value='newest';
  nodes.playlistSkipDuplicates.checked=false;
  nodes.playlistLimit.value='250';
  const result=vm.runInNewContext('let playlistPreview={id:"test"}; '+code+'\nclearPlaylistImporter(); playlistPreview;',{$:id=>nodes[id]});
  assert.equal(result,null);
  assert.equal(nodes.playlistUrl.value,'');
  assert.equal(nodes.playlistStart.value,'1');
  assert.equal(nodes.playlistName.textContent,'');
  assert.equal(nodes.playlistCount.textContent,'');
  assert.equal(nodes.playlistSelected.textContent,'0 of 0 selected');
  assert.ok(nodes.playlistPreview.classList.contains('hidden'));
  assert.ok(nodes.playlistNextButton.classList.contains('hidden'));
  assert.deepEqual(nodes.playlistVideos.children,[]);
  assert.equal(nodes.playlistUrl.focused,true);
  assert.equal(nodes.playlistDestination.value,'nextRotation');
  assert.equal(nodes.playlistOrder.value,'newest');
  assert.equal(nodes.playlistLimit.value,'250');
  assert.equal(nodes.playlistSkipDuplicates.checked,false);
});

test('Importer reset runs only after a successful server confirmation, not on extraction or import failure',()=>{
  const js=source('public/assets/control.js');
  const importHandler=js.slice(js.indexOf("$('playlistImportButton').addEventListener('click'"));
  assert.ok(importHandler.includes("await api('playlist/import'"));
  assert.match(importHandler,/const result=await api\('playlist\/import',[\s\S]*?clearPlaylistImporter\(\);[\s\S]*?showNotice\('playlistStatus',[\s\S]*?'success'\)/);
  const catchSection=importHandler.slice(importHandler.indexOf('}catch(err)'));
  assert.ok(!catchSection.includes('clearPlaylistImporter()'));
  assert.ok(js.indexOf('function clearPlaylistImporter')>js.indexOf('function setPlaylistBusy'));
});

test('Lower Third anchor edge and snap buttons share an aligned full-width responsive row',()=>{
  const html=source('public/settings.html'),css=source('public/assets/style.css');
  assert.match(html,/<div class="lowerthird-anchor-section"[^>]*>[\s\S]*?<div class="lowerthird-anchor-toolbar">[\s\S]*?id="ltAnchor"[\s\S]*?id="snapBottom"[\s\S]*?id="snapTop"[\s\S]*?id="resetLower"[\s\S]*?<div class="readout lowerthird-readout" id="lowerReadout"/);
  assert.match(css,/\.lowerthird-anchor-toolbar\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[^}]*align-items:end/);
  assert.match(css,/\.lowerthird-anchor-toolbar select,\.lowerthird-anchor-toolbar button\{[^}]*width:100%/);
  assert.match(css,/@media\(max-width:1220px\)\{\.lowerthird-anchor-toolbar\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:540px\)\{\.lowerthird-anchor-toolbar\{grid-template-columns:1fr/);
  assert.match(html,/style\.css\?v=1\.2\.3/);
});