import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,createHmac} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {PutObjectCommand,DeleteObjectCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {legacyImportContext} from './legacy-import-context';
import {startBrowser} from './browser-driver';
import {loadPublicationConfig} from '../src/server/publication-config';
import {PublicationService} from '../src/server/publication-service';
import {handlePublicationRequest,confirmationPage} from '../src/server/publication-handler';
import {ImageService,createImageRpc} from '../src/server/image-service';
import {handleImageRequest} from '../src/server/image-handler';
import {createStorageClient} from '../src/server/storage';

// Run Astro upstream on :4330 with the two testing endpoint flags enabled.
// This loopback harness injects bot verification and an in-memory mail capture,
// but uses real handlers, testing PostgreSQL/R2 and browser cross-origin uploads.
// No production flag, bot bypass or mail capture path exists in application code.
const {sql,config:backend}=await legacyImportContext();
const baseConfig=loadPublicationConfig(),origin='http://localhost:8888';
if(baseConfig.origin!==origin)throw new Error('Browser probe requires the configured localhost:8888 testing origin/CORS');
const suffix=randomUUID().replaceAll('-',''),ip=`synthetic-browser-${suffix}`;
const emails=['upload','remote','none'].map(mode=>`browser+${mode}-${suffix}@example.invalid`);
const config={...baseConfig,testAllowlist:emails,administrators:[emails[0]]};
const messages:Array<{subject:string;text:string}>=[];
const publication=new PublicationService(config,undefined,async body=>{messages.push({subject:body.subject,text:body.text});});
const images=new ImageService(backend),imageRpc=createImageRpc(backend),published=createStorageClient(backend,'published'),temporary=createStorageClient(backend,'temporary');
const ids=new Set<string>(),sessions=new Set<string>(),submitted:Array<{requestId:string;capability:string;serialized:string}>=[];
const sourceKey=`browser-validation/${suffix}.png`;
let stage='setup',failed=false,dropResponse=true,browser:Awaited<ReturnType<typeof startBrowser>>|undefined;
let diagnosticPage:Awaited<ReturnType<Awaited<ReturnType<typeof startBrowser>>['page']>>|undefined;
const proxyStats={requests:0,upstream:0};
const server=createServer(async(incoming,outgoing)=>{
  try{
    proxyStats.requests++;
    if(incoming.headers.host!=='localhost:8888'){outgoing.writeHead(403);outgoing.end();return;}
    const url=new URL(incoming.url??'/',origin),chunks:Buffer[]=[];let size=0;
    for await(const chunk of incoming){size+=chunk.length;if(size>32768)throw new Error('Request too large');chunks.push(Buffer.from(chunk));}
    const body=Buffer.concat(chunks),headers=new Headers();
    for(const [key,value] of Object.entries(incoming.headers)){if(value)headers.set(key,Array.isArray(value)?value.join(','):value);}
    const request=new Request(url,{method:incoming.method,headers,...(body.length?{body}:{} )});
    let response:Response;
    if(url.pathname==='/api/profile-image'){
      const data=JSON.parse(body.toString('utf8'));
      response=await handleImageRequest(request,ip,{config:backend,rpc:imageRpc,service:images,siteOrigin:origin,verifyBot:async token=>token==='synthetic-profile-image'});
      const result=await response.clone().json();if(data.action==='start'&&result.sessionId)sessions.add(result.sessionId);
    }else if(url.pathname==='/api/verified-profile'){
      const data=JSON.parse(body.toString('utf8'));
      if(data.action==='submit'){
        ids.add(data.submission.requestId);submitted.push({requestId:data.submission.requestId,capability:data.submission.capability,serialized:JSON.stringify(data.submission)});
      }
      response=await handlePublicationRequest(request,ip,{config,rpc:publication.rpc,service:publication,verifyBot:async token=>token==='synthetic-profile-submit'});
      if(data.action==='submit'&&dropResponse&&response.ok){dropResponse=false;response=Response.json({error:'Simulated lost response'},{status:503});}
    }else if(url.pathname==='/confirm-profile')response=confirmationPage(request.method);
    else{
      proxyStats.upstream++;
      const target=new URL(url.pathname+url.search,'http://127.0.0.1:4330');
      response=await fetch(target,{method:incoming.method,headers:{accept:headers.get('accept')??'*/*'},redirect:'manual',signal:AbortSignal.timeout(30000)});
    }
    const responseHeaders=Object.fromEntries(response.headers);delete responseHeaders['content-encoding'];delete responseHeaders['content-length'];delete responseHeaders['transfer-encoding'];
    outgoing.writeHead(response.status,responseHeaders);outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch{outgoing.writeHead(503,{'content-type':'text/plain'});outgoing.end('Synthetic browser test request unavailable');}
});
try{
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(8888,'127.0.0.1',()=>resolve());});
  stage='synthetic public image source';
  const source=await sharp({create:{width:32,height:16,channels:3,background:'#487557'}}).png().withMetadata({orientation:6}).toBuffer();
  await published.client.send(new PutObjectCommand({Bucket:published.bucket,Key:sourceKey,Body:source,ContentType:'image/png',StorageClass:'STANDARD'}));
  stage='start installed Edge';browser=await startBrowser();
  for(const [index,mode] of ['upload','remote','none'].entries()){
    console.log(`Checking browser ${mode} flow`);stage=`${mode} form rendering`;
    const page=await browser.page(),name=`Synthetic browser ${mode} ${suffix}`;diagnosticPage=page;
    await page.init(`window.turnstile={render:(element,options)=>{window.__botOptions=options;return 'synthetic-widget';},execute:()=>queueMicrotask(()=>window.__botOptions.callback('synthetic-'+window.__botOptions.action)),remove:()=>{}};`);
    await page.navigate(origin+'/submit-profile/');
    await page.wait(`document.querySelector('[data-profile-form]')?.dataset.clientReady==='true'`);
    await page.evaluate(`(()=>{
      const values=${JSON.stringify({'display-name':name,kingdom:'Northern Lights','home-park':'Synthetic Park',skills:'Sewing, Weaving','submitter-email':emails[index]})};
      for(const [id,value]of Object.entries(values)){const field=document.getElementById(id);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}
      document.querySelector('#consent').checked=true;
      const mode=document.querySelector('[data-photo-mode]');mode.value=${JSON.stringify(mode)};mode.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    if(mode!=='none'){
      stage=`${mode} private photo preview`;
      if(mode==='upload')await page.evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(source.toString('base64'))}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'synthetic.png',{type:'image/png'}));const field=document.querySelector('[data-photo-upload]');field.files=transfer.files;field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      else await page.evaluate(`(()=>{const field=document.querySelector('#photo-url');field.value=${JSON.stringify(backend.R2_PUBLIC_BASE_URL.replace(/\/$/,'')+'/'+sourceKey)};field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await page.evaluate(`document.querySelector('[data-prepare-photo]').click()`);
      await page.wait(`(()=>{const image=document.querySelector('[data-photo-preview]');return image&&!image.hidden&&image.complete&&image.naturalWidth>0;})()`,45000);
    }
    stage=`${mode} submit and stable retry`;const before=submitted.length;
    await page.evaluate(`document.querySelector('[data-submit-button]').click()`);
    if(index===0){
      await page.wait(`document.querySelector('[data-form-status]')?.dataset.state==='server-error'`);
      assert.equal(submitted.length,before+1);
      await page.evaluate(`document.querySelector('[data-submit-button]').click()`);
    }
    await page.wait(`document.querySelector('[data-form-status]')?.dataset.state==='success'`);
    assert.ok(submitted.length>before);const submission=submitted[before];
    if(index===0){assert.equal(submitted[before+1].requestId,submission.requestId);assert.equal(submitted[before+1].serialized,submission.serialized);}
    assert.equal(Number((await sql`select count(*) from private.submissions where id=${submission.requestId}::uuid`)[0].count),1);
    const getLink=()=>{
      const message=[...messages].reverse().find(m=>m.subject==='Confirm your LARParts profile'&&m.text.includes(name));
      assert.ok(message);const link=message.text.match(/https?:\/\/[^\s]+\/confirm-profile#[^\s]+/)?.[0];assert.ok(link);return link;
    };
    let link=getLink();const confirmation=await browser.page();
    stage=`${mode} scanner-safe opening`;
    await confirmation.navigate(link);await confirmation.wait(`document.querySelector('#confirmation button')?.disabled===false`);
    assert.equal(await confirmation.evaluate('location.hash'),'');
    assert.equal(Number((await sql`select count(*) from public.artist_profiles where profile->>'displayName'=${name}`)[0].count),0);
    if(index===0){
      stage='resend and revoked-link denial';
      await sql`update private.submissions set last_confirmation_at=now()-interval '6 minutes' where id=${submission.requestId}::uuid`;
      await page.evaluate(`document.querySelector('[data-resend-confirmation]').click()`);
      await page.wait(`document.querySelector('[data-status-message]').textContent.includes('previous link')`);const next=getLink();assert.notEqual(next,link);
      await confirmation.evaluate(`document.querySelector('#confirmation button').click()`);
      await confirmation.wait(`document.querySelector('#status').textContent.includes('could not finish')`);
      assert.equal(Number((await sql`select count(*) from public.artist_profiles where profile->>'displayName'=${name}`)[0].count),0);
      link=next;await confirmation.navigate(link);await confirmation.wait(`document.querySelector('#confirmation button')?.disabled===false`);
    }
    stage=`${mode} explicit publication POST`;
    await confirmation.evaluate(`document.querySelector('#confirmation button').click()`);
    await confirmation.wait(`document.querySelector('#status').textContent==='Your profile is published.'`,45000);
    await page.evaluate(`document.querySelector('[data-check-publication]').click()`);
    await page.wait(`document.querySelector('[data-published-link]')?.hidden===false`);
    const href=await page.evaluate<string>(`document.querySelector('[data-published-link]').getAttribute('href')`);
    assert.match(href,/^\/artists\/artist-[a-f0-9]+\/$/);
    const storage=await page.evaluate<string>(`JSON.stringify({local:{...localStorage},session:{...sessionStorage}})`);assert.ok(!storage.includes(submission.capability));
    stage=`${mode} next-request profile and browser filters`;
    await page.navigate(origin+href);await page.wait(`document.querySelector('h1')?.textContent===${JSON.stringify(name)}`);
    assert.ok(!(await page.evaluate<string>('document.documentElement.outerHTML')).includes(emails[index]));
    await page.navigate(origin+'/artists/');await page.wait(`document.readyState==='complete'&&!!document.querySelector('[data-filter-search]')`);
    await page.evaluate(`(()=>{const search=document.querySelector('[data-filter-search]');search.value=${JSON.stringify(name)};search.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await page.wait(`Array.from(document.querySelectorAll('[data-artist-card]')).filter(card=>!card.hidden).length===1`);
    if(index===0){await mkdir('.netlify/release-validation',{recursive:true});await writeFile('.netlify/release-validation/browser-directory.png',await page.screenshot());}
    console.log(`PASS: browser ${mode}, private preview when selected, stable submit, scanner-safe GET, explicit confirm, next-request profile and filters`);
  }
  stage='preview redirect';
  const legacy=await browser.page();await legacy.navigate(origin+'/submit-profile/');await legacy.wait(`document.querySelector('[data-profile-form]')?.dataset.clientReady==='true'`);
  await legacy.navigate(origin+'/submit-profile-preview/');
  await legacy.wait(`location.pathname==='/submit-profile'||location.pathname==='/submit-profile/'`);
  assert.equal(await legacy.evaluate(`document.querySelector('form').getAttribute('action')`),'/api/verified-profile');
  console.log('PASS: preview redirects to the release submission form; bot and mail transports were captured/stubbed only inside this test harness');
}catch{
  failed=true;console.error(`FAIL: browser validation at ${stage}; payloads/tokens/provider details suppressed`);
  console.log(JSON.stringify({proxy:proxyStats}));
  try{console.log(await diagnosticPage?.evaluate(`JSON.stringify({title:document.title,readyState:document.readyState,form:!!document.querySelector('[data-profile-form]'),clientReady:document.querySelector('[data-profile-form]')?.dataset.clientReady,protocol:location.protocol})`));}catch{}
}
finally{
  await browser?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  try{
    const assets=new Set<string>();
    for(const id of ids){
      const rows=await sql`select image_asset_id from private.submissions where id=${id}::uuid`;if(rows[0]?.image_asset_id)assets.add(rows[0].image_asset_id);
      const intents=await sql`select asset_id from private.publication_intents where submission_id=${id}::uuid`;if(intents[0]?.asset_id)assets.add(intents[0].asset_id);
      await published.client.send(new DeleteObjectCommand({Bucket:published.bucket,Key:`profiles/${id}.webp`}));
      await sql.begin(async tx=>{
        await tx`update private.submissions set artist_id=null,image_asset_id=null,authorized_token_id=null where id=${id}::uuid`;
        await tx`delete from private.notification_jobs where submission_id=${id}::uuid`;
        await tx`delete from private.verification_tokens where submission_id=${id}::uuid`;
        await tx`delete from private.publication_intents where submission_id=${id}::uuid`;
      });
    }
    for(const id of sessions){
      const [session]=await sql`select asset_id from private.image_sessions where id=${id}::uuid`;if(session?.asset_id)assets.add(session.asset_id);
      for(const prefix of [`raw/${id}/`,`processed/${id}/`]){
        const objects=await temporary.client.send(new ListObjectsV2Command({Bucket:temporary.bucket,Prefix:prefix}));
        for(const object of objects.Contents??[])if(object.Key)await temporary.client.send(new DeleteObjectCommand({Bucket:temporary.bucket,Key:object.Key}));
      }
      await sql`delete from private.image_sessions where id=${id}::uuid`;
    }
    for(const id of ids){
      await sql`delete from private.submissions where id=${id}::uuid`;
      const artistId=`artist-${id.replaceAll('-','')}`;
      await sql`select set_config('app.audit_actor','synthetic-browser-cleanup',false),set_config('app.audit_reason','Remove scoped release-validation fixtures',false)`;
      await sql`delete from public.artist_profiles where id=${artistId}`;await sql`delete from private.profile_audit where artist_id=${artistId}`;
    }
    for(const id of assets)await sql`delete from private.image_assets where id=${id}::uuid`;
    const fingerprint=(value:string)=>createHmac('sha256',backend.SUPABASE_SECRET_KEY).update(value).digest('hex');
    await sql`delete from private.image_rate_limits where fingerprint=${fingerprint('image:'+ip)}`;
    for(const scope of ['submit','status','resend','confirm'])await sql`delete from private.submission_rate_limits where fingerprint=${fingerprint('publication-'+scope+':'+ip)}`;
    for(const email of emails)await sql`delete from private.submission_rate_limits where fingerprint=${fingerprint('confirmation-mail:'+email)}`;
    await published.client.send(new DeleteObjectCommand({Bucket:published.bucket,Key:sourceKey}));
    console.log('PASS: browser synthetic SQL, image objects and scoped rate fixtures removed; imported public profiles untouched');
  }catch{failed=true;console.error('FAIL: inspect synthetic-browser fixtures privately in testing; unrelated data was not targeted');}
  publication.close();images.close();published.client.destroy();temporary.client.destroy();await sql.end({timeout:5});if(failed)process.exitCode=1;
}
