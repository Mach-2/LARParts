import {z} from 'zod';

export async function verifyTurnstile(input:{secret:string;token:string;ip:string;origin:string;action:'profile-image'|'profile-submit'},fetcher:typeof fetch=fetch):Promise<boolean>{
  if(!input.secret||!input.token)return false;
  try{
    const response=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',
      body:new URLSearchParams({secret:input.secret,response:input.token,remoteip:input.ip}),signal:AbortSignal.timeout(10000)});
    const result=z.object({success:z.boolean(),hostname:z.string().optional(),action:z.string().optional()}).parse(await response.json());
    return response.ok&&result.success&&result.hostname===new URL(input.origin).hostname&&result.action===input.action;
  }catch{return false;}
}
