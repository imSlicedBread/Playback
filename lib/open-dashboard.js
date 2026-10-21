import {spawn} from 'node:child_process';

// A second interactive launch can use the existing station, including one
// started under LOCAL SERVICE. Never start a replacement or remove its lock.
export async function openExistingDashboard({port,env=process.env,fetchHealth=fetch,launch=openDashboard}={}) {
  if(env.PB_OPEN_BROWSER!=='1'||!Number.isInteger(port)||port<1||port>65535)return false;
  try {
    const response=await fetchHealth(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)});
    if(!response.ok)return false;
    const health=await response.json();
    if(health?.ok!==true||health.app!=='fKey Playback')return false;
    launch({port,env});
    return true;
  } catch {return false;}
}

/**
 * Open the operator dashboard in the user's default browser.
 *
 * The URL uses the *actual* bound port, not the configured default. Nothing is
 * opened unless an interactive launcher explicitly opts in with
 * PB_OPEN_BROWSER=1. The OBS player route must never be opened here: doing so
 * would add an unwanted second playback worker to the same station.
 */
export function dashboardBrowserCommand(port, platform=process.platform) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('Invalid dashboard port');
  }
  const url=`http://127.0.0.1:${port}/control`;
  if (platform==='win32') {
    // `start` is a cmd.exe builtin. The empty quoted argument is the window
    // title, preventing the URL from being mistakenly interpreted as the title.
    return {url, command:'cmd.exe', args:['/d','/c',`start "" "${url}"`], windowsVerbatimArguments:true};
  }
  if (platform==='darwin') return {url, command:'open', args:[url], windowsVerbatimArguments:false};
  return {url, command:'xdg-open', args:[url], windowsVerbatimArguments:false};
}

export function openDashboard({
  port,
  env=process.env,
  platform=process.platform,
  spawnProcess=spawn,
  logger=console
}={}) {
  if (env.PB_OPEN_BROWSER!=='1') return false;
  // Non-GUI Linux installations should be able to run the station unattended.
  if (platform==='linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  const {command,args,windowsVerbatimArguments}=dashboardBrowserCommand(port,platform);
  try {
    const child=spawnProcess(command,args,{
      detached:true,
      stdio:'ignore',
      windowsHide:true,
      windowsVerbatimArguments
    });
    // The browser opener is optional. A missing default browser must never
    // crash or block the actual streaming server.
    child.on?.('error',(err)=>logger.warn(`Could not open browser automatically: ${err.message}`));
    child.unref?.();
    return true;
  } catch (err) {
    logger.warn(`Could not open browser automatically: ${err.message}`);
    return false;
  }
}
