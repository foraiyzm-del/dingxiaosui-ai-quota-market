// One optional Node worker per process. It only resumes existing paid tasks;
// the callback must never create a generation request.
const slot=Symbol.for('zdx.media-reconciler.v1');

export function startMediaReconciler(reconcile,{intervalMs=5000,initialDelayMs=1000,onError=()=>console.error('Media background recovery temporarily unavailable')}={}){
 if(globalThis[slot])return globalThis[slot];
 if(typeof reconcile!=='function')throw new TypeError('A reconciliation callback is required');
 const delay=Number.isInteger(intervalMs)&&intervalMs>=10?Math.min(intervalMs,60000):5000;
 const first=Number.isInteger(initialDelayMs)&&initialDelayMs>=0?Math.min(initialDelayMs,60000):1000;
 let stopped=false,running=false,timer;
 const stop=()=>{
  if(stopped)return;stopped=true;clearTimeout(timer);
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  if(globalThis[slot]===worker)delete globalThis[slot];
 };
 const worker={stop,get running(){return running;}};
 function schedule(wait){if(stopped)return;timer=setTimeout(tick,wait);timer.unref?.();}
 async function tick(){
  if(stopped)return;running=true;
  try{await reconcile();}catch{try{onError();}catch{/* Logging cannot stop recovery. */}}
  finally{running=false;schedule(delay);}
 }
 globalThis[slot]=worker;
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 schedule(first);
 return worker;
}
