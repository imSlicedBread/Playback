/** Serialize refreshes; coalesce bursts into one trailing refresh, never stale parallel responses. */
export function singleFlight(task){
  let running=null,requested=false;
  return function request(){
    requested=true;
    if(running)return running;
    // Defer execution one microtask so running is assigned even for a sync task.
    running=Promise.resolve().then(async()=>{
      try{do{requested=false;await task();}while(requested);}
      finally{running=null;}
    });
    return running;
  };
}
