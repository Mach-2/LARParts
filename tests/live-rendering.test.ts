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

test('directory diagnostics distinguish config, HTTP, network and data failures without logging private values',async()=>{
  const logs:unknown[][]=[],original=console.error;
  console.error=(...args:unknown[])=>{logs.push(args);};
  try{
    const cases=[
      {deps:{env:{...env,SUPABASE_URL:'https://testref.supabase.co/rest/v1/'}},expected:{stage:'configuration',code:'invalid_public_read_fields',fields:['SUPABASE_URL']}},
      {deps:{env:{...env,SUPABASE_PUBLISHABLE_KEY:undefined}},expected:{stage:'configuration',code:'invalid_public_read_fields',fields:['SUPABASE_PUBLISHABLE_KEY']}},
      {deps:{env:{...env,SUPABASE_URL:'https://prodref.supabase.co'}},expected:{stage:'configuration',code:'public_read_resource_mismatch',fields:['SUPABASE_URL','R2_PUBLIC_BASE_URL','BACKEND_TESTING_SUPABASE_REF','BACKEND_PRODUCTION_SUPABASE_REF']}},
      ...[401,403,404,503].map(status=>({deps:{config,fetcher:async()=>new Response('private-provider-message',{status})},expected:{stage:'published_read',code:'database_http_error',httpStatus:status}})),
      {deps:{config,fetcher:async()=>{throw new Error('private-network-message');}},expected:{stage:'published_read',code:'database_network_or_timeout'}},
      {deps:{config,fetcher:async()=>new Response('private-invalid-json')},expected:{stage:'published_read',code:'database_invalid_json'}},
      {deps:{config,fetcher:async()=>Response.json([{email:'private-person@example.invalid'}])},expected:{stage:'published_read',code:'published_data_invalid'}},
    ];
    for(const scenario of cases){
      logs.length=0;
      assert.deepEqual(await directoryPage(scenario.deps),{ok:false,status:503});
      assert.deepEqual(logs,[['Public directory unavailable',scenario.expected]]);
      const text=JSON.stringify(logs);
      for(const forbidden of ['private-',config.SUPABASE_PUBLISHABLE_KEY,config.SUPABASE_URL])assert.ok(!text.includes(forbidden));
    }
    logs.length=0;
    assert.equal((await artistPage('stable-id',{config,fetcher:async()=>new Response('private-provider-message',{status:401})})).status,503);
    assert.deepEqual(logs,[['Public directory unavailable',{stage:'published_read',code:'database_http_error',httpStatus:401}]]);
    logs.length=0;
    assert.equal((await artistPage('missing-id',{config,fetcher:async()=>Response.json([])})).status,404);
    assert.equal(logs.length,0);
  }finally{console.error=original;}
});
