import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import {loadPublicReadConfig} from '../src/server/config';
import {kingdomSlug} from '../src/data/kingdomDirectory';

// Start Astro dev on 127.0.0.1:4327. Optional second dev server on :4328 with
// mismatched SUPABASE_URL validates friendly HTTP 503 without touching providers.
const config=loadPublicReadConfig();if(config.APP_ENV!=='testing')throw new Error('Rendering probe requires testing');
let connection:URL;try{connection=new URL(process.env.TEST_DATABASE_URL??'');}catch{throw new Error('Testing database URI required');}
const ref=config.BACKEND_TESTING_SUPABASE_REF;
if(!(connection.hostname===`db.${ref}.supabase.co`||(connection.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(connection.username)===`postgres.${ref}`)))throw new Error('Testing database pin mismatch');
const ca=process.env.TEST_DATABASE_CA_FILE?await readFile(process.env.TEST_DATABASE_CA_FILE,'utf8'):undefined;
const sql=postgres(connection.href,{ssl:ca?{ca,rejectUnauthorized:true}:'verify-full',max:1,connect_timeout:10,onnotice:()=>{}});
const suffix=randomUUID().replaceAll('-',''),ids=[`artist-step5-${suffix}-a`,`artist-step5-${suffix}-z`];
const names=[`Alpha Synthetic ${suffix}`,`Zulu Synthetic ${suffix}`];
const skill=`Synthetic Needlework ${suffix}`,unknownKingdom=`Synthetic Reach ${suffix}`;
let stage='initial requests',failed=false;
const base='http://127.0.0.1:4327';
async function page(path:string,status=200,origin=base){
  const response=await fetch(origin+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,status);
  const html=await response.text();
  if(origin===base&&['/about/','/whats-next/','/submit-profile/'].includes(path))return html;
  for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.equal(response.headers.get(name),'no-store');
  assert.equal(response.headers.get('set-cookie'),null);
  for(const key of ['SUPABASE_SECRET_KEY','R2_TEMPORARY_SECRET_ACCESS_KEY','R2_PUBLISHED_SECRET_ACCESS_KEY','VERIFICATION_TOKEN_SECRET','EMAIL_PROVIDER_API_KEY']){
    const value=process.env[key];if(value)assert.ok(!html.includes(value),'Server secret leaked into public HTML');
  }
  return html;
}
async function mutate(action:()=>Promise<void>){
  await sql`select set_config('app.audit_actor','synthetic-step5-rendering',false),set_config('app.audit_reason','Testing next-request public rendering',false)`;
  await action();
}
try{
  assert.ok(!(await page('/artists/')).includes(ids[0]));await page(`/kingdoms/${kingdomSlug(unknownKingdom)}/`,404);
  stage='private fixtures';
  for(let i=0;i<ids.length;i++)await mutate(async()=>{
    await sql`insert into public.artist_profiles(id,profile,status) values(${ids[i]},${sql.json({displayName:names[i],kingdom:i===0?'Northern Lights':unknownKingdom,homePark:'Synthetic Park',skills:[skill],awards:[],contact:{},biography:'Synthetic biography with <b>literal markup</b>'})},'unpublished')`;
  });
  await page(`/artists/${ids[0]}/`,404);assert.ok(!(await page('/artists/')).includes(ids[0]));
  stage='publish then next-request HTML';
  for(const id of ids)await mutate(async()=>{await sql`update public.artist_profiles set status='published' where id=${id}`;});
  const profile=await page(`/artists/${ids[0]}/`);assert.ok(profile.includes(names[0]));assert.ok(profile.includes('name="description"'));assert.ok(profile.includes('&lt;b&gt;literal markup&lt;/b&gt;'));assert.ok(profile.includes('/kingdoms/northern-lights/'));
  const directory=await page('/artists/');assert.ok(directory.indexOf(names[0])<directory.indexOf(names[1]));assert.ok(directory.includes(`data-skills="${skill.toLowerCase()}"`));assert.ok(directory.includes('data-filter-search'));assert.ok(directory.includes(`href="/artists/${ids[0]}/"`));
  const home=await page('/');assert.ok(home.includes(`/kingdoms/${kingdomSlug(unknownKingdom)}/`));
  const kingdom=await page('/kingdoms/northern-lights/');assert.ok(kingdom.includes(names[0]));assert.ok(kingdom.includes('Synthetic Park'));assert.ok(!kingdom.includes(names[1]));
  assert.ok((await page(`/kingdoms/${kingdomSlug(unknownKingdom)}/`)).includes(names[1]));
  stage='unpublish then next-request HTML';
  for(const id of ids)await mutate(async()=>{await sql`update public.artist_profiles set status='unpublished' where id=${id}`;});
  await page(`/artists/${ids[0]}/`,404);assert.ok(!(await page('/artists/')).includes(names[0]));assert.ok(!(await page('/kingdoms/northern-lights/')).includes(names[0]));await page(`/kingdoms/${kingdomSlug(unknownKingdom)}/`,404);
  assert.ok(!(await page('/')).includes(`/kingdoms/${kingdomSlug(unknownKingdom)}/`));
  stage='informational/legacy routes';
  assert.ok((await page('/about/')).includes('Submission privacy'));await page('/whats-next/');assert.ok((await page('/submit-profile/')).includes('/.netlify/functions/submit-profile'));
  if(process.argv.includes('--with-outage')){
    stage='HTTP outage states';
    for(const path of ['/','/artists/',`/artists/${ids[0]}/`,'/kingdoms/northern-lights/']){
      const html=await page(path,503,'http://127.0.0.1:4328');assert.ok(html.includes('Directory temporarily unavailable'));assert.ok(!html.includes(names[0]));
    }
  }
  console.log('PASS: real HTTP publish/unpublish visibility on next request, stable URLs/metadata, filtering data, dynamic kingdoms, 404s, no-store headers and secret exclusion');
  if(process.argv.includes('--with-outage'))console.log('PASS: real HTTP friendly 503 responses for invalid backend configuration; provider-outage exceptions covered separately by tests');
}catch{failed=true;console.error(`FAIL: live rendering at ${stage}; private provider details suppressed`);}
finally{
  try{
    for(const id of ids)await mutate(async()=>{await sql`delete from public.artist_profiles where id=${id}`;await sql`delete from private.profile_audit where artist_id=${id}`;});
    console.log('PASS: synthetic rendering fixtures removed');
  }catch{failed=true;console.error('FAIL: inspect synthetic-step5-rendering fixtures in testing privately');}
  await sql.end({timeout:5});if(failed)process.exitCode=1;
}
