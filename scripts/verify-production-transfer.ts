import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import postgres from 'postgres';
import {productionTransferConfig} from './production-transfer-config';
import {importDatabaseTarget} from './legacy-import-context';
import {byteChecksum} from '../src/server/legacy-import';

let sql:ReturnType<typeof postgres>|undefined;
try{
  const {production,productionEnv}=await productionTransferConfig();
  const target=importDatabaseTarget(production,{...productionEnv,PRODUCTION_IMPORT_CONFIRM:production.BACKEND_PRODUCTION_SUPABASE_REF},true);
  const ca=target.caFile?await readFile(target.caFile,'utf8'):undefined;
  sql=postgres(target.url.href,{ssl:ca?{ca,rejectUnauthorized:true}:'verify-full',max:1,connect_timeout:10,onnotice:()=>{}});
  const migrations=await sql`select name,checksum from larparts_migrations.applied order by name`;
  assert.equal(migrations.length,8);
  for(const migration of migrations)assert.equal(byteChecksum(await readFile(`supabase/migrations/${migration.name}.sql`)),migration.checksum);
  const [counts]=await sql`select
    (select count(*)::int from public.artist_profiles where status='published') as profiles,
    (select count(*)::int from private.image_assets where visibility='published' and processing_state='processed') as photos,
    (select count(*)::int from private.legacy_profile_imports where state='completed') as completed_imports,
    (select count(*)::int from private.submissions) as submissions,
    (select count(*)::int from private.verification_tokens) as tokens,
    (select count(*)::int from private.notification_jobs) as notification_jobs,
    (select count(*)::int from private.image_sessions) as image_sessions,
    (select count(*)::int from private.historical_submissions) as historical_records,
    (select relrowsecurity from pg_class where oid='public.artist_profiles'::regclass) as public_rls,
    has_table_privilege('anon','private.submissions','SELECT') as anonymous_private_read,
    has_table_privilege('anon','public.artist_profiles','INSERT') as anonymous_public_insert`;
  assert.equal(counts.profiles,25);assert.equal(counts.photos,14);assert.equal(counts.completed_imports,25);
  for(const key of ['submissions','tokens','notification_jobs','image_sessions','historical_records'])assert.equal(counts[key],0);
  assert.equal(counts.public_rls,true);assert.equal(counts.anonymous_private_read,false);assert.equal(counts.anonymous_public_insert,false);
  const denied=await fetch(new URL('/rest/v1/submissions?select=id&limit=1',production.SUPABASE_URL),{
    headers:{apikey:production.SUPABASE_PUBLISHABLE_KEY,'Accept-Profile':'private'},signal:AbortSignal.timeout(15000)});
  assert.ok([401,403,406].includes(denied.status));
  const result={verifiedAt:new Date().toISOString(),passed:true,migrations:8,privateApiDenied:true,...counts};
  await writeFile('.netlify/release-validation/production-transfer-verification.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}catch{console.error('FAIL: production transfer verification; credentials and provider details withheld');process.exitCode=1;}
finally{await sql?.end({timeout:5});}
