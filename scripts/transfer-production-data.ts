import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import postgres from 'postgres';
import sharp from 'sharp';
import {GetObjectCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {productionTransferConfig} from './production-transfer-config';
import {importDatabaseTarget} from './legacy-import-context';
import {createStorageClient,safeObjectKey} from '../src/server/storage';
import {readPublishedArtists} from '../src/server/artists';
import {loadLegacyProfiles,checksum,byteChecksum,publicLegacyProfile} from '../src/server/legacy-import';
import {createLegacyImportStore} from '../src/server/legacy-import-store';
import {readLimited} from '../src/server/remote-image';

let stage='configuration',sql:ReturnType<typeof postgres>|undefined,close:(()=>void)|undefined;
const report:Record<string,unknown>={startedAt:new Date().toISOString(),stages:[]};
const path='.netlify/release-validation/production-transfer.json';
async function save(){await mkdir('.netlify/release-validation',{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n');}
try{
  const args=process.argv.slice(2);
  assert.equal(args.length,3);
  const apply=args[0]==='--apply';
  assert.ok(apply||args[0]==='--plan');assert.equal(args[1],'--confirm-project');
  const {testing,production,productionEnv}=await productionTransferConfig();
  assert.equal(args[2],production.BACKEND_PRODUCTION_SUPABASE_REF);
  const target=importDatabaseTarget(production,{...productionEnv,PRODUCTION_IMPORT_CONFIRM:args[2]},true);
  const ca=target.caFile?await readFile(target.caFile,'utf8'):undefined;
  sql=postgres(target.url.href,{ssl:ca?{ca,rejectUnauthorized:true}:'verify-full',max:1,connect_timeout:10,onnotice:()=>{}});
  const db=sql;
  stage='source preflight';
  const source=await loadLegacyProfiles('src/data/artists'),tested=await readPublishedArtists(testing);
  assert.equal(source.length,25);assert.equal(tested.length,source.length);
  const comparison=JSON.parse(await readFile('.netlify/release-validation/production-data-comparison.json','utf8'));
  const expectedPhotos=new Map<string,string>(comparison.testing.photos.map((row:{artistId:string;sha256:string})=>[row.artistId,row.sha256]));
  assert.equal(expectedPhotos.size,14);
  const plans=[];
  const storage=createStorageClient(testing,'published');
  try{
    for(const artist of source){
      const actual=tested.find(row=>row.id===artist.id);assert.ok(actual);
      assert.equal(checksum(publicLegacyProfile(actual)),checksum(publicLegacyProfile(artist)));
      let bytes:Buffer|undefined,width:number|undefined,height:number|undefined;
      if(actual.photoUrl){
        const url=new URL(actual.photoUrl);assert.equal(url.origin,new URL(testing.R2_PUBLIC_BASE_URL).origin);
        assert.ok(!url.search&&!url.hash);
        const key=safeObjectKey(url.pathname.slice(1));
        const object=await storage.client.send(new GetObjectCommand({Bucket:storage.bucket,Key:key}));assert.ok(object.Body);
        bytes=await readLimited(object.Body as AsyncIterable<Uint8Array>);
        assert.equal(byteChecksum(bytes),expectedPhotos.get(artist.id));
        const meta=await sharp(bytes,{limitInputPixels:40_000_000}).metadata();
        assert.equal(meta.format,'webp');assert.ok(meta.width&&meta.height&&meta.width<=1600&&meta.height<=1600);
        for(const field of ['exif','icc','iptc','xmp'] as const)assert.equal(meta[field],undefined);
        width=meta.width;height=meta.height;
      }else assert.ok(!expectedPhotos.has(artist.id));
      plans.push({artist,bytes,width,height,photoOutcome:bytes?'copied':artist.photoUrl?'unavailable':'none'});
    }
  }finally{storage.client.destroy();}
  assert.equal(plans.filter(p=>p.bytes).length,14);
  report.source={profiles:plans.length,photos:14,placeholders:plans.filter(p=>p.photoOutcome==='unavailable').length};
  stage='production preflight';
  // Serialize with the existing migration/import runner lock IDs.
  await db`select pg_advisory_lock(101001002)`;await db`select pg_advisory_lock(101001006)`;
  const tables=await db`select schemaname,tablename from pg_tables where schemaname in ('public','private','larparts_migrations') order by schemaname,tablename`;
  const [ledger]=await db`select to_regclass('larparts_migrations.applied') is not null as present`;
  const files=(await readdir('supabase/migrations')).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.equal(files.length,8);
  const migrations=await Promise.all(files.map(async file=>{const text=await readFile('supabase/migrations/'+file,'utf8');assert.match(text,/^begin;/);assert.match(text,/commit;\s*$/);return{name:file.slice(0,-4),text,hash:byteChecksum(Buffer.from(text))};}));
  const applied=ledger.present?await db`select name,checksum from larparts_migrations.applied`:[];
  for(const row of applied){const local=migrations.find(m=>m.name===row.name);assert.ok(local);assert.equal(local.hash,row.checksum);}
  // This initial rollout refuses an unmanaged populated schema instead of overwriting it.
  if(!ledger.present)assert.equal(tables.length,0,'Existing unmanaged tables require backup/review');
  report.preflight={tables:tables.map(row=>`${row.schemaname}.${row.tablename}`),appliedMigrations:applied.map(row=>row.name),
    emptyApplicationSchema:tables.length===0};
  const destination=createStorageClient(production,'published');
  try{
    const listing=await destination.client.send(new ListObjectsV2Command({Bucket:destination.bucket,MaxKeys:1}));
    if(!ledger.present)assert.equal(listing.KeyCount??listing.Contents?.length??0,0,'Existing assets require backup/review');
  }finally{destination.client.destroy();}
  // Initial empty-schema receipt is retained separately, never overwritten by retries.
  if(tables.length===0)await writeFile('.netlify/release-validation/production-empty-baseline.json',JSON.stringify({createdAt:new Date().toISOString(),projectRef:production.BACKEND_PRODUCTION_SUPABASE_REF,tables:[],publishedObjects:0},null,2)+'\n',{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  report.mode=apply?'apply':'plan';await save();
  console.log(JSON.stringify({mode:report.mode,source:report.source,existingTables:tables.length,appliedMigrations:applied.length}));
  if(apply){
    stage='migrations';
    await db`create schema if not exists larparts_migrations`;
    await db`revoke all on schema larparts_migrations from public, anon, authenticated, service_role`;
    await db`create table if not exists larparts_migrations.applied(name text primary key,checksum text not null,applied_at timestamptz not null default now())`;
    for(const migration of migrations){
      if(applied.some(row=>row.name===migration.name))continue;
      stage=`migration ${migration.name}`;
      await db.unsafe(migration.text.replace(/commit;\s*$/,`insert into larparts_migrations.applied(name,checksum) values ('${migration.name}','${migration.hash}');\ncommit;`));
      console.log(`Applied ${migration.name}`);
    }
    report.migrations=migrations.map(m=>({name:m.name,checksum:m.hash}));await save();
    stage='profile transfer';
    const store=createLegacyImportStore(db,production);close=()=>store.close();
    const transferred=[];
    for(const plan of plans){
      const {artist,bytes}=plan,hash=checksum(artist);
      let snapshot=await store.snapshot(artist.id);
      if(!snapshot.receipt){
        assert.ok(!snapshot.profile,'Existing profile without receipt requires review');
        await store.prepare({id:artist.id,checksum:hash,sourceLabel:'release-v1.0.1',profile:publicLegacyProfile(artist),
          photoOutcome:plan.photoOutcome,photoFailure:plan.photoOutcome==='unavailable'?'source_unavailable':null,
          asset:bytes?{bucket:store.publishedBucket,sha256:byteChecksum(bytes),byteSize:bytes.length,width:plan.width,height:plan.height}:null});
        snapshot=await store.snapshot(artist.id);
      }
      assert.ok(snapshot.receipt);assert.equal(snapshot.receipt.source_checksum,hash);
      assert.equal(snapshot.receipt.photo_outcome,plan.photoOutcome);
      assert.equal(snapshot.receipt.image_sha256??null,bytes?byteChecksum(bytes):null);
      if(snapshot.receipt.state==='prepared'){
        if(bytes){assert.ok(snapshot.asset);await store.putObject(snapshot.asset,bytes);const stored=await store.readObject(snapshot.asset);assert.ok(stored);assert.equal(byteChecksum(stored),byteChecksum(bytes));}
        const result=await store.commit(artist.id,hash,bytes?byteChecksum(bytes):null);assert.equal(result,'completed');
      }else assert.equal(snapshot.receipt.state,'completed');
      snapshot=await store.snapshot(artist.id);assert.ok(snapshot.profile);assert.equal(snapshot.profile.status,'published');
      assert.equal(checksum(snapshot.profile.profile),checksum(publicLegacyProfile(artist)));
      if(bytes){assert.ok(snapshot.asset);const copied=await store.readObject(snapshot.asset);assert.ok(copied);assert.equal(byteChecksum(copied),byteChecksum(bytes));}
      transferred.push({artistId:artist.id,photo:plan.photoOutcome,sha256:bytes?byteChecksum(bytes):null});
      report.transferred=transferred;await save();
    }
    stage='restricted public verification';
    await db`notify pgrst, 'reload schema'`;
    const published=await readPublishedArtists(production);assert.equal(published.length,plans.length);
    for(const plan of plans){
      const actual=published.find(row=>row.id===plan.artist.id);assert.ok(actual);
      assert.equal(checksum(publicLegacyProfile(actual)),checksum(publicLegacyProfile(plan.artist)));
      if(plan.bytes){assert.ok(actual.photoUrl);const url=new URL(actual.photoUrl);assert.equal(url.origin,new URL(production.R2_PUBLIC_BASE_URL).origin);
        const response=await fetch(url,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.ok(response.body);
        assert.equal(byteChecksum(await readLimited(response.body)),byteChecksum(plan.bytes));
      }else assert.equal(actual.photoUrl,undefined);
    }
    report.verified={profiles:published.length,storedAndPublicPhotos:14,privateRuntimeCopied:false};
    console.log(JSON.stringify({passed:true,profiles:published.length,storedAndPublicPhotos:14,privateRuntimeCopied:false}));
  }
  report.completedAt=new Date().toISOString();await save();
}catch(error){
  const code=(error as {code?:string}).code;
  report.failure={stage,code:code&&/^[A-Z0-9_]{1,60}$/.test(code)?code:'validation_or_provider_failure'};
  await save();console.error(JSON.stringify(report.failure));process.exitCode=1;
}finally{close?.();await sql?.end({timeout:5});}
