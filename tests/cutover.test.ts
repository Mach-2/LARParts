import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBackendConfig} from '../src/server/config';
import {loadPublicationConfig,assertMailRecipients} from '../src/server/publication-config';
import {importDatabaseTarget} from '../scripts/legacy-import-context';
import {publicationEndpoint} from '../src/server/publication-handler';
import {imageEndpoint} from '../src/server/image-handler';

const env={APP_ENV:'production',CONTEXT:'production',SUPABASE_URL:'https://prodref.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',SUPABASE_SECRET_KEY:'synthetic-private',
  R2_ACCOUNT_ID:'a'.repeat(32),R2_TEMPORARY_BUCKET:'prod-temporary',R2_PUBLISHED_BUCKET:'prod-published',
  R2_TEMPORARY_ACCESS_KEY_ID:'temp-key',R2_TEMPORARY_SECRET_ACCESS_KEY:'temp-secret',R2_PUBLISHED_ACCESS_KEY_ID:'pub-key',R2_PUBLISHED_SECRET_ACCESS_KEY:'pub-secret',R2_PUBLIC_BASE_URL:'https://images.example.invalid',
  BACKEND_TESTING_SUPABASE_REF:'testref',BACKEND_PRODUCTION_SUPABASE_REF:'prodref',BACKEND_TESTING_TEMPORARY_BUCKET:'test-temporary',BACKEND_TESTING_PUBLISHED_BUCKET:'test-published',BACKEND_PRODUCTION_TEMPORARY_BUCKET:'prod-temporary',BACKEND_PRODUCTION_PUBLISHED_BUCKET:'prod-published',
  SITE_URL:'https://example.invalid',VERIFICATION_TOKEN_SECRET:'a'.repeat(64),EMAIL_PROVIDER_API_KEY:'synthetic-mail',FROM_EMAIL:'sender@example.invalid',NOTIFICATION_EMAILS:'admin@example.invalid',
  VERIFIED_SUBMISSIONS_ENABLED:'true',IMAGE_INGESTION_ENABLED:'true',TURNSTILE_SECRET_KEY:'synthetic-bot'};

test('production import requires separate pinned URI and explicit confirmation; probes default to testing only',()=>{
  const config=loadBackendConfig(env),target={PRODUCTION_DATABASE_URL:'postgres://postgres:synthetic@db.prodref.supabase.co/postgres',PRODUCTION_IMPORT_CONFIRM:'prodref'};
  assert.throws(()=>importDatabaseTarget(config,target));
  assert.throws(()=>importDatabaseTarget(config,{...target,PRODUCTION_IMPORT_CONFIRM:'testref'},true));
  assert.throws(()=>importDatabaseTarget(config,{...target,PRODUCTION_DATABASE_URL:target.PRODUCTION_DATABASE_URL.replace('db.prodref','db.testref')},true));
  assert.throws(()=>importDatabaseTarget(config,{...target,PRODUCTION_DATABASE_URL:target.PRODUCTION_DATABASE_URL+'?sslmode=disable'},true));
  assert.equal(importDatabaseTarget(config,target,true).url.hostname,'db.prodref.supabase.co');
  assert.throws(()=>loadBackendConfig({...env,CONTEXT:'deploy-preview'}));
  assert.throws(()=>loadBackendConfig({...env,R2_PUBLISHED_BUCKET:'test-published'}));
});

test('production mail accepts real recipient shapes while testing still requires allowlisting',()=>{
  assert.doesNotThrow(()=>assertMailRecipients(loadPublicationConfig(env),['artist@example.invalid']));
  assert.throws(()=>loadPublicationConfig({...env,SITE_URL:'http://localhost:8888'}));
  const testing={...env,APP_ENV:'testing',CONTEXT:'branch-deploy',SUPABASE_URL:'https://testref.supabase.co',R2_TEMPORARY_BUCKET:'test-temporary',R2_PUBLISHED_BUCKET:'test-published',TEST_EMAIL_ALLOWLIST:'admin@example.invalid'};
  assert.throws(()=>assertMailRecipients(loadPublicationConfig(testing),['artist@example.invalid']));
});

test('production routes reach scanner-safe confirmation and origin denial without provider calls',async()=>{
  const saved={...process.env};
  try{
    Object.assign(process.env,env);
    const page=await publicationEndpoint(new Request('https://example.invalid/confirm-profile'),'synthetic-ip');
    assert.equal(page.status,200);assert.match(await page.text(),/Confirm submission/);
    for(const endpoint of [publicationEndpoint,imageEndpoint]){
      const denied=await endpoint(new Request('https://example.invalid/api/profile-image',{method:'POST',headers:{origin:'https://other.invalid','content-type':'application/json'},body:'{}'}),'synthetic-ip');
      assert.equal(denied.status,403);
    }
  }finally{
    for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
    Object.assign(process.env,saved);
  }
});
