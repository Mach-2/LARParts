import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBackendConfig } from '../src/server/config';
import { adaptArtistRow, readPublishedArtists } from '../src/server/artists';
import { resolveAssetUrl, safeObjectKey, createStorageClient } from '../src/server/storage';

const env = {
  APP_ENV:'testing', SUPABASE_URL:'https://testref.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test-key',SUPABASE_SECRET_KEY:'private-test-key',
  R2_ACCOUNT_ID:'a'.repeat(32),R2_TEMPORARY_BUCKET:'test-temporary',R2_PUBLISHED_BUCKET:'test-published',
  R2_TEMPORARY_ACCESS_KEY_ID:'temporary-key',R2_TEMPORARY_SECRET_ACCESS_KEY:'temporary-secret',
  R2_PUBLISHED_ACCESS_KEY_ID:'published-key',R2_PUBLISHED_SECRET_ACCESS_KEY:'published-secret',R2_PUBLIC_BASE_URL:'https://images.example.com',
  BACKEND_TESTING_SUPABASE_REF:'testref',BACKEND_PRODUCTION_SUPABASE_REF:'prodref',
  BACKEND_TESTING_TEMPORARY_BUCKET:'test-temporary',BACKEND_TESTING_PUBLISHED_BUCKET:'test-published',
  BACKEND_PRODUCTION_TEMPORARY_BUCKET:'prod-temporary',BACKEND_PRODUCTION_PUBLISHED_BUCKET:'prod-published',
};
const config = loadBackendConfig(env);
const profile = {displayName:'Synthetic Artist',kingdom:'Testing',awards:[],skills:['Sewing'],contact:{}};

test('configuration fails closed for swapped resources, preview production, shared credentials and malformed inputs', () => {
  for (const change of [
    {APP_ENV:'production'}, {CONTEXT:'deploy-preview',APP_ENV:'production'}, {CONTEXT:'production'},
    {SUPABASE_URL:'https://prodref.supabase.co'}, {R2_TEMPORARY_BUCKET:'prod-temporary'},
    {R2_PUBLISHED_ACCESS_KEY_ID:'temporary-key'}, {R2_PUBLIC_BASE_URL:'images.example.com'},
    {BACKEND_TESTING_SUPABASE_REF:'prodref'}, {R2_ACCOUNT_ID:'invalid'},
  ]) assert.throws(() => loadBackendConfig({...env,...change}));
  try { loadBackendConfig({...env,R2_TEMPORARY_SECRET_ACCESS_KEY:''}); }
  catch (error) { assert.ok(!String(error).includes('private-test-key')); }
});

test('adapter preserves public ArtistProfile and rejects accidental private fields', () => {
  const artist = adaptArtistRow({id:'stable-id',profile,photo_key:'artists/image.webp'},config);
  assert.equal(artist.photoUrl,'https://images.example.com/artists/image.webp');
  assert.equal(artist.id,'stable-id');
  assert.throws(() => adaptArtistRow({id:'stable-id',profile:{...profile,email:'private@example.invalid'},photo_key:null},config));
});

test('storage resolves only processed published assets and rejects unsafe keys', () => {
  const asset = {id:'synthetic',provider:'r2' as const,bucket:'test-published',object_key:'artists/picture.webp',visibility:'published' as const,processing_state:'processed' as const,width:100,height:100};
  assert.match(resolveAssetUrl(config,asset),/^https:/);
  assert.throws(() => resolveAssetUrl(config,{...asset,visibility:'temporary'}));
  assert.throws(() => resolveAssetUrl(config,{...asset,bucket:'prod-published'}));
  assert.throws(() => resolveAssetUrl(config,{...asset,processing_state:'pending'}));
  for (const key of ['../secret','x/../secret','/absolute','a?token=1','a%2fb','a//b']) assert.throws(() => safeObjectKey(key));
  for (const area of ['temporary','published'] as const) {
    const s=createStorageClient(config,area);
    assert.equal(s.bucket,area === 'temporary' ? 'test-temporary' : 'test-published');
    s.client.destroy();
  }
});

test('repository uses restricted key and refuses provider failures without privileged fallback', async () => {
  let calls=0;
  const mock: typeof fetch = async (input, options) => {
    calls++;
    const url=new URL(String(input));
    assert.equal(url.searchParams.get('status'),'eq.published');
    assert.equal(new Headers(options?.headers).get('apikey'),'public-test-key');
    assert.equal(options?.cache,'no-store');
    return Response.json(calls===1?[{id:'stable-id',profile,photo_key:null}]:[]);
  };
  assert.equal((await readPublishedArtists(config,mock)).length,1);
  assert.equal(calls,2);
  await assert.rejects(readPublishedArtists(config,async () => new Response('',{status:503})),/unavailable/);
});
