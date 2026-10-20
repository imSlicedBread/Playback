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
  const now = performance.now();
  const sameGeneration = previous?.nonce === command.nonce && previous?.generation === command.generation;
  if (!sameGeneration) previous?.detach?.();
  const state = sameGeneration ? previous
    : { nonce: command.nonce, generation: command.generation, applied: false, played: false, progressAt: now, lastPosition: null, autoplayBlocked: false };
  window.__fPlaybackWatch = state;
  const report = value => {
    document.title = 'fPlayback:' + command.nonce + ':' + JSON.stringify({
      generation: command.generation, videoId: command.videoId, href: location.href, sample: now, ...value
    });
  };
  const video = document.querySelector('video.html5-main-video');
  const player = document.querySelector('#movie_player');
  const hasBarrier = () => {
    const elements = document.querySelectorAll('ytd-enforcement-message-view-model, .ytp-error-content-wrap, #error-screen:not([hidden]), tp-yt-paper-dialog, ytd-confirm-dialog-renderer');
    return Array.from(elements).some(element => element.getClientRects().length && element.textContent.trim());
  };
  const resetWatchdog = () => { state.progressAt = now; state.lastPosition = null; };
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
  if (advertisement) { resetWatchdog(); report({ status: 'Advertisement — queue position held' }); return; }
  if (barrier) {
    resetWatchdog();
    report({ status: 'YouTube needs attention. Open the output window to check access or confirm playback.' }); return;
  }
  if (!video || video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) {
    if (command.paused || command.voting || state.autoplayBlocked) resetWatchdog();
    else if (now-state.progressAt >= 30000) { recover('startup'); return; }
    report({ status: 'Waiting for YouTube. Sign in or check video access in the output window.' }); return;
  }
  if (state.video !== video) {
    state.detach?.(); state.video = video;
    const ended = () => {
      const latest = state.latestCommand;
      if (window.__fPlaybackWatch !== state || !state.played || latest.paused || latest.voting ||
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
  css(document.documentElement,{margin:'0',background:'#000',overflow:'hidden'});
  css(document.body,{margin:'0',background:'#000',overflow:'hidden'});
  // YouTube's watch-page containers clip fixed descendants. Keep the original
  // player/video objects, but attach the player directly to the document body.
  if (player && player.parentElement !== document.body) document.body.appendChild(player);
  if (player) css(player,{position:'fixed',inset:'0',width:'100vw',height:'100vh',background:'#000','z-index':'2147483646'});
  css(video,{width:'100vw',height:'100vh',left:'0',top:'0','object-fit':'contain'});
  if (!state.applied) {
    video.currentTime = Math.max(0, Math.min(command.position, video.duration));
    state.applied = true;
  }
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
  report({ status: command.paused ? 'Paused' : 'Playing', position: video.currentTime, duration: video.duration });
})();
