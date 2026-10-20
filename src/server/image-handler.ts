import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { loadBackendConfig,BackendConfigurationError,type BackendConfig } from './config';
import { createImageRpc,ImageService,type ImageRpc } from './image-service';
import { MAX_IMAGE_BYTES,IMAGE_TYPES } from './image-processing';
import {verifyTurnstile} from './turnstile';

const start=z.object({action:z.literal('start'),mode:z.enum(['upload','remote','none']),bytes:z.number().int().min(1).max(MAX_IMAGE_BYTES).optional(),type:z.enum(IMAGE_TYPES).optional(),turnstileToken:z.string().min(1).max(2048)}).strict();
const operation=z.object({action:z.enum(['process','preview']),sessionId:z.uuid(),sourceUrl:z.string().max(2048).optional()}).strict();
export type ImageHandlerDependencies={config:BackendConfig;rpc:ImageRpc;service:Pick<ImageService,'start'|'process'|'preview'>;verifyBot:(token:string,ip:string)=>Promise<boolean>;siteOrigin:string};
function json(body:unknown,status=200){return Response.json(body,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});}
export async function handleImageRequest(request:Request,ip:string,deps:ImageHandlerDependencies) {
  if(request.method!=='POST') return json({error:'Use POST'},405);
  if(request.headers.get('origin')!==deps.siteOrigin || new URL(request.url).origin!==deps.siteOrigin || request.headers.get('sec-fetch-site')==='cross-site') return json({error:'Origin not permitted'},403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({error:'Send JSON'},415);
  try {
    // Read bounded streams, including clients without Content-Length.
    const reader=request.body?.getReader(); if(!reader) return json({error:'Missing request'},400);
    let raw='',total=0; const decoder=new TextDecoder();
    while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>8192){await reader.cancel();return json({error:'Request too large'},413);}raw+=decoder.decode(part.value,{stream:true});}
    raw+=decoder.decode();
    const parsed=z.union([start,operation]).safeParse(JSON.parse(raw));
    if(!parsed.success) return json({error:'Invalid image request'},400);
    if(!ip) return json({error:'Client address unavailable'},503);
    const fingerprint=createHmac('sha256',deps.config.SUPABASE_SECRET_KEY).update(`image:${ip}`).digest('hex');
    const rate=z.object({allowed:z.boolean()}).parse(await deps.rpc('rate',undefined,undefined,{fingerprint}));
    if(!rate.allowed)return json({error:'Too many image requests; try later'},429);
    const data=parsed.data;
    if(data.action==='start') {
      if(!await deps.verifyBot(data.turnstileToken,ip))return json({error:'Bot verification failed'},403);
      if(data.mode==='none') return json({assetId:null});
      if(data.mode==='upload' && (!data.bytes || !data.type))return json({error:'Choose a JPEG, PNG or WebP up to 5 MB'},400);
      return json(await deps.service.start(data.mode,data.bytes,data.type));
    }
    const capability=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if(!capability)return json({error:'Image capability required'},403);
    return json(data.action==='process'?await deps.service.process(data.sessionId,capability,data.sourceUrl):await deps.service.preview(data.sessionId,capability));
  } catch {return json({error:'Image request failed; check the image or start again'},422);}
}

export async function imageEndpoint(request:Request,ip:string) {
  if(process.env.IMAGE_INGESTION_ENABLED!=='true')return json({error:'Image ingestion unavailable'},503);
  let service:ImageService|undefined;
  let stage='backend_configuration';
  try {
    const config=loadBackendConfig();
    stage='site_url';
    const site=new URL(process.env.SITE_URL??'');
    if(site.pathname!=='/' || site.username || site.password || site.search || site.hash ||
      (site.protocol!=='https:' && !(config.APP_ENV==='testing' && site.protocol==='http:' && ['localhost','127.0.0.1'].includes(site.hostname)))) throw new Error('Invalid site origin');
    stage='turnstile_configuration';
    if(!process.env.TURNSTILE_SECRET_KEY)throw new Error('Bot configuration missing');
    stage='storage_initialization';
    const rpc=createImageRpc(config); service=new ImageService(config,rpc);
    stage='request_dispatch';
    return await handleImageRequest(request,ip,{config,rpc,service,siteOrigin:site.origin,verifyBot:(token,address)=>
      verifyTurnstile({secret:process.env.TURNSTILE_SECRET_KEY!,token,ip:address,origin:site.origin,action:'profile-image'})});
  } catch(error){
    // Keep credential values, request bodies, URLs, provider errors and stacks out
    // of logs. The browser continues to receive only the generic service error.
    console.error('Image service initialization failed',{
      stage,...(error instanceof BackendConfigurationError?{code:error.code,fields:error.fields}:{code:'initialization_failed'}),
    });
    return json({error:'Image service unavailable'},503);
  } finally {service?.close();}
}
