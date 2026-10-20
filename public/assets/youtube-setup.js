const playerUrl=new URL('/player',location.href).href;
document.getElementById('restoreUrl').textContent=playerUrl;
document.getElementById('copyPlayer').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(playerUrl);document.getElementById('copyStatus').textContent='Player URL copied. Restore it in the same OBS Browser Source after signing in.';}
  catch{document.getElementById('copyStatus').textContent='Copy the player URL shown above into the OBS Browser Source properties.';}
});
