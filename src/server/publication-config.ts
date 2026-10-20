import { z } from 'zod';
import { loadBackendConfig,type BackendConfig } from './config';
export interface PublicationConfig {backend:BackendConfig;origin:string;tokenSecret:string;mailKey:string;from:string;administrators:string[];testAllowlist:string[]}
const emailList=(value:string|undefined)=>z.array(z.email()).min(1).parse((value??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean));
export function loadPublicationConfig(env:NodeJS.ProcessEnv=process.env):PublicationConfig{
  try{
    const backend=loadBackendConfig(env),site=new URL(env.SITE_URL??'');
    if(site.username||site.password||site.search||site.hash||site.pathname!=='/'||
      (site.protocol!=='https:' && !(backend.APP_ENV==='testing' && site.protocol==='http:' && ['localhost','127.0.0.1'].includes(site.hostname))))throw new Error();
    const tokenSecret=z.string().regex(/^[a-f0-9]{64}$/).parse(env.VERIFICATION_TOKEN_SECRET);
    const mailKey=z.string().min(1).parse(env.EMAIL_PROVIDER_API_KEY);
    const from=z.string().min(1).max(254).refine(v=>!/[\r\n]/.test(v)).parse(env.FROM_EMAIL);
    const administrators=emailList(env.NOTIFICATION_EMAILS);
    const testAllowlist=backend.APP_ENV==='testing'?emailList(env.TEST_EMAIL_ALLOWLIST):[];
    const config={backend,origin:site.origin,tokenSecret,mailKey,from,administrators,testAllowlist};
    assertMailRecipients(config,administrators);return config;
  }catch{throw new Error('Invalid publication configuration; check server variables and testing mail allowlist');}
}
export function assertMailRecipients(config:PublicationConfig,recipients:string[]){
  if(!recipients.length||recipients.some(v=>!z.email().safeParse(v).success))throw new Error('Invalid mail recipients');
  if(config.backend.APP_ENV==='testing' && recipients.some(v=>!config.testAllowlist.includes(v.trim().toLowerCase())))throw new Error('Testing email recipient is not allowlisted');
}
