import {spawn} from 'node:child_process';
import {readFile,mkdir,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

// Small native CDP driver: installed Edge, isolated temporary profile, no new SDK.
export async function startBrowser(){
  const base=resolve('.netlify'),profile=resolve(base,`validation-browser-${randomUUID()}`);
  if(!profile.startsWith(base+sep))throw new Error('Unexpected browser profile path');
  await mkdir(profile,{recursive:true});
  const child=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
    '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
    '--host-resolver-rules=MAP localhost 127.0.0.1',`--user-data-dir=${profile}`,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let exited=false;child.once('error',()=>exited=true);child.once('exit',()=>exited=true);
  let socket:WebSocket|undefined;
  const requests=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();let next=0;
  const close=async()=>{
    if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
    if(!exited)child.kill();
    for(const request of requests.values()){clearTimeout(request.timer);request.reject(new Error('Browser closed'));}requests.clear();
    try{await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{console.log('Browser scratch cleanup pending under ignored Netlify state');}
  };
  function send(method:string,params:Record<string,unknown>={},sessionId?:string):Promise<any>{
    const id=++next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{requests.delete(id);reject(new Error('Browser command timed out'));},30000);
      requests.set(id,{resolve,reject,timer});socket!.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  try{
    let address='';const deadline=Date.now()+30000;
    while(Date.now()<deadline&&!exited){
      try{const [port,path]=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);address=`ws://127.0.0.1:${port}${path}`;break;}catch{}
      await new Promise(r=>setTimeout(r,200));
    }
    if(!address)throw new Error('Installed Edge did not start');
    socket=new WebSocket(address);await new Promise<void>((resolve,reject)=>{socket!.addEventListener('open',()=>resolve(),{once:true});socket!.addEventListener('error',()=>reject(new Error('Browser connection failed')),{once:true});});
    socket.addEventListener('message',event=>{
      const data=JSON.parse(String(event.data));if(!data.id)return;
      const pending=requests.get(data.id);if(!pending)return;clearTimeout(pending.timer);requests.delete(data.id);
      data.error?pending.reject(new Error('Browser command failed')):pending.resolve(data.result);
    });
    return{close,async page(){
      const {targetId}=await send('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
      await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);await send('Network.enable',{},sessionId);await send('Network.setCacheDisabled',{cacheDisabled:true},sessionId);
      const evaluate=async<T=unknown>(expression:string):Promise<T>=>{
        const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
        if(response.exceptionDetails)throw new Error('Browser evaluation failed');return response.result.value as T;
      };
      const wait=async(expression:string,timeout=30000)=>{
        const deadline=Date.now()+timeout;
        while(Date.now()<deadline){try{if(await evaluate<boolean>(expression))return;}catch{}await new Promise(r=>setTimeout(r,150));}
        throw new Error('Browser condition timed out');
      };
      return{evaluate,wait,navigate:async(url:string)=>{await send('Page.navigate',{url},sessionId);},
        init:async(source:string)=>{await send('Page.addScriptToEvaluateOnNewDocument',{source},sessionId);},
        screenshot:async()=>{const response=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);return Buffer.from(response.data,'base64');},
      };
    }};
  }catch(error){await close();throw error;}
}
