// Outbound-only reader lifecycle shared by Kick and SOOP. No public listener.
export class ChatSocketReader {
  constructor(engine,platform,{adminDispatcher,fetchImpl=globalThis.fetch,webSocketFactory=(...args)=>new WebSocket(...args),delay=setTimeout,cancelDelay=clearTimeout}={}){
    Object.assign(this,{engine,platform,adminDispatcher,fetchImpl,webSocketFactory,delay,cancelDelay});
    this.stopped=true;this.epoch=0;this.attempt=0;this.socket=null;this.timer=null;this.heartbeat=null;this.watchdog=null;this.abort=null;
    this.status={state:'DISABLED',channel:'',detail:''};
  }
  setStatus(state,detail=''){this.status={state,channel:this.engine.settings[this.platform+'Channel'],detail};}
  start(){this.stopped=false;this.reconfigure();}
  stop(){this.stopped=true;this.reset();this.setStatus('DISABLED');}
  reset(){
    this.epoch++;this.abort?.abort();this.abort=null;
    for(const key of ['timer','heartbeat','watchdog']){if(this[key]!=null)this.cancelDelay(this[key]);this[key]=null;}
    if(this.socket){const socket=this.socket;this.socket=null;socket.onopen=socket.onmessage=socket.onclose=socket.onerror=null;try{socket.close();}catch{}}
  }
  reconfigure(){
    this.reset();this.attempt=0;
    if(this.stopped||!this.engine.settings[this.platform+'Enabled']){this.setStatus('DISABLED');return;}
    this.connect();
  }
  connect(){
    const epoch=this.epoch;this.abort=new AbortController();this.setStatus('CONNECTING');
    Promise.resolve().then(()=>this.open(epoch)).catch(error=>{
      if(!this.current(epoch))return;
      if(error.state==='CONFIG_REQUIRED'||error.state==='AUTH_ERROR'){this.reset();this.setStatus(error.state,error.message);}
      else {
        const waiting=error.state==='WAITING_FOR_LIVE';
        this.retry(waiting?'Waiting for an authorized live SOOP broadcast. Check the broadcaster and approved chat scope.':'Connection failed; retrying.');
        if(waiting)this.setStatus('WAITING_FOR_LIVE',this.status.detail);
      }
    });
  }
  current(epoch){return !this.stopped&&epoch===this.epoch&&this.engine.settings[this.platform+'Enabled'];}
  retry(detail='Disconnected; retrying.'){
    if(this.stopped)return;
    this.reset();this.setStatus('RETRYING',detail);
    this.timer=this.delay(()=>{this.timer=null;if(!this.stopped)this.connect();},Math.min(60000,1000*2**Math.min(this.attempt++,6)));
    this.timer?.unref?.();
  }
  attach(socket,epoch,onOpen,onMessage){
    if(!this.current(epoch)){socket.close();return;}
    this.socket=socket;
    socket.onopen=()=>{if(this.current(epoch))try{onOpen();}catch{this.retry();}};
    socket.onmessage=event=>{
      if(!this.current(epoch))return;
      try{onMessage(event.data);}catch{this.retry('Invalid chat response; retrying.');}
    };
    socket.onclose=socket.onerror=()=>{if(this.current(epoch))this.retry();};
    this.watchdog=this.delay(()=>{if(this.current(epoch))this.retry('Chat subscription timed out; retrying.');},30000);
    this.watchdog?.unref?.();
  }
  ready(){
    if(this.watchdog!=null)this.cancelDelay(this.watchdog);this.watchdog=null;
    this.attempt=0;this.setStatus('CONNECTED','Receiving admin commands only.');
  }
}

export async function boundedJson(response,maxBytes=128*1024){
  if(Number(response.headers.get('content-length')||0)>maxBytes)throw new Error('Chat response too large');
  const reader=response.body?.getReader();
  if(!reader)throw new Error('Chat response is empty');
  let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new Error('Chat response too large');chunks.push(Buffer.from(value));}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
