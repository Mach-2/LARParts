import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';
import { PutObjectCommand,DeleteObjectCommand,GetObjectCommand,ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadBackendConfig } from '../src/server/config';
import { createStorageClient } from '../src/server/storage';
import { ImageService } from '../src/server/image-service';

const config=loadBackendConfig();
if(config.APP_ENV!=='testing')throw new Error('Image probes require testing');
let target:URL;try{target=new URL(process.env.TEST_DATABASE_URL??'');}catch{throw new Error('Testing database URI required');}
if(!(target.hostname===`db.${config.BACKEND_TESTING_SUPABASE_REF}.supabase.co` ||
  (target.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(target.username)===`postgres.${config.BACKEND_TESTING_SUPABASE_REF}`)))throw new Error('Testing project pin mismatch');
const ca=process.env.TEST_DATABASE_CA_FILE?await readFile(process.env.TEST_DATABASE_CA_FILE,'utf8'):undefined;
const sql=postgres(target.href,{ssl:ca?{ca,rejectUnauthorized:true}:'verify-full',max:1,connect_timeout:10,onnotice:()=>{}});
const service=new ImageService(config),temporary=createStorageClient(config,'temporary'),published=createStorageClient(config,'published');
const ids:string[]=[];const sourceKey=`image-ingestion-probes/${randomUUID()}.png`;
let stage='source setup',failed=false;
const digest=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
try{
  const image=await sharp({create:{width:32,height:16,channels:3,background:'orange'}}).png().withMetadata({orientation:6}).toBuffer();
  await published.client.send(new PutObjectCommand({Bucket:published.bucket,Key:sourceKey,Body:image,ContentType:'image/png',CacheControl:'no-store',StorageClass:'STANDARD'}));
  stage='presigned upload';
  const upload=await service.start('upload',image.length,'image/png');ids.push(upload.sessionId);
  const signedHeaders=new URL(upload.uploadUrl!).searchParams.get('X-Amz-SignedHeaders')??'';
  assert.ok(signedHeaders.includes('content-length') && signedHeaders.includes('content-type'));
  const origin=new URL(process.env.SITE_URL??'').origin;
  const preflight=await fetch(upload.uploadUrl!,{method:'OPTIONS',headers:{origin,'access-control-request-method':'PUT','access-control-request-headers':'content-type'},signal:AbortSignal.timeout(10000)});
  assert.equal(preflight.headers.get('access-control-allow-origin'),origin,'Testing upload CORS must match SITE_URL');
  const denied=await fetch(upload.uploadUrl!,{method:'OPTIONS',headers:{origin:'https://unapproved.example','access-control-request-method':'PUT','access-control-request-headers':'content-type'},signal:AbortSignal.timeout(10000)});
  assert.notEqual(denied.headers.get('access-control-allow-origin'),'https://unapproved.example');
  const wrongType=await fetch(upload.uploadUrl!,{method:'PUT',headers:{'content-type':'image/jpeg'},body:image,signal:AbortSignal.timeout(10000)});
  assert.equal(wrongType.status,403,'Upload MIME header must be signature-bound');
  let put=await fetch(upload.uploadUrl!,{method:'PUT',headers:{'content-type':'image/png'},body:image,signal:AbortSignal.timeout(10000)});assert.ok(put.ok);
  stage='upload processing and private preview';
  const preview=await service.process(upload.sessionId,upload.capability);
  let response=await fetch(preview.previewUrl,{headers:{origin},signal:AbortSignal.timeout(10000)});assert.ok(response.ok);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  const processed=Buffer.from(await response.arrayBuffer());const meta=await sharp(processed).metadata();
  assert.equal(meta.format,'webp');assert.equal(meta.width,16);assert.equal(meta.height,32);assert.equal(meta.exif,undefined);
  const unsigned=new URL(preview.previewUrl);unsigned.search='';
  assert.ok(!(await fetch(unsigned,{signal:AbortSignal.timeout(10000)})).ok,'Processed copy must be private');
  await assert.rejects(service.preview(upload.sessionId,'wrong-capability'));
  const expired=await getSignedUrl(temporary.client,new GetObjectCommand({Bucket:temporary.bucket,Key:`processed/${upload.sessionId}/${(await service.get(upload.sessionId,upload.capability)).lease_id}.webp`}),{expiresIn:60,signingDate:new Date(Date.now()-600000)});
  assert.equal((await fetch(expired,{signal:AbortSignal.timeout(10000)})).status,403);
  stage='upload URL reuse isolation';
  put=await fetch(upload.uploadUrl!,{method:'PUT',headers:{'content-type':'image/png'},body:Buffer.alloc(image.length),signal:AbortSignal.timeout(10000)});assert.ok(put.ok);
  const repeated=await service.process(upload.sessionId,upload.capability);assert.equal(repeated.assetId,preview.assetId);
  response=await fetch(repeated.previewUrl,{signal:AbortSignal.timeout(10000)});assert.equal(digest(new Uint8Array(await response.arrayBuffer())),digest(processed));
  stage='direct HTTPS ingestion';
  const remote=await service.start('remote');ids.push(remote.sessionId);
  const fromUrl=await service.process(remote.sessionId,remote.capability,`${config.R2_PUBLIC_BASE_URL.replace(/\/$/,'')}/${sourceKey}`);
  response=await fetch(fromUrl.previewUrl,{signal:AbortSignal.timeout(10000)});assert.ok(response.ok);
  assert.equal(digest(new Uint8Array(await response.arrayBuffer())),digest(processed));
  stage='private processed-copy checks';
  const rows=await sql`select id,visibility,processing_state from private.image_assets where id in (${upload.sessionId}::uuid,${remote.sessionId}::uuid)`;
  assert.equal(rows.length,2);for(const row of rows){assert.equal(row.visibility,'temporary');assert.equal(row.processing_state,'processed');}
  console.log('PASS: live upload/direct-HTTPS ingestion, metadata removal, private preview, capability denial, expired signatures, raw overwrite isolation, CORS allow/deny');
}catch{
  failed=true;console.error(`FAIL: testing image ingestion at ${stage}; details withheld to protect capabilities`);
}finally{
  try{
    for(const id of ids)await sql`update private.image_sessions set expires_at=now()-interval '1 second',lease_until=now()-interval '1 second' where id=${id}::uuid`;
    const cleaned=await service.cleanup();assert.equal(cleaned.failed,0);
    for(const id of ids){
      const rows=await sql`select state from private.image_sessions where id=${id}::uuid`;assert.equal(rows[0]?.state,'deleted');
      for(const prefix of [`raw/${id}/`,`processed/${id}/`])assert.equal((await temporary.client.send(new ListObjectsV2Command({Bucket:temporary.bucket,Prefix:prefix}))).Contents?.length??0,0);
      await sql`delete from private.image_sessions where id=${id}::uuid`;
      await sql`delete from private.image_assets where id=${id}::uuid`;
    }
    await published.client.send(new DeleteObjectCommand({Bucket:published.bucket,Key:sourceKey}));
    console.log('PASS: expired-session cleanup and synthetic fixture removal');
  }catch{failed=true;console.error('FAIL: testing fixture cleanup; inspect temporary session prefixes and image-ingestion-probes in testing');}
  service.close();temporary.client.destroy();published.client.destroy();await sql.end({timeout:5});
  if(failed)process.exitCode=1;
}
