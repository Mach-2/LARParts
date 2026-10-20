import type {ProfileSubmission} from '../data/profileSubmission';
import type {PreparedImage} from './profileImage';

export interface PendingSubmission{requestId:string;capability:string;profile:Omit<ProfileSubmission['profile'],'photoUrl'>;submitterEmail:string;consent:true;upgradeNotifications:boolean;companyWebsite:'';image:{sessionId:string;capability:string}|null}
export function prepareVerifiedSubmission(value:Omit<PendingSubmission,'requestId'|'capability'|'image'>,image:PreparedImage|null):PendingSubmission{
  const capability=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  return {...value,requestId:crypto.randomUUID(),capability,image:image?{sessionId:image.sessionId,capability:image.capability}:null};
}
async function operation(body:unknown,capability?:string){
  const response=await fetch('/api/verified-profile',{method:'POST',headers:{'content-type':'application/json',...(capability?{authorization:`Bearer ${capability}`}:{})},body:JSON.stringify(body),credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('The request could not finish. Keep your submission open and try again.');return response.json();
}
// Retain the PendingSubmission in memory and reuse it on retries; regenerating it
// would create another request identity. No capability grants later editing.
export const submitVerifiedProfile=(submission:PendingSubmission,turnstileToken:string)=>operation({action:'submit',submission,turnstileToken});
export const resendProfileConfirmation=(submission:PendingSubmission,turnstileToken:string)=>operation({action:'resend',submissionId:submission.requestId,turnstileToken},submission.capability);
export const getSubmissionStatus=(submission:PendingSubmission)=>operation({action:'status',submissionId:submission.requestId},submission.capability);
