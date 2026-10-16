import test from 'node:test';
import assert from 'node:assert/strict';
import {applyYouTubeAudio} from '../public/assets/youtube-audio.js';

test('OBS YouTube iframe receives volume changes and mute/unmute commands',()=>{
  const calls=[];
  const yt={setVolume:v=>calls.push(['setVolume',v]),mute:()=>calls.push(['mute']),unMute:()=>calls.push(['unMute'])};
  assert.equal(applyYouTubeAudio(yt,{volume:29,muted:false}),true);
  assert.deepEqual(calls,[['setVolume',29],['unMute']]);
  calls.length=0;
  assert.equal(applyYouTubeAudio(yt,{volume:29,muted:true}),true);
  assert.deepEqual(calls,[['setVolume',29],['mute']]);
  calls.length=0;
  assert.equal(applyYouTubeAudio(yt,{volume:0,muted:false}),true);
  assert.deepEqual(calls,[['setVolume',0],['mute']]);
});

test('Invalid volume or failed YouTube player API is rejected safely',()=>{
  const calls=[];
  const yt={setVolume:v=>calls.push(v),mute:()=>{},unMute:()=>{}};
  assert.equal(applyYouTubeAudio(yt,{volume:101,muted:false}),false);
  assert.equal(applyYouTubeAudio(yt,{volume:12.5,muted:false}),false);
  assert.equal(applyYouTubeAudio(yt,{volume:20,muted:'no'}),false);
  assert.deepEqual(calls,[]);
  assert.equal(applyYouTubeAudio(null,{volume:20,muted:false}),false);
  assert.equal(applyYouTubeAudio({setVolume(){throw Error('embed unavailable')}},{volume:10,muted:true}),false);
});