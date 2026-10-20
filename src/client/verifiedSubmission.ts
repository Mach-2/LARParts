import type {ProfileSubmission} from '../data/profileSubmission';
import type {PreparedImage} from './profileImage';
import {z} from 'zod';

export interface PendingSubmission{requestId:string;capability:string;profile:Omit<ProfileSubmission['profile'],'photoUrl'>;submitterEmail:string;consent:true;upgradeNotifications:boolean;companyWebsite:'';image:{sessionId:string;capability:string}|null}
export function prepareVerifiedSubmission(value:Omit<PendingSubmission,'requestId'|'capability'|'image'>,image:PreparedImage|null):PendingSubmission{
  const capability=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  return {...value,requestId:crypto.randomUUID(),capability,image:image?{sessionId:image.sessionId,capability:image.capability}:null};
}
async function operation(body:unknown,capability?:string){
  const response=await fetch('/api/verified-profile',{method:'POST',headers:{'content-type':'application/json',...(capability?{authorization:`Bearer ${capability}`}:{})},body:JSON.stringify(body),credentials:'same-origin',cache:'no-store'});
  if(!response.ok){
    const feedback=z.object({code:z.string(),retryAfter:z.number().int().min(1).max(3600).optional(),limit:z.number().int().min(1).max(60).optional()});
    let detail:z.infer<typeof feedback>|undefined;
    try{const parsed=feedback.safeParse(await response.json());if(parsed.success)detail=parsed.data;}catch{}
    const wait=detail?.retryAfter?`Please try again in ${Math.ceil(detail.retryAfter/60)} minute${detail.retryAfter>60?'s':''}.`:'Please try again after the next hour begins.';
    const message=response.status===429&&detail?.code==='resend_cooldown'?`Please wait five minutes between confirmation emails. ${detail.retryAfter?wait:'Please try again in five minutes.'}`:
      response.status===409&&detail?.code==='resend_limit'?'You have used all three resends for this submission. Please use the latest confirmation email or contact us for help.':
      response.status===409&&detail?.code==='resend_unavailable'?'This submission can no longer receive confirmation emails. Check its status or contact us for help.':
      response.status===429&&detail?.code==='hourly_email_limit'?`This email address has reached the limit of three confirmation requests per hour. ${wait}`:
      response.status===429&&detail?.code==='hourly_ip_limit'?`This connection has reached its hourly request limit${detail.limit?` (${detail.limit} attempts)`:''}. ${wait}`:
      response.status===429?'Too many requests. Please try again after the next hour begins.':
      response.status===503?'Submissions are temporarily unavailable. Please keep this page open and try again later.':
      response.status===403?'The verification check failed. Please use the correct site address and try again.':
      'The request could not finish. Keep your submission open and try again.';
    throw new Error(`${message} (HTTP ${response.status})`);
  }
  return response.json();
}
// Retain the PendingSubmission in memory and reuse it on retries; regenerating it
// would create another request identity. No capability grants later editing.
export const submitVerifiedProfile=(submission:PendingSubmission,turnstileToken:string)=>operation({action:'submit',submission,turnstileToken});
export const resendProfileConfirmation=(submission:PendingSubmission,turnstileToken:string)=>operation({action:'resend',submissionId:submission.requestId,turnstileToken},submission.capability);
export const getSubmissionStatus=(submission:PendingSubmission)=>operation({action:'status',submissionId:submission.requestId},submission.capability);
