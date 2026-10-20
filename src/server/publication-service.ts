import { createHash,createHmac,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GetObjectCommand,PutObjectCommand,HeadObjectCommand,DeleteObjectCommand } from '@aws-sdk/client-s3';
import { publicProfileSubmissionSchema } from '../data/profileSubmission';
import { createStorageClient } from './storage';
import { readLimited } from './remote-image';
import { capabilityHash } from './image-service';
import { assertMailRecipients,type PublicationConfig } from './publication-config';

export const submissionSchema=z.object({
  requestId:z.uuid(),capability:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  profile:publicProfileSubmissionSchema.omit({photoUrl:true}),
  submitterEmail:z.string().trim().max(254).pipe(z.email()).transform(v=>v.toLowerCase()),consent:z.literal(true),upgradeNotifications:z.boolean(),
  companyWebsite:z.literal(''),image:z.object({sessionId:z.uuid(),capability:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().nullable(),
}).strict();
export type VerifiedSubmission=z.infer<typeof submissionSchema>;
export type PublicationRpc=(action:string,id?:string,hash?:string,data?:Record<string,unknown>)=>Promise<unknown>;
export function createPublicationRpc(config:PublicationConfig):PublicationRpc{
  return async(action,id,hash,data={})=>{
    const response=await fetch(new URL('/rest/v1/rpc/publication_operation',config.backend.SUPABASE_URL),{
      method:'POST',headers:{apikey:config.backend.SUPABASE_SECRET_KEY,'content-type':'application/json'},
      body:JSON.stringify({p_action:action,p_id:id??null,p_hash:hash??null,p_data:data}),cache:'no-store',signal:AbortSignal.timeout(15000),
    });
    if(!response.ok){
      let code='RPC_FAILED';try{const body=await response.json() as {code?:string};if(body.code&&/^[A-Z0-9]{5}$/.test(body.code))code=`RPC_${body.code}`;}catch{}
      throw Object.assign(new Error('Publication operation unavailable'),{code});
    }return response.json();
  };
}
export function verificationToken(secret:string,id:string){return createHmac('sha256',Buffer.from(secret,'hex')).update(`profile-confirmation-v1/${id}`).digest('base64url');}
const intentSchema=z.object({submission_id:z.uuid(),asset_id:z.uuid(),bucket:z.string(),object_key:z.string(),lease_id:z.uuid(),digest:z.string().nullable()});
const sourceSchema=z.object({bucket:z.string(),object_key:z.string(),visibility:z.literal('temporary'),processing_state:z.literal('processed'),byte_size:z.number(),width:z.number(),height:z.number(),content_type:z.literal('image/webp')});
const claimSchema=z.object({state:z.literal('claimed'),submissionId:z.uuid(),intent:intentSchema,source:sourceSchema.nullable()});
const resultSchema=z.object({state:z.enum(['published','processing','conflict']),artistId:z.string().optional()});
const jobSchema=z.object({id:z.uuid(),submission_id:z.uuid(),kind:z.enum(['confirmation','administrator']),token_id:z.uuid().nullable(),lease_id:z.uuid(),deduplication_key:z.string(),payload:z.object({from:z.string(),to:z.array(z.email()),origin:z.url(),displayName:z.string(),artistId:z.string().optional()})});
export type PublicationJob=z.infer<typeof jobSchema>;
export type MailSender=(body:{from:string;to:string[];subject:string;text:string},key:string)=>Promise<void>;
export function buildPublicationMail(config:PublicationConfig,job:PublicationJob){
  assertMailRecipients(config,job.payload.to);
  if(job.payload.origin!==config.origin)throw new Error('Queued mail origin differs from server configuration');
  if(job.kind==='confirmation'){
    if(!job.token_id)throw new Error('Missing verification record');
    const token=verificationToken(config.tokenSecret,job.token_id);
    const link=`${job.payload.origin}/confirm-profile#${job.submission_id}.${token}`;
    return {from:job.payload.from,to:job.payload.to,subject:'Confirm your LARParts profile',text:`This email address was used to submit a LARParts.com profile for ${job.payload.displayName}.\n\nPlease open this link and press 'Confirm publication' to add your profile to the website:\n${link}\n\nThe link expires in 24 hours. If you did not submit this profile, ignore this email.`};
  }
  if(!job.payload.artistId)throw new Error('Missing public artist reference');
  return {from:job.payload.from,to:job.payload.to,subject:`LARParts profile published: ${job.payload.displayName}`,text:`A new artist profile was added to the website!\n\nArtist: ${job.payload.displayName}\nPublished profile: ${job.payload.origin}/artists/${encodeURIComponent(job.payload.artistId)}/`};
}

export class PublicationService{
  private temporary;private published;
  constructor(public readonly config:PublicationConfig,public readonly rpc:PublicationRpc=createPublicationRpc(config),private sender?:MailSender){
    this.temporary=createStorageClient(config.backend,'temporary');this.published=createStorageClient(config.backend,'published');
  }
  close(){this.temporary.client.destroy();this.published.client.destroy();}
  private mailContext(to:string[]){assertMailRecipients(this.config,to);return{from:this.config.from,to,origin:this.config.origin};}
  private tokenRecord(){const tokenId=randomUUID();return{tokenId,tokenHash:capabilityHash(verificationToken(this.config.tokenSecret,tokenId))};}
  async submit(value:unknown){
    const input=submissionSchema.parse(value);assertMailRecipients(this.config,[input.submitterEmail]);
    const body={profile:input.profile,email:input.submitterEmail,upgradeNotifications:input.upgradeNotifications,imageSessionId:input.image?.sessionId??null,imageHash:input.image?capabilityHash(input.image.capability):null};
    const requestHash=capabilityHash(JSON.stringify(body));
    const result=await this.rpc('submit',input.requestId,capabilityHash(input.capability),{...body,requestHash,...this.tokenRecord(),temporaryBucket:this.config.backend.R2_TEMPORARY_BUCKET,mail:this.mailContext([input.submitterEmail])});
    return z.object({state:z.string(),submissionId:z.uuid()}).parse(result);
  }
  async resend(id:string,capability:string){return this.rpc('resend',id,capabilityHash(capability),{...this.tokenRecord(),mail:this.mailContext(this.config.administrators)});}
  async status(id:string,capability:string){return z.object({state:z.string(),artistId:z.string().nullable()}).parse(await this.rpc('status',id,capabilityHash(capability)));}
  async confirm(id:string,token:string){return this.finishClaim(await this.rpc('confirm_claim',id,capabilityHash(token),{publishedBucket:this.published.bucket}));}
  async recoverOne(){const claim=await this.rpc('recover_claim');return claim?this.finishClaim(claim):null;}
  private async finishClaim(value:unknown){
    if((value as {state?:string})?.state!=='claimed')return resultSchema.parse(value);
    const claim=claimSchema.parse(value),intent=claim.intent;
    if(intent.bucket!==this.published.bucket || intent.object_key!==`profiles/${claim.submissionId}.webp`)throw new Error('Invalid publication target');
    if(claim.source){
      if(claim.source.bucket!==this.temporary.bucket || !claim.source.object_key.startsWith('processed/'))throw new Error('Invalid publication source');
      const source=await this.temporary.client.send(new GetObjectCommand({Bucket:this.temporary.bucket,Key:claim.source.object_key}),{abortSignal:AbortSignal.timeout(15000)});
      if(!source.Body || source.ContentLength!==claim.source.byte_size)throw new Error('Processed image unavailable');
      const bytes=await readLimited(source.Body as AsyncIterable<Uint8Array>);
      if(bytes.length!==claim.source.byte_size)throw new Error('Incomplete processed image');
      const digest=createHash('sha256').update(bytes).digest('hex');
      await this.rpc('digest',claim.submissionId,undefined,{lease:intent.lease_id,digest});
      try{
        await this.published.client.send(new PutObjectCommand({Bucket:this.published.bucket,Key:intent.object_key,Body:bytes,ContentType:'image/webp',CacheControl:'public, max-age=31536000, immutable',StorageClass:'STANDARD',IfNoneMatch:'*',Metadata:{sha256:digest}}),{abortSignal:AbortSignal.timeout(15000)});
      }catch(error){
        if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;
        const existing=await this.published.client.send(new HeadObjectCommand({Bucket:this.published.bucket,Key:intent.object_key}));
        if(existing.Metadata?.sha256!==digest || existing.ContentLength!==bytes.length || existing.ContentType!=='image/webp')throw new Error('Promoted image mismatch');
      }
    }
    return resultSchema.parse(await this.rpc('commit',claim.submissionId,undefined,{lease:intent.lease_id,mail:this.mailContext(this.config.administrators)}));
  }
  async deliver(id?:string){
    const jobs=z.array(jobSchema).parse(await this.rpc('mail_claim',id));let sent=0,failed=0;const errorCodes:string[]=[];
    for(const job of jobs){
      try{
        const body=buildPublicationMail(this.config,job);
        if(this.sender)await this.sender(body,job.deduplication_key);
        else{
          const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${this.config.mailKey}`,'content-type':'application/json','idempotency-key':job.deduplication_key},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
          if(!response.ok){
            let category='provider_rejected';
            try{
              const error=await response.json() as {message?:string};const message=error.message??'';
              if(/domain.*not verified|verify.*domain/i.test(message))category='sender_domain_unverified';
              else if(/only send testing|own email address/i.test(message))category='testing_recipient_restricted';
              else if(/api.key|unauthorized/i.test(message))category='provider_credentials';
            }catch{}
            throw Object.assign(new Error('Delivery failed'),{code:`mail_http_${response.status}_${category}`});
          }
        }
        await this.rpc('mail_done',job.id,undefined,{lease:job.lease_id});sent++;
      }catch(error){failed++;const code=(error as {code?:string}).code;errorCodes.push(code&&/^mail_http_\d{3}_[a-z_]+$/.test(code)?code:'delivery_failed');await this.rpc('mail_retry',job.id,undefined,{lease:job.lease_id}).catch(()=>{});}
    }
    return{sent,failed,errorCodes};
  }
  async maintenance(){
    await this.rpc('maintenance');let recovered=0,failed=0;
    for(let i=0;i<3;i++){try{if(!await this.recoverOne())break;recovered++;}catch{failed++;}}
    const orphans=z.array(intentSchema).parse(await this.rpc('orphan_claim'));
    for(const intent of orphans){
      try{
        if(intent.bucket!==this.published.bucket || intent.object_key!==`profiles/${intent.submission_id}.webp`)throw new Error('Invalid orphan target');
        await this.published.client.send(new DeleteObjectCommand({Bucket:this.published.bucket,Key:intent.object_key}));
        await this.rpc('orphan_done',intent.submission_id,undefined,{lease:intent.lease_id});
      }catch{failed++;}
    }
    const mail=await this.deliver();return{recovered,sent:mail.sent,failed:failed+mail.failed};
  }
}
