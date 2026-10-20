import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { Response as RemoteResponse } from 'undici';
import { processImage,MAX_IMAGE_BYTES } from '../src/server/image-processing';
import { publicAddress,imageSourceUrl,fetchRemoteImage,readLimited } from '../src/server/remote-image';
import { handleImageRequest,type ImageHandlerDependencies,imageEndpoint } from '../src/server/image-handler';

test('JPEG, PNG and WebP bytes become bounded WebP with metadata removed and orientation applied',async()=>{
  for(const format of ['jpeg','png','webp'] as const){
    const source=await sharp({create:{width:16,height:8,channels:3,background:'red'}}).toFormat(format).withMetadata({orientation:6}).toBuffer();
    const output=await processImage(source);const meta=await sharp(output.bytes).metadata();
    assert.equal(meta.format,'webp');assert.equal(meta.width,8);assert.equal(meta.height,16);
    assert.equal(meta.exif,undefined);assert.equal(meta.xmp,undefined);assert.equal(meta.icc,undefined);
  }
  const large=await sharp({create:{width:2000,height:1000,channels:3,background:'blue'}}).png().toBuffer();
  assert.equal((await processImage(large)).width,1600);
});
test('rejects HTML, SVG, GIF, corrupt bytes, oversized files and excessive decoded dimensions',async()=>{
  const gif=await sharp({create:{width:1,height:1,channels:3,background:'red'}}).gif().toBuffer();
  const wide=await sharp({create:{width:10001,height:1,channels:3,background:'red'}}).png().toBuffer();
  for(const bad of [Buffer.from('<html><img src="https://example.com/a.png"></html>'),Buffer.from('<svg width="10" height="10"></svg>'),gif,wide,Buffer.alloc(0),Buffer.alloc(MAX_IMAGE_BYTES+1)]) await assert.rejects(processImage(bad));
});
test('remote fetch rejects internal, reserved and mapped addresses without opening a socket',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.2','0.0.0.0','100.64.0.1','192.0.2.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  for(const u of ['http://example.com/a','https://user:pass@example.com/a','https://example.com:444/a','https://localhost/a','https://x.internal/a','https://example.com./a'])assert.throws(()=>imageSourceUrl(u));
  await assert.rejects(fetchRemoteImage('https://127.0.0.1/a'),/not public/);
  await assert.rejects(fetchRemoteImage('https://[::ffff:127.0.0.1]/a'),/not public/);
});
test('bounded streaming enforces byte limits even without a content length',async()=>{
  async function* stream(){yield Buffer.alloc(3);yield Buffer.alloc(3);}
  await assert.rejects(readLimited(stream(),5),/too large/);assert.equal((await readLimited(stream(),6)).length,6);
});
test('each remote redirect is revalidated, mixed DNS answers fail closed and redirect/size budgets apply',async()=>{
  let calls=0;
  const resolve=async()=>[{address:'8.8.8.8',family:4}];
  await assert.rejects(fetchRemoteImage('https://safe.example/a',{resolve,request:async()=>{
    calls++;return new RemoteResponse(null,{status:302,headers:{location:'https://127.0.0.1/private'}});
  }}),/not public/);assert.equal(calls,1);
  await assert.rejects(fetchRemoteImage('https://safe.example/a',{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],request:async()=>{throw new Error('Socket must not open');}}),/not public/);
  await assert.rejects(fetchRemoteImage('https://safe.example/a',{resolve,request:async()=>new RemoteResponse(null,{status:302,headers:{location:'http://safe.example/image'}})}),/Unsafe/);
  calls=0;
  await assert.rejects(fetchRemoteImage('https://safe.example/a',{resolve,request:async()=>{calls++;return new RemoteResponse(null,{status:302,headers:{location:'/again'}});}}),/redirect/);assert.equal(calls,4);
  await assert.rejects(fetchRemoteImage('https://safe.example/a',{resolve,request:async()=>new RemoteResponse('x',{headers:{'content-length':String(MAX_IMAGE_BYTES+1)}})}),/too large/);
});
const origin='http://localhost:8888';
const id='00000000-0000-4000-8000-000000000003';
function deps(overrides:Partial<ImageHandlerDependencies>={}):ImageHandlerDependencies{
  return {config:{SUPABASE_SECRET_KEY:'synthetic-secret'} as ImageHandlerDependencies['config'],
    rpc:async()=>({allowed:true}),siteOrigin:origin,verifyBot:async()=>true,
    service:{start:async()=>({sessionId:id,capability:'a'.repeat(43),uploadUrl:undefined,expiresIn:undefined}),process:async()=>({sessionId:id,assetId:id,previewUrl:'https://example.com/private-signed',expiresIn:60}),preview:async()=>({sessionId:id,assetId:id,previewUrl:'https://example.com/private-signed',expiresIn:60})},...overrides};
}
function req(body:unknown,headers:Record<string,string>={}){return new Request(`${origin}/api/profile-image`,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});}
test('HTTP boundary denies cross-origin, bot failures, excessive requests and absent capabilities',async()=>{
  const start={action:'start',mode:'upload',bytes:100,type:'image/png',turnstileToken:'synthetic'};
  assert.equal((await handleImageRequest(req(start,{origin:'https://evil.example'}),'synthetic-ip',deps())).status,403);
  assert.equal((await handleImageRequest(req(start),'synthetic-ip',deps({verifyBot:async()=>false}))).status,403);
  assert.equal((await handleImageRequest(req(start),'synthetic-ip',deps({rpc:async()=>({allowed:false})}))).status,429);
  assert.equal((await handleImageRequest(req({action:'preview',sessionId:id}),'synthetic-ip',deps())).status,403);
  assert.equal((await handleImageRequest(req({...start,bytes:MAX_IMAGE_BYTES+1}),'synthetic-ip',deps())).status,400);
  assert.equal((await handleImageRequest(req({...start,extra:'x'.repeat(9000)}),'synthetic-ip',deps())).status,413);
  assert.equal((await handleImageRequest(req(start),'',deps())).status,503);
});
test('HTTP supports optional no-photo and capability-authenticated preview with no-store responses',async()=>{
  const response=await handleImageRequest(req({action:'start',mode:'none',turnstileToken:'synthetic'}),'synthetic-ip',deps());
  assert.deepEqual(await response.json(),{assetId:null});assert.equal(response.headers.get('cache-control'),'no-store');
  const preview=await handleImageRequest(req({action:'preview',sessionId:id},{authorization:`Bearer ${'a'.repeat(43)}`}),'synthetic-ip',deps());
  assert.equal(preview.status,200);assert.equal(preview.headers.get('referrer-policy'),'no-referrer');
});
test('image endpoint is disabled by default without disturbing v1 submissions',async()=>{
  const previous=process.env.IMAGE_INGESTION_ENABLED;delete process.env.IMAGE_INGESTION_ENABLED;
  try{assert.equal((await imageEndpoint(req({}),'synthetic-ip')).status,503);}finally{if(previous!==undefined)process.env.IMAGE_INGESTION_ENABLED=previous;}
});
