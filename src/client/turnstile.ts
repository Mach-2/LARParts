interface TurnstileClient{
  render(container:HTMLElement,options:Record<string,unknown>):string;
  execute(id:string):void;
  remove(id:string):void;
}
declare global{interface Window{turnstile?:TurnstileClient}}
let loading:Promise<void>|undefined;
async function load(){
  if(window.turnstile)return;
  loading??=new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    script.onload=()=>resolve();script.onerror=()=>{loading=undefined;script.remove();reject(new Error('Verification could not load. Please try again.'));};
    document.head.append(script);
  });
  await loading;
}
export async function turnstileToken(siteKey:string,container:HTMLElement,action:'profile-image'|'profile-submit'):Promise<string>{
  await load();const client=window.turnstile;if(!client)throw new Error('Verification could not load.');
  return new Promise((resolve,reject)=>{
    let widget:string|undefined,done=false;
    const finish=(token?:string)=>{
      if(done)return;done=true;clearTimeout(timeout);
      if(widget)client.remove(widget);container.replaceChildren();
      token?resolve(token):reject(new Error('Verification did not finish. Please try again.'));
    };
    const timeout=setTimeout(()=>finish(),60000);
    widget=client.render(container,{sitekey:siteKey,action,execution:'execute',appearance:'interaction-only',
      callback:(token:string)=>finish(token),'error-callback':()=>finish(),'expired-callback':()=>finish()});
    client.execute(widget);
  });
}
