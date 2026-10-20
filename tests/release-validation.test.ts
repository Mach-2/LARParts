import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyTurnstile} from '../src/server/turnstile';
import {imageEndpoint} from '../src/server/image-handler';
import {publicationEndpoint} from '../src/server/publication-handler';
import {confirmationPage} from '../src/server/publication-handler';
import {runInNewContext} from 'node:vm';
import legacyEndpoint from '../netlify/functions/submit-profile.mts';

test('retired GitHub submission endpoint cannot accept release-branch submissions',async()=>{
  const response=await legacyEndpoint(new Request('https://testing.example.invalid/.netlify/functions/submit-profile', {method:'POST',body:'{}'}));
  assert.equal(response.status,410);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match((await response.json()).message,/\/submit-profile/);
});

test('Turnstile fails closed on wrong host/action, provider rejection, malformed JSON and network failure',async()=>{
  const input={secret:'synthetic-server-secret',token:'synthetic-token',ip:'127.0.0.1',origin:'https://testing.example.invalid',action:'profile-submit' as const};
  const valid={success:true,hostname:'testing.example.invalid',action:'profile-submit'};
  assert.equal(await verifyTurnstile(input,async(url,options)=>{
    assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(options?.method,'POST');
    const body=options?.body as URLSearchParams;assert.equal(body.get('secret'),input.secret);assert.equal(body.get('response'),input.token);
    return Response.json(valid);
  }),true);
  for(const result of [{...valid,success:false},{...valid,hostname:'production.example.invalid'},{...valid,action:'profile-image'},{success:true},{}]){
    assert.equal(await verifyTurnstile(input,async()=>Response.json(result)),false);
  }
  for(const fetcher of [async()=>Response.json(valid,{status:503}),async()=>new Response('not JSON'),async()=>{throw new Error('Offline');}]){
    assert.equal(await verifyTurnstile(input,fetcher),false);
  }
  assert.equal(await verifyTurnstile({...input,secret:''}),false);
});
test('new submission endpoints remain disabled without explicit runtime opt-in',async()=>{
  const oldImage=process.env.IMAGE_INGESTION_ENABLED,oldPublication=process.env.VERIFIED_SUBMISSIONS_ENABLED;
  try{
    process.env.IMAGE_INGESTION_ENABLED='false';process.env.VERIFIED_SUBMISSIONS_ENABLED='false';
    for(const endpoint of [imageEndpoint,publicationEndpoint]){
      const response=await endpoint(new Request('http://localhost:8888/api/verified-profile',{method:'POST'}),'127.0.0.1');
      assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
    }
  }finally{
    if(oldImage===undefined)delete process.env.IMAGE_INGESTION_ENABLED;else process.env.IMAGE_INGESTION_ENABLED=oldImage;
    if(oldPublication===undefined)delete process.env.VERIFIED_SUBMISSIONS_ENABLED;else process.env.VERIFIED_SUBMISSIONS_ENABLED=oldPublication;
  }
});
test('opening a replacement confirmation link in the same tab replaces the token without publishing',async()=>{
  const html=await confirmationPage().text(),script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];assert.ok(script);
  const id='12345678-1234-1234-1234-123456789abc',tokens:string[]=[];
  const button={disabled:true,hidden:false},status={textContent:''};let submit:((event:unknown)=>Promise<void>)|undefined,hashchange:(()=>void)|undefined;
  const location={hash:`#${id}.${'a'.repeat(43)}`,pathname:'/confirm-profile'};
  const form={querySelector:()=>button,addEventListener:(_name:string,listener:typeof submit)=>{submit=listener;}};
  runInNewContext(script,{location,history:{replaceState:()=>{location.hash='';}},document:{querySelector:(selector:string)=>selector==='form'?form:status},
    addEventListener:(_name:string,listener:()=>void)=>{hashchange=listener;},fetch:async(_url:string,options:{body:string})=>{
      tokens.push(JSON.parse(options.body).token);return{ok:true,json:async()=>({state:'published'})};
    }});
  assert.equal(tokens.length,0);assert.equal(location.hash,'');assert.equal(button.disabled,false);
  await submit!({preventDefault(){}});assert.deepEqual(tokens,['a'.repeat(43)]);
  location.hash=`#${id}.${'b'.repeat(43)}`;hashchange!();assert.equal(location.hash,'');assert.equal(tokens.length,1);assert.equal(button.hidden,false);
  await submit!({preventDefault(){}});assert.deepEqual(tokens,['a'.repeat(43),'b'.repeat(43)]);
});
