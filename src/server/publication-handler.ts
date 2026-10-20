import { createHmac,randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PublicationService,ResendUnavailableError,submissionSchema,type PublicationRpc } from './publication-service';
import { loadPublicationConfig,type PublicationConfig } from './publication-config';
import {verifyTurnstile} from './turnstile';

const auth=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const confirm=z.object({action:z.literal('confirm'),submissionId:z.uuid(),token:auth}).strict();
const manage=z.object({action:z.enum(['status','resend']),submissionId:z.uuid(),turnstileToken:z.string().min(1).max(2048).optional()}).strict();
const submit=z.object({action:z.literal('submit'),submission:submissionSchema,turnstileToken:z.string().min(1).max(2048)}).strict();
type HandlerService=Pick<PublicationService,'submit'|'resend'|'status'|'confirm'|'deliver'>;
export interface PublicationDependencies{config:PublicationConfig;rpc:PublicationRpc;service:HandlerService;verifyBot:(token:string,ip:string)=>Promise<boolean>}
function json(body:unknown,status=200,retryAfter?:number){return Response.json(body,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...(retryAfter?{'retry-after':String(retryAfter)}:{})}});}
export async function handlePublicationRequest(request:Request,ip:string,deps:PublicationDependencies){
  if(request.method!=='POST')return json({error:'Use POST'},405);
  if(request.headers.get('origin')!==deps.config.origin || new URL(request.url).origin!==deps.config.origin || request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Origin not permitted'},403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'Send JSON'},415);
  try{
    const reader=request.body?.getReader();if(!reader)return json({error:'Missing request'},400);
    let total=0,raw='';const decoder=new TextDecoder();
    while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>32768){await reader.cancel();return json({error:'Request too large'},413);}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();
    const parsed=z.union([submit,confirm,manage]).safeParse(JSON.parse(raw));if(!parsed.success)return json({error:'Invalid submission request'},400);
    if(!ip)return json({error:'Client address unavailable'},503);
    const data=parsed.data;
    const rate=async(scope:string,value:string,limit:number)=>{
      const fingerprint=createHmac('sha256',deps.config.backend.SUPABASE_SECRET_KEY).update(`${scope}:${value}`).digest('hex');
      return z.object({allowed:z.boolean(),retryAfter:z.number().int().min(1).max(3600).optional()}).parse(await deps.rpc('rate',undefined,undefined,{fingerprint,limit}));
    };
    const ipLimit=data.action==='submit'?5:60,ipRate=await rate(`publication-${data.action}`,ip,ipLimit);
    if(!ipRate.allowed)return json({error:'Hourly request limit reached',code:'hourly_ip_limit',limit:ipLimit,retryAfter:ipRate.retryAfter},429,ipRate.retryAfter);
    if(data.action==='submit'){
      if(!await deps.verifyBot(data.turnstileToken,ip))return json({error:'Bot verification failed'},403);
      const emailRate=await rate('confirmation-mail',data.submission.submitterEmail,3);
      if(!emailRate.allowed)return json({error:'Hourly confirmation request limit reached',code:'hourly_email_limit',limit:3,retryAfter:emailRate.retryAfter},429,emailRate.retryAfter);
      const result=await deps.service.submit(data.submission);
      await deps.service.deliver(result.submissionId).catch(()=>{});
      return json({submissionId:result.submissionId,state:result.state,message:'Check your email and confirm publication.'},202);
    }
    if(data.action==='confirm'){
      const result=await deps.service.confirm(data.submissionId,data.token);
      // Delivery failures never roll back a successfully published profile.
      if(result.state==='published')await deps.service.deliver(data.submissionId).catch(()=>{});
      return json(result,result.state==='published'?200:result.state==='conflict'?409:202);
    }
    const capability=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if(!capability)return json({error:'Submission capability required'},403);
    if(data.action==='resend'){
      if(!data.turnstileToken || !await deps.verifyBot(data.turnstileToken,ip))return json({error:'Bot verification failed'},403);
      await deps.service.resend(data.submissionId,capability);await deps.service.deliver(data.submissionId).catch(()=>{});
      return json({message:'If eligible, a new confirmation is queued.'},202);
    }
    return json(await deps.service.status(data.submissionId,capability));
  }catch(error){
    if(error instanceof ResendUnavailableError)return json({error:'Confirmation resend unavailable',code:error.code,retryAfter:error.retryAfter},error.code==='resend_cooldown'?429:409,error.retryAfter);
    return json({error:'Request unavailable. Check your link or submission, or try again later.'},422);
  }
}

export function confirmationPage(method='GET'){
  if(!['GET','HEAD'].includes(method))return json({error:'Use the confirmation button'},405);
  const nonce=randomBytes(16).toString('base64');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>Confirm submission | LARParts</title><style nonce="${nonce}">body{font:1.1rem Georgia,serif;background:#f4f7f1;color:#18251d;max-width:42rem;margin:4rem auto;padding:1.5rem}button{background:#174832;color:white;padding:.8rem 1.2rem;border:0;border-radius:.4rem;font:inherit}button:disabled{opacity:.6}</style></head><body><main><h1>Confirm your profile submission</h1><p>Press the button to publish the profile you submitted. Opening this page does not publish it.</p><form id="confirmation"><button type="submit" disabled>Confirm submission</button></form><p id="status" role="status" aria-live="polite"></p></main><script nonce="${nonce}">
let parts=null,revision=0;const form=document.querySelector('form'),button=form.querySelector('button'),status=document.querySelector('#status');
function readLink(){parts=location.hash.slice(1).match(/^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/i);history.replaceState(null,'',location.pathname);revision++;button.disabled=!parts;button.hidden=false;status.textContent=parts?'':'Open the complete link from your confirmation email.';}readLink();addEventListener('hashchange',readLink);
form.addEventListener('submit',async event=>{event.preventDefault();if(!parts)return;const current=parts,attempt=revision;button.disabled=true;status.textContent='Publishing…';try{const response=await fetch('/api/verified-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'confirm',submissionId:current[1],token:current[2]}),cache:'no-store'});const result=await response.json();if(attempt!==revision)return;if(!response.ok)throw new Error();if(result.state==='published'){status.textContent='Your profile is published!';button.hidden=true;}else{status.textContent='Publication is in progress. Press again shortly to check.';button.disabled=false;}}catch{if(attempt!==revision)return;status.textContent='Publication could not finish. Check the link or try again shortly.';button.disabled=false;}});
</script></body></html>`;
  return new Response(method==='HEAD'?null:html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`}});
}
export async function publicationEndpoint(request:Request,ip:string){
  if(process.env.VERIFIED_SUBMISSIONS_ENABLED!=='true')return json({error:'Verified submissions unavailable'},503);
  let service:PublicationService|undefined;
  try{
    const config=loadPublicationConfig();if(config.backend.APP_ENV!=='testing')return json({error:'Verified submissions unavailable'},503);
    if(new URL(request.url).pathname==='/confirm-profile')return confirmationPage(request.method);
    if(!process.env.TURNSTILE_SECRET_KEY)throw new Error();
    service=new PublicationService(config);
    return await handlePublicationRequest(request,ip,{config,rpc:service.rpc,service,verifyBot:(token,address)=>
      verifyTurnstile({secret:process.env.TURNSTILE_SECRET_KEY!,token,ip:address,origin:config.origin,action:'profile-submit'})});
  }catch{return json({error:'Verified submission service unavailable'},503);}finally{service?.close();}
}
