import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { loadBackendConfig } from '../src/server/config';
import { createStorageClient } from '../src/server/storage';

const config = loadBackendConfig();
if (config.APP_ENV !== 'testing') throw new Error('Storage probes require testing');
const temporary = createStorageClient(config,'temporary');
const published = createStorageClient(config,'published');
const key = `foundation-probes/${randomUUID()}.txt`;
const body = 'Synthetic step 2 storage boundary probe';
async function denied(action: () => Promise<unknown>) {
  try { await action(); } catch (error) {
    // A missing object or transport failure is not evidence of access denial.
    const e = error as { $metadata?: { httpStatusCode?: number }; name?: string };
    assert.equal(e.$metadata?.httpStatusCode,403,'Expected explicit cross-bucket denial');
    return;
  }
  throw new Error('Cross-bucket operation unexpectedly allowed');
}
let failed = false;
let stage = 'own-bucket write/read';
try {
  for (const target of [temporary,published]) {
    await target.client.send(new PutObjectCommand({Bucket:target.bucket,Key:key,Body:body,ContentType:'text/plain',StorageClass:'STANDARD'}));
    const result = await target.client.send(new GetObjectCommand({Bucket:target.bucket,Key:key}));
    assert.equal(await result.Body?.transformToString(),body);
  }
  for (const [source,destination] of [[temporary,published],[published,temporary]]) {
    stage = 'cross-bucket denial';
    await denied(() => source.client.send(new GetObjectCommand({Bucket:destination.bucket,Key:key})));
    await denied(() => source.client.send(new PutObjectCommand({Bucket:destination.bucket,Key:key,Body:body})));
    await denied(() => source.client.send(new DeleteObjectCommand({Bucket:destination.bucket,Key:key})));
  }
  const endpoint = `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${temporary.bucket}/${key}`;
  stage = 'unsigned temporary S3 read';
  const unauthenticated = await fetch(endpoint,{signal:AbortSignal.timeout(15000),redirect:'error'});
  const unsignedBody = await unauthenticated.text();
  const unsignedCode = unsignedBody.match(/<Code>([A-Za-z]+)<\/Code>/)?.[1];
  console.log(`Unsigned temporary S3 response: HTTP ${unauthenticated.status}, ${unsignedCode ?? 'unclassified'}`);
  assert.ok([401,403].includes(unauthenticated.status) ||
    (unauthenticated.status === 400 && unsignedCode === 'InvalidArgument' && /Authorization/i.test(unsignedBody)),
    'Unsigned temporary S3 read must reject missing authorization');
  stage = 'published custom-domain delivery';
  const publicCopy = await fetch(`${config.R2_PUBLIC_BASE_URL.replace(/\/$/,'')}/${key}`,{signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store'});
  assert.equal(publicCopy.status,200,'Published custom domain must serve probe');
  assert.equal(await publicCopy.text(),body);
  console.log('PASS: testing R2 own-bucket read/write, cross-bucket read/write/delete denial, unsigned S3 denial and public delivery');
  console.log('PENDING: Cloudflare dashboard inspection must confirm temporary bucket has no custom domains or r2.dev exposure. S3 denial alone cannot prove that.');
} catch (error) {
  failed = true;
  const code = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  const cause = (error as { cause?: { code?: string } }).cause?.code;
  if (cause && /^[A-Z0-9_]{1,50}$/.test(cause)) console.error(`Network code: ${cause}`);
  console.error(`FAIL: testing R2 ${stage}${code ? ` (HTTP ${code})` : ''}; provider details suppressed to protect credentials`);
} finally {
  for (const target of [temporary,published]) {
    try {
      await target.client.send(new DeleteObjectCommand({Bucket:target.bucket,Key:key}));
      try { await target.client.send(new HeadObjectCommand({Bucket:target.bucket,Key:key})); throw new Error('Probe still exists'); }
      catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error; }
    } catch { failed = true; console.error('FAIL: probe cleanup; remove foundation-probes objects in testing buckets'); }
    target.client.destroy();
  }
  if (failed) process.exitCode=1;
}
