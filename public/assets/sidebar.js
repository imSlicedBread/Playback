const version=document.getElementById('sidebarVersion');
if(version){
  fetch('/api/health',{cache:'no-store'}).then(response=>{
    if(!response.ok)throw new Error('Version unavailable');
    return response.json();
  }).then(health=>{
    if(typeof health.version==='string')version.textContent=`FKEY PLAYBACK ${health.version}`;
  }).catch(()=>{});
}
const stationPort=document.getElementById('stationPort');
if(stationPort)stationPort.textContent=location.port||(location.protocol==='https:'?'443':'80');
