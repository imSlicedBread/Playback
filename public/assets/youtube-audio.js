/** Apply operator audio to the active YouTube IFrame API player.
 *  The OBS audio mixer is a separate downstream control. */
export function applyYouTubeAudio(player,audio){
  if(!player||!Number.isInteger(audio?.volume)||audio.volume<0||audio.volume>100||typeof audio.muted!=='boolean')return false;
  try{
    player.setVolume(audio.volume);
    if(audio.muted||audio.volume===0)player.mute();
    else player.unMute();
    return true;
  }catch{return false;}
}