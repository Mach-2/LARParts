import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PublicationService,verificationToken,buildPublicationMail,type PublicationRpc,type PublicationJob,submissionSchema} from '../src/server/publication-service';
import {assertMailRecipients,type PublicationConfig} from '../src/server/publication-config';
import {capabilityHash} from '../src/server/image-service';
import {confirmationPage,handlePublicationRequest,type PublicationDependencies} from '../src/server/publication-handler';
import {loadBackendConfig} from '../src/server/config';

const env={APP_ENV:'testing',SUPABASE_URL:'https://testref.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret',R2_ACCOUNT_ID:'a'.repeat(32),R2_TEMPORARY_BUCKET:'test-temporary',R2_PUBLISHED_BUCKET:'test-published',R2_TEMPORARY_ACCESS_KEY_ID:'temp',R2_TEMPORARY_SECRET_ACCESS_KEY:'temp-secret',R2_PUBLISHED_ACCESS_KEY_ID:'pub',R2_PUBLISHED_SECRET_ACCESS_KEY:'pub-secret',R2_PUBLIC_BASE_URL:'https://images.example.com',BACKEND_TESTING_SUPABASE_REF:'testref',BACKEND_PRODUCTION_SUPABASE_REF:'prodref',BACKEND_TESTING_TEMPORARY_BUCKET:'test-temporary',BACKEND_TESTING_PUBLISHED_BUCKET:'test-published',BACKEND_PRODUCTION_TEMPORARY_BUCKET:'prod-temporary',BACKEND_PRODUCTION_PUBLISHED_BUCKET:'prod-published'};
const config:PublicationConfig={backend:loadBackendConfig(env),origin:'https://example.com',tokenSecret:'b'.repeat(64),mailKey:'synthetic',from:'test@example.invalid',administrators:['test@example.invalid'],testAllowlist:['test@example.invalid']};
const fixture=(name='Synthetic Test')=>({requestId:randomUUID(),capability:'a'.repeat(43),profile:{displayName:name,kingdom:'Northern Lights',homePark:'Testing',skills:['Sewing'],awards:[],contact:{}},submitterEmail:'test@example.invalid',consent:true as const,upgradeNotifications:false,companyWebsite:'' as const,image:null});
async function database(){
  const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  const directory=new URL('../supabase/migrations/',import.meta.url);for(const file of (await readdir(directory)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,directory),'utf8'));
  const rpc:PublicationRpc=async(action,id,hash,data={})=>(await db.query<{result:unknown}>('select public.publication_operation($1,$2::uuid,$3,$4::jsonb) as result',[action,id??null,hash??null,JSON.stringify(data)])).rows[0].result;
  return{db,rpc};
}
test('submit retries, scanner GET, concurrent confirmations and ambiguous commit yield one profile/outbox event',async()=>{
  const {db,rpc}=await database();let loseCommit=true;const sent:Array<{text:string}>=[];
  const service=new PublicationService(config,async(...args)=>{const result=await rpc(...args);if(args[0]==='commit'&&loseCommit){loseCommit=false;throw new Error('Lost response after commit');}return result;},async body=>{sent.push(body);});
  try{
    const input=fixture();await service.submit(input);await service.submit(input);
    assert.equal((await db.query('select * from private.submissions')).rows.length,1);
    confirmationPage();assert.equal((await db.query('select * from public.artist_profiles')).rows.length,0);
    await service.deliver(input.requestId);assert.equal(sent.length,1);
    const tokenId=(await db.query<{id:string}>('select id from private.verification_tokens')).rows[0].id;
    const token=verificationToken(config.tokenSecret,tokenId);
    await assert.rejects(service.confirm(input.requestId,'c'.repeat(43)));
    await assert.rejects(service.confirm(input.requestId,token),/Lost response/);
    const results=await Promise.all([service.confirm(input.requestId,token),service.confirm(input.requestId,token)]);assert.ok(results.every(r=>r.state==='published'));
    assert.equal((await db.query('select * from public.artist_profiles')).rows.length,1);
    assert.equal((await db.query("select * from private.notification_jobs where kind='administrator'")).rows.length,1);
    await service.deliver(input.requestId);await service.deliver(input.requestId);assert.equal(sent.length,2);
    assert.ok(!JSON.stringify((await db.query('select * from public.artist_profiles')).rows).includes('test@example.invalid'));
    assert.ok(!JSON.stringify((await db.query('select * from private.verification_tokens')).rows).includes(token));
  }finally{service.close();await db.close();}
});
test('resend rotates tokens with cooldown, expired tokens fail and capability does not authorize publication',async()=>{
  const {db,rpc}=await database();const service=new PublicationService(config,rpc,async()=>{});
  try{
    const input=fixture();await service.submit(input);
    const first=(await db.query<{id:string}>('select id from private.verification_tokens')).rows[0].id;
    await assert.rejects(service.resend(input.requestId,input.capability));
    await db.query("update private.submissions set last_confirmation_at=now()-interval '6 minutes' where id=$1",[input.requestId]);
    await service.resend(input.requestId,input.capability);
    await assert.rejects(service.confirm(input.requestId,verificationToken(config.tokenSecret,first)));
    await assert.rejects(service.confirm(input.requestId,input.capability));
    const second=(await db.query<{id:string}>('select id from private.verification_tokens where revoked_at is null')).rows[0].id;
    await db.exec("update private.verification_tokens set created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour'");
    await assert.rejects(service.confirm(input.requestId,verificationToken(config.tokenSecret,second)));
    await assert.rejects(service.status(input.requestId,'b'.repeat(43)));
  }finally{service.close();await db.close();}
});
test('persisted authorization recovers after interrupted confirmation and duplicate identities do not overwrite',async()=>{
  const {db,rpc}=await database();const service=new PublicationService(config,rpc,async()=>{});
  try{
    const a=fixture(),b=fixture();await service.submit(a);await service.submit(b);
    const tokens=(await db.query<{id:string;submission_id:string}>('select id,submission_id from private.verification_tokens')).rows;
    const token=(id:string)=>verificationToken(config.tokenSecret,tokens.find(t=>t.submission_id===id)!.id);
    await rpc('confirm_claim',a.requestId,capabilityHash(token(a.requestId)),{publishedBucket:'test-published'});
    await db.exec("update private.publication_intents set lease_until=now()-interval '1 second'");
    assert.equal((await service.recoverOne())?.state,'published');
    assert.equal((await service.confirm(b.requestId,token(b.requestId))).state,'conflict');
    assert.equal((await db.query('select * from public.artist_profiles')).rows.length,1);
    assert.equal((await db.query("select * from private.publication_intents where state='orphan'")).rows.length,1);
    await rpc('maintenance');
    assert.deepEqual(await rpc('orphan_claim'),[],'Quarantine must protect recently failed publication writes');
    await db.exec("update private.publication_intents set cleanup_after=now()-interval '1 second' where state='orphan'");
    const orphans=await rpc('orphan_claim') as Array<{submission_id:string;lease_id:string}>;assert.equal(orphans.length,1);
    assert.deepEqual(await rpc('orphan_claim'),[],'Orphan deletion must have an exclusive lease');
    await rpc('orphan_done',orphans[0].submission_id,undefined,{lease:orphans[0].lease_id});
    assert.equal((await db.query("select * from private.publication_intents where state='deleted'")).rows.length,1);
  }finally{service.close();await db.close();}
});
test('mail retries retain idempotency keys, enforce allowlist at delivery and stop before provider dedup expiry',async()=>{
  const {db,rpc}=await database();let reject=true;const keys:string[]=[];
  const service=new PublicationService(config,rpc,async(_body,key)=>{keys.push(key);if(reject)throw new Error('Provider unavailable');});
  try{
    const input=fixture();await service.submit(input);assert.equal((await service.deliver(input.requestId)).failed,1);
    await db.exec('update private.notification_jobs set available_at=now()');reject=false;assert.equal((await service.deliver(input.requestId)).sent,1);assert.equal(keys[0],keys[1]);
    const other=fixture('Other Synthetic');await service.submit(other);
    await db.exec("update private.notification_jobs set first_attempt_at=now()-interval '24 hours',attempts=1 where state='pending'");
    assert.equal((await service.deliver(other.requestId)).sent,0);
    assert.ok((await db.query("select * from private.notification_jobs where last_error_code='retry_window_exhausted'")).rows.length);
    assert.throws(()=>assertMailRecipients(config,['outside@example.invalid']));
    const job:PublicationJob={id:randomUUID(),submission_id:randomUUID(),kind:'confirmation',token_id:randomUUID(),lease_id:randomUUID(),deduplication_key:'synthetic',payload:{origin:config.origin,from:config.from,to:['outside@example.invalid'],displayName:'Synthetic'}};
    assert.throws(()=>buildPublicationMail(config,job));
    await assert.rejects(service.submit({...fixture(),submitterEmail:'outside@example.invalid'}));
    assert.ok(!submissionSchema.safeParse({...fixture(),profile:{...fixture().profile,photoUrl:'https://example.com/unprocessed.jpg'}}).success);
  }finally{service.close();await db.close();}
});
test('confirmation HTML only POSTs from a submit event, removes fragment, has CSP and GET makes no API calls',async()=>{
  const page=confirmationPage();const html=await page.text();assert.match(html,/addEventListener\('submit'/);assert.match(html,/history.replaceState/);assert.match(page.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.equal(confirmationPage('HEAD').status,200);
  let calls=0;const deps={config,rpc:async()=>{calls++;return{allowed:true};},service:{},verifyBot:async()=>false} as unknown as PublicationDependencies;
  const body={action:'confirm',submissionId:randomUUID(),token:'a'.repeat(43)};
  assert.equal((await handlePublicationRequest(new Request(`${config.origin}/api/verified-profile`),'test-ip',deps)).status,405);assert.equal(calls,0);
  assert.equal((await handlePublicationRequest(new Request(`${config.origin}/api/verified-profile`,{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:JSON.stringify(body)}),'test-ip',deps)).status,403);assert.equal(calls,0);
});
