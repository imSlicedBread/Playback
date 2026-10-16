import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PlaybackEngine,parseYoutube,migrateState} from '../lib/engine.js';
import {DurableStore} from '../lib/store.js';
import {DEFAULT_SETTINGS,validateSettings} from '../lib/config.js';
import {parseIrcLine,voteFromMessage,commandFromMessage} from '../lib/twitch.js';

function newEngine(t,clock={now:10000}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new DurableStore(dir);
  return {store,dir,clock,engine:new PlaybackEngine(store,{clock:()=>clock.now,identitySecret:'test-key'})};
}
const ids=['dQw4w9WgXcQ','jNQXAC9IVRw','aqz-KE-bpKQ','LXb3EKWsInQ','9bZkp7q19f0'];

test('YouTube ID parser accepts supported links and rejects forged external hosts',()=>{
  assert.equal(parseYoutube('https://youtu.be/dQw4w9WgXcQ?t=30'),ids[0]);
  assert.equal(parseYoutube('https://www.youtube.com/watch?v=jNQXAC9IVRw'),ids[1]);
  assert.equal(parseYoutube('https://youtube.com/shorts/aqz-KE-bpKQ'),ids[2]);
  assert.equal(parseYoutube(ids[0]),ids[0]);
  assert.throws(()=>parseYoutube('https://evil.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.throws(()=>parseYoutube('javascript:alert(1)'));
  assert.throws(()=>parseYoutube('https://youtube.com/watch?v=bad'));
});

test('Queue, skip, replay, seek and exact saved state survive restart',t=>{
  const {engine,store,clock}=newEngine(t);
  ids.slice(0,3).forEach((id,i)=>engine.add(id,`Film ${i+1}`));
  const firstId=engine.state.current.id,queuedId=engine.state.queue[0].id;
  engine.seek(84);engine.pause(true);const gen=engine.state.generation;
  assert.equal(engine.updatePosition(gen-1,4,120),false,'stale worker generation must not overwrite seek');
  assert.equal(engine.updatePosition(gen,84,315),true);
  const next=new PlaybackEngine(store,{clock:()=>clock.now+550000,identitySecret:'test-key'});
  assert.equal(next.state.current.id,firstId);
  assert.equal(next.state.current.position,84);
  assert.equal(next.state.current.duration,315);
  assert.equal(next.state.current.paused,true);
  assert.equal(next.state.queue[0].id,queuedId);
  next.pause(false);next.skip();
  assert.equal(next.state.current.id,queuedId);
  assert.equal(next.state.history.length,1);
  next.previous();assert.equal(next.state.current.id,firstId);
  next.replay();assert.equal(next.state.current.position,0);
});

test('End-of-video voting deduplicates changed votes and picks highest votes',t=>{
  const {engine,clock,store}=newEngine(t);
  ids.forEach((id,i)=>engine.add(id,`Choice ${i+1}`));
  const winner=engine.state.queue[1].id;
  const gen=engine.state.generation;
  assert.equal(engine.ended(gen),true);
  assert.equal(engine.ended(gen),false);
  assert.equal(engine.state.vote.remaining,20);
  engine.voteChoice(1,'alice');engine.voteChoice(2,'alice');engine.voteChoice(2,'bob');
  assert.deepEqual(engine.getVotes(),[0,2,0,0]);
  const second=new PlaybackEngine(store,{clock:()=>clock.now+300_000,identitySecret:'test-key'});
  assert.equal(second.state.vote.remaining,20,'server downtime does not consume vote countdown');
  clock.now+=300_020;
  second.tick();
  assert.equal(second.state.vote,null);
  assert.equal(second.state.current.id,winner);
});

test('Zero-vote tie breaks toward earliest available choice',t=>{
  const {engine,clock}=newEngine(t);ids.slice(0,4).forEach(id=>engine.add(id));
  const first=engine.state.queue[0].id;
  engine.ended(engine.state.generation);clock.now+=21_000;engine.tick();
  assert.equal(engine.state.current.id,first);
});

test('Removing a candidate discards its vote and fallback winner remains valid',t=>{
  const {engine}=newEngine(t);ids.slice(0,4).forEach(id=>engine.add(id));
  engine.ended(engine.state.generation);const deleted=engine.state.vote.choices[0];
  engine.voteChoice(1,'alice');engine.remove(deleted);assert.deepEqual(engine.getVotes(),[0,0,0,0]);
  engine.conclude();assert.equal(engine.state.current.videoId,ids[2]);
});

test('Worker errors quarantine unavailable video instead of looping forever',t=>{
  const {engine}=newEngine(t);engine.add(ids[0]);engine.failVideo();
  assert.equal(engine.state.current,null);assert.equal(engine.state.queue.length,0);
  assert.equal(engine.state.history[0].unavailable,true);
});

test('Lower third, appearance, vote screen settings persist and strictly validate',t=>{
  const {engine,store}=newEngine(t);
  const settings=structuredClone(DEFAULT_SETTINGS);
  settings.colors.accent='#12aBcD';settings.lowerThird={...settings.lowerThird,x:12.5,y:0,width:53,scale:160,anchor:'bottom'};
  settings.voteScreen.heading='PICK THE NEXT FILM';settings.voteScreen.cardGap=32;
  const before=engine.state.layoutRevision;
  engine.saveSettings(settings);assert.equal(engine.state.layoutRevision,before+1);
  const restored=new PlaybackEngine(store,{clock:()=>10000});
  assert.deepEqual(restored.settings.lowerThird,settings.lowerThird);
  assert.equal(restored.settings.voteScreen.heading,settings.voteScreen.heading);
  assert.equal(restored.settings.colors.accent,'#12aBcD');
  assert.throws(()=>validateSettings({...settings,colors:{...settings.colors,accent:'red'}}));
  assert.throws(()=>validateSettings({...settings,lowerThird:{...settings.lowerThird,width:110}}));
  assert.throws(()=>validateSettings({...settings,voteSeconds:2}));
  assert.throws(()=>validateSettings({...settings,unexpected:true}));
});

test('Output sync acknowledgement stores actual rendered revision only',t=>{
  const {engine,clock}=newEngine(t);
  engine.outputAck('obs-one',4,{clean:false});assert.equal(engine.getOutputStatus()[0].layoutRevision,4);
  clock.now+=16001;assert.equal(engine.getOutputStatus().length,0);
});

test('Legacy JSON recovery preserves available queue/playhead and makes conservative defaults',()=>{
  const old={current:{videoId:ids[0],title:'Old video',currentTime:32},queue:[{videoId:ids[1],title:'Next'}],paused:true,settings:{loop:false}};
  const result=migrateState(old);
  assert.equal(result.current.videoId,ids[0]);assert.equal(result.current.position,32);
  assert.equal(result.queue[0].videoId,ids[1]);assert.equal(result.settings.loop,false);
  assert.equal(result.current.paused,true);
  assert.equal(result.migratedFrom,'legacy');
});

test('IRC parses tagged usernames and exact !vote command, not other chatter',()=>{
  const line='@badge-info=;user-id=12345 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #station :!vote 3';
  assert.equal(parseIrcLine(line).tags['user-id'],'12345');
  assert.deepEqual(voteFromMessage(line),{channel:'station',user:'id:12345',choice:3});
  assert.equal(voteFromMessage(line.replace('!vote 3','!vote 3 please')),null);
  assert.equal(voteFromMessage('PING :tmi.twitch.tv'),null);
  const fallback=':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #station :!VOTE 1';
  assert.equal(voteFromMessage(fallback).user,'nick:viewer');
});

test('Manual voting pauses the playhead and restores playback on cancellation',t=>{
  const {engine}=newEngine(t);engine.add(ids[0]);engine.add(ids[1]);
  const gen=engine.state.generation;
  engine.seek(64);engine.startVote();assert.equal(engine.state.vote.manual,true);
  assert.equal(engine.state.current.paused,true);
  engine.cancelVote();assert.equal(engine.state.vote,null);assert.equal(engine.state.current.position,64);
  assert.equal(engine.state.current.paused,false);assert.ok(engine.state.generation>gen);
});


test('Twitch chat skip and video suggestions are recognized without capturing regular chat',()=>{
  const prefix=':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #station :';
  assert.deepEqual(commandFromMessage(prefix+'!skip'),{kind:'skip',channel:'station',user:'nick:viewer'});
  const request=commandFromMessage(prefix+'!request https://youtu.be/dQw4w9WgXcQ | Favorite');
  assert.equal(request.kind,'request');assert.equal(request.url,'https://youtu.be/dQw4w9WgXcQ');assert.equal(request.title,'Favorite');
  assert.equal(commandFromMessage(prefix+'hello there'),null);
  assert.equal(commandFromMessage(prefix+'!vote 5'),null);
});


test('Automatically recovered YouTube titles persist without replacing custom titles',t=>{
  const {engine,store,clock}=newEngine(t);
  engine.add(ids[0]);engine.add(ids[0], 'My own title');engine.add(ids[1]);
  assert.equal(engine.state.current.title,`YouTube · ${ids[0]}`);
  assert.equal(engine.applyDiscoveredTitle(ids[0],'Rick Astley - Never Gonna Give You Up'),true);
  assert.equal(engine.state.current.title,'Rick Astley - Never Gonna Give You Up');
  assert.equal(engine.state.queue[0].title,'My own title');
  assert.equal(engine.applyDiscoveredTitle(ids[0],'Other Name'),false);
  const newDuplicate=engine.add(ids[0]);
  assert.equal(newDuplicate.title,'Rick Astley - Never Gonna Give You Up');
  const restored=new PlaybackEngine(store,{clock:()=>clock.now+1000});
  assert.equal(restored.state.current.title,'Rick Astley - Never Gonna Give You Up');
  assert.equal(restored.state.queue[0].title,'My own title');
});

test('Iframe title heartbeat requires current generation and matching video ID',t=>{
  const {engine,store,clock}=newEngine(t);
  engine.add(ids[0]);const gen=engine.state.generation;
  assert.equal(engine.updatePosition(gen-1,10,200,'Wrong video title',ids[0]),false);
  assert.equal(engine.updatePosition(gen,10,200,'Wrong video title',ids[1]),true);
  assert.equal(engine.state.current.title,`YouTube · ${ids[0]}`);
  assert.equal(engine.updatePosition(gen,10,200,'Video&#39; actual title',ids[0]),true);
  assert.equal(engine.state.current.title,'Video&#39; actual title');
  const restored=new PlaybackEngine(store,{clock:()=>clock.now+1000});
  assert.equal(restored.state.current.title,'Video&#39; actual title');
});

test('Operator audio persists without changing video generation or lower-third revision', t=>{
  const {engine,store}=newEngine(t);
  engine.add(ids[0]);
  const generation=engine.state.generation;
  const layoutRevision=engine.state.layoutRevision;
  assert.deepEqual(engine.publicState().audio,{volume:100,muted:false});
  assert.deepEqual(engine.setAudio(42,false),{volume:42,muted:false});
  assert.equal(engine.state.generation,generation);
  assert.equal(engine.state.layoutRevision,layoutRevision);
  assert.deepEqual(engine.setAudio(42,true),{volume:42,muted:true});
  engine.skip();
  const restored=new PlaybackEngine(store,{clock:()=>20000});
  assert.deepEqual(restored.publicState().audio,{volume:42,muted:true});
  restored.setAudio(42,false);
  assert.equal(restored.publicState().audio.muted,false);
  restored.setAudio(0,false);
  assert.deepEqual(restored.publicState().audio,{volume:0,muted:true});
});

test('Audio control strictly validates levels and old saves default to full volume',t=>{
  const {engine}=newEngine(t);
  const revision=engine.state.revision;
  for(const n of [-1,101,38.5,'75',NaN,Infinity,null]){
    assert.throws(()=>engine.setAudio(n,false),/Volume must/);
  }
  assert.throws(()=>engine.setAudio(40,'false'),/Mute must/);
  assert.equal(engine.state.revision,revision,'invalid requests must not mutate durable state');
  assert.deepEqual(migrateState({schemaVersion:1,settings:{loop:false}}).audio,{volume:100,muted:false});
  assert.deepEqual(migrateState({schemaVersion:1,audio:{volume:900,muted:'false'}}).audio,{volume:100,muted:false});
});