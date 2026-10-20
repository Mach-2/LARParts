import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPublicReadConfig} from '../src/server/config';
import {readPublishedArtists} from '../src/server/artists';
import {artistPage,directoryPage,kingdomPage,publicPageResponse} from '../src/server/public-pages';
import {kingdomDirectory} from '../src/data/kingdomDirectory';
const env={APP_ENV:'testing',SUPABASE_URL:'https://testref.supabase.co',SUPABASE_PUBLISHABLE_KEY:'restricted-test-key',R2_PUBLIC_BASE_URL:'https://images.example.com',BACKEND_TESTING_SUPABASE_REF:'testref',BACKEND_PRODUCTION_SUPABASE_REF:'prodref'};
const config=loadPublicReadConfig(env);
const row=(id:string,kingdom='Northern Lights')=>({id,profile:{displayName:`Artist ${id}`,kingdom,homePark:'Synthetic Park',skills:['Sewing'],awards:[],contact:{},biography:'Synthetic biography'},photo_key:null});

test('public rendering configuration needs no privileged secrets and rejects preview/production swaps',()=>{
  assert.equal(config.SUPABASE_PUBLISHABLE_KEY,'restricted-test-key');assert.ok(!('SUPABASE_SECRET_KEY'in config));assert.ok(!('R2_TEMPORARY_SECRET_ACCESS_KEY'in config));
  for(const change of [{CONTEXT:'deploy-preview',APP_ENV:'production'},{SUPABASE_URL:'https://prodref.supabase.co'},{CONTEXT:'production'},{R2_PUBLIC_BASE_URL:'http://images.example.com'}])assert.throws(()=>loadPublicReadConfig({...env,...change}));
});
test('keyset pagination respects small provider caps and refuses repeated pages',async()=>{
  let calls=0;
  const fetcher:typeof fetch=async(input,options)=>{
    calls++;const url=new URL(String(input));assert.equal(new Headers(options?.headers).get('apikey'),'restricted-test-key');assert.equal(options?.cache,'no-store');
    if(!url.searchParams.has('id'))return Response.json([row('artist-one')]);
    if(url.searchParams.get('id')==='gt.artist-one')return Response.json([row('artist-two')]);
    return Response.json([]);
  };
  assert.deepEqual((await readPublishedArtists(config,fetcher)).map(a=>a.id),['artist-one','artist-two']);assert.equal(calls,3);
  await assert.rejects(readPublishedArtists(config,async()=>Response.json([row('artist-one')])),/Repeated/);
});
test('fresh requests see publish/unpublish across lists, profiles and dynamic kingdoms',async()=>{
  let published=false;
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));
    if(url.searchParams.get('id')?.startsWith('gt.'))return Response.json([]);
    return Response.json(published?[row('stable-existing-id','Synthetic Province')]:[]);
  };
  const deps={config,fetcher};
  assert.equal((await artistPage('stable-existing-id',deps)).status,404);assert.equal((await kingdomPage('synthetic-province',deps)).status,404);
  published=true;
  const list=await directoryPage(deps);assert.ok(list.ok);assert.equal(list.data.length,1);
  assert.equal((await artistPage('stable-existing-id',deps)).status,200);assert.equal((await kingdomPage('synthetic-province',deps)).status,200);
  assert.equal(kingdomDirectory(list.data).find(k=>k.name==='Synthetic Province')?.artistCount,1);
  published=false;assert.equal((await artistPage('stable-existing-id',deps)).status,404);assert.equal((await kingdomPage('synthetic-province',deps)).status,404);
  const empty=await kingdomPage('northern-lights',deps);assert.ok(empty.ok);assert.equal(empty.data.artists.length,0);
});
test('missing/unpublished is 404, provider/config/schema failures are 503 without leaked details',async()=>{
  assert.equal((await artistPage('not-found',{config,fetcher:async()=>Response.json([])})).status,404);
  assert.equal((await artistPage('../unsafe',{env:{}})).status,404);
  for(const fetcher of [async()=>new Response('private provider message',{status:503}),async()=>Response.json([row('stable-id'),{email:'private@example.invalid'}]),async()=>{throw new Error('private secret');}]){
    const page=await directoryPage({config,fetcher});assert.deepEqual(page,{ok:false,status:503});assert.ok(!JSON.stringify(page).includes('private'));
  }
  assert.equal((await directoryPage({env:{}})).status,503);
  assert.equal((await artistPage('stable-id',{config,fetcher:async()=>new Response('',{status:503})})).status,503);
});
test('successful, missing and unavailable pages prevent all shared/browser HTML caching',()=>{
  for(const status of [200,404,503]){
    const response={status:200,headers:new Headers()};publicPageResponse(response,status);assert.equal(response.status,status);
    for(const header of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.equal(response.headers.get(header),'no-store');
    assert.equal(response.headers.get('retry-after'),status===503?'60':null);
  }
});
