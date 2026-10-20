// SPDX-License-Identifier: GPL-2.0-or-later
/* Runs only in the OBS browser panel's normal YouTube watch page. No network,
 * cookies, account details, or confirmation buttons are accessed here. */
(() => {
  const command = __PLAYBACK_COMMAND__;
  // QCef can finish creating its initial homepage after a queued setURL call.
  // Recover only that startup page; never navigate account or other watch pages.
  if (location.origin === 'https://www.youtube.com' && location.pathname === '/') {
    location.replace('https://www.youtube.com/watch?v=' + command.videoId); return;
  }
  if (location.origin !== 'https://www.youtube.com' || location.pathname !== '/watch' ||
      new URL(location.href).searchParams.get('v') !== command.videoId) return;
  const previous = window.__fPlaybackWatch;
  const video = document.querySelector('video.html5-main-video');
  const now = performance.now();
  const sameGeneration = previous?.nonce === command.nonce && previous?.generation === command.generation;
  const preservePosition=!sameGeneration && command.transportOnly===true && previous?.applied &&
    previous.video===video && previous.latestCommand?.videoId===command.videoId;
  if (!sameGeneration) previous?.detach?.();
  const state = sameGeneration ? previous
    : { nonce: command.nonce, generation: command.generation, applied: false, played: false, progressAt: now, lastPosition: null, autoplayBlocked: false };
  if (preservePosition) {
    state.applied=true; state.played=previous.played;
    state.checkpoint=previous.checkpoint; state.checkpointAt=previous.checkpointAt;
    state.positionGuardUntil=previous.positionGuardUntil;
    const elapsed=previous.latestCommand.paused || previous.latestCommand.voting ? 0 : Math.max(0,(now-previous.checkpointAt)/1000);
    if (now>=state.positionGuardUntil || (Number.isFinite(video.currentTime) &&
        video.currentTime>=state.checkpoint-2 && video.currentTime<=state.checkpoint+elapsed+2)) {
      state.checkpoint=video.currentTime; state.checkpointAt=now;
    }
  }
  window.__fPlaybackWatch = state;
  const report = value => {
    document.title = 'fPlayback:' + command.nonce + ':' + JSON.stringify({
      generation: command.generation, videoId: command.videoId, href: location.href, sample: now, ...value
    });
  };
  const player = document.querySelector('#movie_player');
  const hasBarrier = () => {
    const elements = document.querySelectorAll('ytd-enforcement-message-view-model, .ytp-error-content-wrap, #error-screen:not([hidden]), tp-yt-paper-dialog, ytd-confirm-dialog-renderer');
    return Array.from(elements).some(element => element.getClientRects().length && element.textContent.trim());
  };
  const resetWatchdog = () => { state.progressAt = now; state.lastPosition = null; };
  const positionMatches = (position,sampleNow=now) => {
    if (!state.applied || sampleNow >= state.positionGuardUntil) return true;
    const elapsed=command.paused || command.voting ? 0 : Math.max(0,(sampleNow-state.checkpointAt)/1000);
    return position>=state.checkpoint-2 && position<=state.checkpoint+elapsed+2;
  };
  const recover = reason => report({status:'Recovering stalled YouTube playback…',recover:reason});
  state.latestCommand = command; state.report = report;
  const advertisement=player?.classList.contains('ad-showing');
  const barrier=hasBarrier();
  // Lock only the ordinary player chrome. Access prompts and advertisements
  // retain their original UI; users unlock the native window to interact.
  const chrome=Array.from(document.querySelectorAll('.ytp-chrome-bottom, .ytp-chrome-top, .ytp-gradient-bottom, .ytp-gradient-top, .ytp-tooltip, .ytp-watermark, .branding-img-container, .iv-branding'));
  const saved=window.__fPlaybackChrome || (window.__fPlaybackChrome=new Map());
  const lockChrome=command.locked===true && !advertisement && !barrier;
  for (const [element,styles] of saved) {
    if (lockChrome && chrome.includes(element)) continue;
    for (const [name,value,priority] of styles) {
      if (value) element.style.setProperty(name,value,priority);
      else element.style.removeProperty(name);
    }
    saved.delete(element);
  }
  if (lockChrome) for (const element of chrome) {
    if (!saved.has(element)) saved.set(element,['opacity','visibility','pointer-events'].map(name=>
      [name,element.style.getPropertyValue(name),element.style.getPropertyPriority(name)]));
    element.style.setProperty('opacity','0','important');
    element.style.setProperty('visibility','hidden','important');
    element.style.setProperty('pointer-events','none','important');
  }
  // Ads and access barriers must never advance or overwrite the saved queue position.
  if (advertisement) { state.applied=false; resetWatchdog(); report({ status: 'Advertisement — queue position held', revealDisplay:true }); return; }
  if (barrier) {
    state.applied=false; resetWatchdog();
    report({ status: 'YouTube needs attention. Open the output window to check access or confirm playback.', revealDisplay:true }); return;
  }
  if (!video || video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) {
    if (command.paused || command.voting || state.autoplayBlocked) resetWatchdog();
    else if (now-state.progressAt >= 30000) { recover('startup'); return; }
    report({ status: 'Waiting for YouTube. Sign in or check video access in the output window.' }); return;
  }
  if (state.video !== video) {
    state.detach?.(); state.video = video;
    state.checkLayout=null;state.layoutReady=false;
    if (!preservePosition) state.applied=false;
    const ended = () => {
      const latest = state.latestCommand;
      if (window.__fPlaybackWatch !== state || !state.played || latest.paused || latest.voting ||
          video.seeking || !positionMatches(video.currentTime,performance.now()) ||
          location.origin !== 'https://www.youtube.com' || location.pathname !== '/watch' ||
          new URL(location.href).searchParams.get('v') !== latest.videoId ||
          document.querySelector('#movie_player')?.classList.contains('ad-showing') ||
          hasBarrier()) return;
      state.report({ status: 'Video ended', ended: true });
    };
    video.addEventListener('ended', ended);
    state.detach = () => video.removeEventListener('ended', ended);
  }
  // Crop the real watch player without an embed or synthetic confirmation clicks.
  const css = (element, styles) => {
    for (const [name,value] of Object.entries(styles)) element.style.setProperty(name,value,'important');
  };
  // CSSOM properties also work when the page's CSP rejects an injected <style>.
  const applyLayout=()=>{
    css(document.documentElement,{margin:'0',background:'#000',overflow:'hidden'});
    css(document.body,{margin:'0',background:'#000',overflow:'hidden'});
    if (player && player.parentElement !== document.body) document.body.appendChild(player);
    if (player) css(player,{position:'fixed',inset:'0',width:'100vw',height:'100vh',background:'#000','z-index':'2147483646'});
    css(video,{width:'100vw',height:'100vh',left:'0',top:'0','object-fit':'contain'});
  };
  applyLayout();
  if (!state.checkLayout) {
    let frame=null,stableSince=null;
    state.layoutReady=false;
    const fullSize=element=>{
      const rect=element?.getBoundingClientRect();
      return rect && Math.abs(rect.left)<=2 && Math.abs(rect.top)<=2 &&
        Math.abs(rect.width-window.innerWidth)<=2 && Math.abs(rect.height-window.innerHeight)<=2;
    };
    const check=()=>{
      frame=null;
      if (window.__fPlaybackWatch!==state || state.video!==video ||
          location.origin!=='https://www.youtube.com' || location.pathname!=='/watch' ||
          new URL(location.href).searchParams.get('v')!==state.latestCommand.videoId) return;
      if (player?.classList.contains('ad-showing') || hasBarrier()) {
        state.layoutReady=false;stableSince=null;
        state.report({status:'YouTube needs attention',revealDisplay:true});return;
      }
      const now=performance.now();
      const sized=fullSize(player) && fullSize(video);
      const ready=sized && video.readyState>=2 && video.videoWidth>0 && video.videoHeight>0 && !video.seeking && state.applied;
      if (!ready) {
        stableSince=null;
        if (state.layoutReady) state.report({status:'Preparing video layout…',displayReady:false});
        state.layoutReady=false;
        if (!sized) applyLayout();
      } else {
        if (stableSince===null) stableSince=now;
        if (now-stableSince>=500 && !state.layoutReady) {
          state.layoutReady=true;
          state.report({status:state.latestCommand.paused?'Paused':'Playing',displayReady:true});
        }
      }
      if (!state.layoutReady) frame=requestAnimationFrame(check);
    };
    state.checkLayout=()=>{if(frame===null)frame=requestAnimationFrame(check);};
    const observer=new MutationObserver(state.checkLayout);
    observer.observe(video,{attributes:true,attributeFilter:['style','class']});
    if(player)observer.observe(player,{attributes:true,attributeFilter:['style','class']});
    window.addEventListener?.('resize',state.checkLayout);
    const detach=state.detach;
    state.detach=()=>{detach?.();observer.disconnect();if(frame!==null)cancelAnimationFrame(frame);window.removeEventListener?.('resize',state.checkLayout);};
  }
  state.checkLayout();
  if (command.paused || command.voting) video.pause();
  if (!state.applied) {
    state.checkpoint = Math.max(0, Math.min(command.position, video.duration));
    state.checkpointAt=now; state.positionGuardUntil=now+10000;
    video.currentTime = state.checkpoint;
    state.applied = true;
  }
  // YouTube can apply account watch-history resume after our initial seek.
  // Reject that jump before it can replace Playback's saved queue checkpoint.
  if (!positionMatches(video.currentTime)) {
    video.currentTime=state.checkpoint;
    state.checkpointAt=now;
    report({status:'Restoring Playback saved position…'}); return;
  }
  if (video.seeking) {
    if (now-state.progressAt>=30000) recover('startup');
    else report({status:'Restoring Playback saved position…'});
    return;
  }
  state.checkpoint=video.currentTime; state.checkpointAt=now;
  video.volume = command.volume / 100;
  video.muted = command.muted;
  if (command.paused || command.voting) {
    video.pause();
  } else if (video.paused && !video.ended) {
    const attempt = video.play();
    attempt?.catch(error => {
      if (window.__fPlaybackWatch !== state) return;
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        state.autoplayBlocked = true;
        report({ status: 'Press Play in the output window to allow playback.' });
      }
    });
  }
  if (!video.paused && !video.ended) { state.played = true; state.autoplayBlocked = false; }
  if (video.ended && state.played && !command.paused && !command.voting) {
    report({ status: 'Video ended', ended: true }); return;
  }
  if (command.paused || command.voting || state.autoplayBlocked) {
    resetWatchdog();
  } else if (Number.isFinite(video.currentTime)) {
    if (state.lastPosition === null || Math.abs(video.currentTime-state.lastPosition) >= .25) {
      state.lastPosition = video.currentTime; state.progressAt = now;
    } else if (now-state.progressAt >= 10000) {
      recover(video.readyState < 3 ? 'buffering' : 'stalled'); return;
    }
  }
  if (state.autoplayBlocked) { report({status:'Press Play in the output window to allow playback.'}); return; }
  // Voting must not undo the engine's parked playback position.
  if (command.voting || !state.applied || !Number.isFinite(video.currentTime)) {
    report({ status: command.voting ? 'Waiting for the queue vote' : 'Waiting for playback' }); return;
  }
  report({ status: command.paused ? 'Paused' : 'Playing', position: video.currentTime, duration: video.duration,
    displayReady:state.layoutReady===true && video.readyState>=2 && !video.seeking });
})();
