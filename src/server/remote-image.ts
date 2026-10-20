import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as pinnedFetch } from 'undici';
import { MAX_IMAGE_BYTES } from './image-processing';

export function publicAddress(address: string): boolean {
  try {
    const ip=ipaddr.process(address);
    return ip.range()==='unicast';
  } catch { return false; }
}
export function imageSourceUrl(value: string): URL {
  let u: URL;
  try { u=new URL(value); } catch { throw new Error('Enter a direct HTTPS image URL'); }
  if(value.length>2048 || u.protocol!=='https:' || (u.port && u.port!=='443') || u.username || u.password ||
    u.hash || u.hostname.endsWith('.') || u.hostname==='localhost' || u.hostname.endsWith('.localhost') ||
    u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) throw new Error('Unsafe image URL');
  return u;
}
export async function readLimited(body: AsyncIterable<Uint8Array>, maximum=MAX_IMAGE_BYTES) {
  const chunks:Buffer[]=[]; let total=0;
  for await(const part of body) { total+=part.length; if(total>maximum) throw new Error('Image too large'); chunks.push(Buffer.from(part)); }
  return Buffer.concat(chunks);
}
// Resolve once per hop, reject any internal answer, then PIN the actual socket to
// those validated addresses. A second implicit DNS lookup would allow rebinding.
export interface RemoteImageDependencies {
  resolve?:(host:string)=>Promise<Array<{address:string;family:number}>>;
  request?:typeof pinnedFetch;
}
export async function fetchRemoteImage(value: string,dependencies:RemoteImageDependencies={}): Promise<Buffer> {
  let url=imageSourceUrl(value);
  const signal=AbortSignal.timeout(15000);
  for(let redirects=0;redirects<=3;redirects++) {
    const hostname=url.hostname.replace(/^\[|\]$/g,'');
    const records=isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] :
      await Promise.race([(dependencies.resolve??(host=>lookup(host,{all:true})))(hostname),new Promise<never>((_,reject)=> {
        const done=()=>reject(new Error('Image request timed out'));
        if(signal.aborted) done(); else signal.addEventListener('abort',done,{once:true});
      })]);
    if(!records.length || records.some(r=>!publicAddress(r.address))) throw new Error('Image destination is not public');
    const dispatcher=new Agent({connect:{timeout:5000,lookup:(_host,options,callback)=> {
      const answers=records.map(r=>({address:r.address,family:r.family as 4|6}));
      if(options.all) callback(null,answers); else callback(null,answers[0].address,answers[0].family);
    }}});
    try {
      const response=await (dependencies.request??pinnedFetch)(url,{dispatcher,redirect:'manual',signal,headers:{accept:'image/jpeg,image/png,image/webp','accept-encoding':'identity'}});
      if([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get('location'); await response.body?.cancel();
        if(!location || redirects===3) throw new Error('Too many image redirects');
        url=imageSourceUrl(new URL(location,url).href); continue;
      }
      if(!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Image download failed'); }
      const length=Number(response.headers.get('content-length'));
      if(length>MAX_IMAGE_BYTES) { await response.body.cancel(); throw new Error('Image too large'); }
      // Actual decoder validation follows; HTML is never scraped for another URL.
      return await readLimited(response.body);
    } finally { await dispatcher.destroy(); }
  }
  throw new Error('Image redirect limit');
}
