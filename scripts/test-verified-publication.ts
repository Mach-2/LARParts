import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import sharp from 'sharp';
import {HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {loadPublicationConfig} from '../src/server/publication-config';
import {PublicationService,createPublicationRpc,verificationToken,type VerifiedSubmission} from '../src/server/publication-service';
import {ImageService} from '../src/server/image-service';
import {createStorageClient} from '../src/server/storage';
import {confirmationPage} from '../src/server/publication-handler';

const config=loadPublicationConfig();if(config.backend.APP_ENV!=='testing')throw new Error('Publication probes require testing');
let url:URL;try{url=new URL(process.env.TEST_DATABASE_URL??'');}catch{throw new Error('Testing database URI required');}
const ref=config.backend.BACKEND_TESTING_SUPABASE_REF;
if(!(url.hostname===`db.${ref}.supabase.co`||(url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username)===`postgres.${ref}`)))throw new Error('Testing database pin mismatch');
const ca=process.env.TEST_DATABASE_CA_FILE?await readFile(process.env.TEST_DATABASE_CA_FILE,'utf8'):undefined;
const sql=postgres(url.href,{ssl:ca?{ca,rejectUnauthorized:true}:'verify-full',max:2,connect_timeout:10,onnotice:()=>{}});
const rpc=createPublicationRpc(config);let failCommit:'before'|'after'|'none'='before';
const skipMail=process.argv.includes('--skip-mail');
const service=new PublicationService(config,async(...args)=>{
  if(args[0]==='commit'&&failCommit==='before'){failCommit='after';throw new Error('Injected database outage after R2 promotion');}
  const result=await rpc(...args);
  if(args[0]==='commit'&&failCommit==='after'){failCommit='none';throw new Error('Injected lost successful commit response');}
  return result;
},skipMail?async()=>{}:undefined);
const images=new ImageService(config.backend),published=createStorageClient(config.backend,'published');
const ids:string[]=[],sessionIds:string[]=[];let stage='setup',failed=false;
const name=`Synthetic publication ${randomUUID()}`;
const fixture=(image:VerifiedSubmission['image']):VerifiedSubmission=>({requestId:randomUUID(),capability:randomBytes(32).toString('base64url'),profile:{displayName:name,kingdom:'Northern Lights',homePark:'Testing only',skills:['Sewing'],awards:[],contact:{},memberSince:undefined},submitterEmail:config.testAllowlist[0],consent:true,upgradeNotifications:false,companyWebsite:'',image});
async function imageSlot(){
  const bytes=await sharp({create:{width:32,height:16,channels:3,background:'purple'}}).png().toBuffer();
  const slot=await images.start('upload',bytes.length,'image/png');sessionIds.push(slot.sessionId);
  const response=await fetch(slot.uploadUrl!,{method:'PUT',headers:{'content-type':'image/png'},body:bytes,signal:AbortSignal.timeout(10000)});assert.ok(response.ok);
  await images.process(slot.sessionId,slot.capability);return{sessionId:slot.sessionId,capability:slot.capability};
}
try{
  stage='processed image setup';const photo=await imageSlot(),otherPhoto=await imageSlot();
  const main=fixture(photo),other=fixture(otherPhoto);ids.push(main.requestId,other.requestId);
  stage='image binding and submission retry';
  await assert.rejects(service.submit({...main,image:{...photo,capability:'x'.repeat(43)}}));
  await service.submit(main);await service.submit(main);await service.submit(other);
  await assert.rejects(service.submit({...fixture(photo),requestId:randomUUID()}));
  assert.equal(Number((await sql`select count(*) from private.submissions where id=${main.requestId}::uuid`)[0].count),1);
  stage='scanner-safe GET';confirmationPage();
  assert.equal(Number((await sql`select count(*) from public.artist_profiles where profile->>'displayName'=${name}`)[0].count),0);
  stage='allowlisted confirmation delivery';const delivered=await service.deliver(main.requestId);if(delivered.failed)console.error('Safe mail failure categories:',delivered.errorCodes.join(','));assert.equal(delivered.sent,1);assert.equal(delivered.failed,0);
  const tokens=await sql`select id,submission_id from private.verification_tokens where submission_id in (${main.requestId}::uuid,${other.requestId}::uuid)`;
  const token=(id:string)=>verificationToken(config.tokenSecret,tokens.find(t=>t.submission_id===id)!.id);
  stage='concurrent confirmation and R2-before-database failure';
  await assert.rejects(service.confirm(main.requestId,'z'.repeat(43)));
  const concurrent=await Promise.allSettled([service.confirm(main.requestId,token(main.requestId)),service.confirm(main.requestId,token(main.requestId))]);
  assert.ok(concurrent.some(r=>r.status==='rejected'));assert.ok(concurrent.some(r=>r.status==='fulfilled'&&r.value.state==='processing'));
  assert.equal(Number((await sql`select count(*) from public.artist_profiles where profile->>'displayName'=${name}`)[0].count),0);
  assert.equal((await sql`select consumed_at from private.verification_tokens where submission_id=${main.requestId}::uuid`)[0].consumed_at,null);
  await sql`update private.publication_intents set lease_until=now()-interval '1 second' where submission_id=${main.requestId}::uuid`;
  stage='recover promotion and lost commit response';await assert.rejects(service.recoverOne());
  const result=await service.confirm(main.requestId,token(main.requestId));assert.equal(result.state,'published');
  const artist=(await sql`select * from public.artist_profiles where id=${result.artistId!}`)[0];assert.ok(artist);
  assert.ok(!JSON.stringify(artist).includes(config.testAllowlist[0]));assert.ok(!JSON.stringify(artist).includes(token(main.requestId)));
  assert.equal(Number((await sql`select count(*) from private.notification_jobs where submission_id=${main.requestId}::uuid and kind='administrator'`)[0].count),1);
  assert.equal(Number((await sql`select count(*) from public.artist_profiles where profile->>'displayName'=${name}`)[0].count),1);
  stage='published R2 delivery';
  const publicImage=await fetch(`${config.backend.R2_PUBLIC_BASE_URL.replace(/\/$/,'')}/${artist.photo_key}`,{signal:AbortSignal.timeout(10000)});assert.equal(publicImage.status,200);assert.equal((await sharp(Buffer.from(await publicImage.arrayBuffer())).metadata()).format,'webp');
  stage='administrator notice delivery';assert.equal((await service.deliver(main.requestId)).sent,1);assert.equal((await service.deliver(main.requestId)).sent,0);
  stage='duplicate identity and orphan promotion';
  const conflict=await service.confirm(other.requestId,token(other.requestId));assert.equal(conflict.state,'conflict');
  stage='orphan state and promoted-object existence';
  const orphan=(await sql`select * from private.publication_intents where submission_id=${other.requestId}::uuid`)[0];assert.equal(orphan.state,'orphan');
  assert.ok(await published.client.send(new HeadObjectCommand({Bucket:published.bucket,Key:orphan.object_key})));
  await sql`update private.publication_intents set cleanup_after=now()-interval '1 second' where submission_id=${other.requestId}::uuid`;
  // Do not drain unrelated mail during a fixture cleanup; only test the orphan worker.
  stage='orphan cleanup lease';
  const claimed=await rpc('orphan_claim') as Array<{submission_id:string;object_key:string;lease_id:string}>;
  const target=claimed.find(x=>x.submission_id===other.requestId);assert.ok(target);
  stage='orphan deletion and finalization';
  await published.client.send(new DeleteObjectCommand({Bucket:published.bucket,Key:target.object_key}));
  await rpc('orphan_done',target.submission_id,undefined,{lease:target.lease_id});
  stage='orphan absence and committed-object retention';
  await assert.rejects(published.client.send(new HeadObjectCommand({Bucket:published.bucket,Key:target.object_key})),(e:unknown)=>(e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404);
  assert.ok(await published.client.send(new HeadObjectCommand({Bucket:published.bucket,Key:`profiles/${main.requestId}.webp`})),'Committed object must survive orphan cleanup');
  console.log('PASS: live atomic image binding, idempotent submission, concurrent confirmation, R2 promotion recovery, lost commit response, exactly-one publication/outbox, duplicate conflict and orphan cleanup');
  console.log(skipMail?'NOTE: mail transport skipped for this boundary-test rerun':'PASS: confirmation and administrator emails accepted by Resend only for configured testing recipients; inbox receipt still requires user verification');
}catch(error){failed=true;const code=(error as{code?:string}).code;console.error(`FAIL: publication probe at ${stage}${code&&/^[A-Z0-9_]{1,50}$/.test(code)?` (${code})`:''}; private details suppressed`);}
finally{
  try{
    for(const id of ids){
      await sql.begin(async tx=>{
        await tx`select set_config('app.audit_actor','synthetic-step4-cleanup',true),set_config('app.audit_reason','Remove testing-only probe fixtures',true)`;
        await tx`update private.submissions set artist_id=null,image_asset_id=null,authorized_token_id=null where id=${id}::uuid`;
        await tx`delete from public.artist_profiles where id=${'artist-'+id.replaceAll('-','')}`;
        await tx`delete from private.notification_jobs where submission_id=${id}::uuid`;
        await tx`delete from private.verification_tokens where submission_id=${id}::uuid`;
        await tx`delete from private.image_assets where id in(select asset_id from private.publication_intents where submission_id=${id}::uuid)`;
        await tx`delete from private.publication_intents where submission_id=${id}::uuid`;
        await tx`update private.image_sessions set submission_id=null,expires_at=now()-interval '1 second',lease_until=now()-interval '1 second' where submission_id=${id}::uuid`;
        await tx`delete from private.submissions where id=${id}::uuid`;
        await tx`delete from private.profile_audit where artist_id=${'artist-'+id.replaceAll('-','')}`;
      });
      await published.client.send(new DeleteObjectCommand({Bucket:published.bucket,Key:`profiles/${id}.webp`}));
    }
    for(const id of sessionIds)await sql`update private.image_sessions set expires_at=now()-interval '1 second',lease_until=now()-interval '1 second' where id=${id}::uuid`;
    assert.equal((await images.cleanup()).failed,0);
    for(const id of sessionIds){await sql`delete from private.image_sessions where id=${id}::uuid`;await sql`delete from private.image_assets where id=${id}::uuid`;}
    console.log('PASS: synthetic publication, mail-job and image fixtures removed');
  }catch{failed=true;console.error('FAIL: publication fixture cleanup; inspect synthetic testing records privately');}
  service.close();images.close();published.client.destroy();await sql.end({timeout:5});if(failed)process.exitCode=1;
}
