import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {GetObjectCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {loadBackendConfig,BackendConfigurationError} from '../src/server/config';
import {readPublishedArtists} from '../src/server/artists';
import {loadLegacyProfiles,publicLegacyProfile,checksum} from '../src/server/legacy-import';
import {createStorageClient,safeObjectKey} from '../src/server/storage';
import {readLimited} from '../src/server/remote-image';

// Read-only comparison. The placeholder file supplies candidate credentials only;
// no file is modified and no Netlify configuration validation is claimed.
let stage='configuration';
try{
  const testingEnv=parseEnv(await readFile('.env','utf8'));
  const productionEnv=parseEnv(await readFile('.env-prod','utf8'));
  const candidate={...productionEnv};
  const normalizedNames:string[]=[];
  for(const name of Object.keys(testingEnv).filter(name=>name.startsWith('BACKEND_'))){
    if(!candidate[name]){candidate[name]=testingEnv[name];normalizedNames.push(name);}
  }
  for(const name of ['SUPABASE_URL','R2_PUBLIC_BASE_URL']){
    if(candidate[name]&&!candidate[name].includes('://')){candidate[name]='https://'+candidate[name];normalizedNames.push(name);}
  }
  const pinnedUrl=`https://${candidate.BACKEND_PRODUCTION_SUPABASE_REF}.supabase.co`;
  if(candidate.SUPABASE_URL!==pinnedUrl&&candidate.SUPABASE_URL!==pinnedUrl+'/'){
    candidate.SUPABASE_URL=pinnedUrl;normalizedNames.push('SUPABASE_URL_FROM_PRODUCTION_PIN');
  }
  const testing=loadBackendConfig(testingEnv),production=loadBackendConfig(candidate);
  if(testing.APP_ENV!=='testing'||production.APP_ENV!=='production')throw new Error();
  stage='testing source comparison';
  const source=await loadLegacyProfiles('src/data/artists'),tested=await readPublishedArtists(testing);
  const sourceMap=new Map(source.map(row=>[row.id,row]));
  const differences=tested.filter(row=>!sourceMap.has(row.id)||checksum(publicLegacyProfile(row))!==checksum(publicLegacyProfile(sourceMap.get(row.id)!))).map(row=>row.id);
  const missing=source.filter(row=>!tested.some(actual=>actual.id===row.id)).map(row=>row.id);
  const storage=createStorageClient(testing,'published');
  const photos:Array<{artistId:string;sha256:string;bytes:number}>=[];
  try{
    for(const artist of tested){
      if(!artist.photoUrl)continue;
      const url=new URL(artist.photoUrl),base=new URL(testing.R2_PUBLIC_BASE_URL);
      if(url.origin!==base.origin||url.search||url.hash)throw new Error();
      const key=safeObjectKey(url.pathname.slice(1));
      const object=await storage.client.send(new GetObjectCommand({Bucket:storage.bucket,Key:key}));
      if(!object.Body||(object.ContentLength??0)>5*1024*1024)throw new Error();
      const bytes=await readLimited(object.Body as AsyncIterable<Uint8Array>);
      photos.push({artistId:artist.id,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
    }
  }finally{storage.client.destroy();}
  const report:Record<string,unknown>={createdAt:new Date().toISOString(),readOnly:true,normalizedCandidateFields:normalizedNames,
    testing:{profiles:tested.length,sourceProfiles:source.length,differentPublicProfiles:differences,missingPublicProfiles:missing,photos},production:{}};
  // Save testing evidence even if the production schema is not installed yet.
  await mkdir('.netlify/release-validation',{recursive:true});
  await writeFile('.netlify/release-validation/production-data-comparison.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({testingProfiles:tested.length,sourceProfiles:source.length,differentPublicProfiles:differences,missingPublicProfiles:missing,readableTestingPhotos:photos.length,normalizedCandidateFields:normalizedNames}));
  stage='production public inventory';
  let current:Awaited<ReturnType<typeof readPublishedArtists>>|undefined=undefined;
  try{current=await readPublishedArtists(production);}catch{
    console.log('Production public API inventory unavailable: schema, restricted key or connectivity requires checking. No writes performed.');
    const probe=await fetch(new URL('/rest/v1/artist_profiles?select=id&limit=1',production.SUPABASE_URL),{
      headers:{apikey:production.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(15000)});
    const body=await probe.json().catch(()=>({}));
    const code=typeof body.code==='string'&&/^[A-Z0-9_]{1,30}$/.test(body.code)?body.code:undefined;
    console.log(JSON.stringify({productionPublicApiStatus:probe.status,code}));
    process.exitCode=1;current=undefined;
  }
  const published=createStorageClient(production,'published');let objects=0,bytes=0,token:string|undefined;
  try{
    do{
      const page=await published.client.send(new ListObjectsV2Command({Bucket:published.bucket,ContinuationToken:token}));
      objects+=page.Contents?.length??0;bytes+=(page.Contents??[]).reduce((sum,row)=>sum+(row.Size??0),0);
      if(page.IsTruncated&&!page.NextContinuationToken)throw new Error();
      token=page.IsTruncated?page.NextContinuationToken:undefined;
    }while(token);
  }finally{published.client.destroy();}
  report.production={publicApiReadable:!!current,publishedProfiles:current?.length,publishedObjects:objects,publishedObjectBytes:bytes,
    conflictingProfileIds:current?.filter(row=>{const expected=tested.find(t=>t.id===row.id);return expected&&checksum(publicLegacyProfile(row))!==checksum(publicLegacyProfile(expected));}).map(row=>row.id)};
  await writeFile('.netlify/release-validation/production-data-comparison.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({production:report.production}));
}catch(error){
  if(error instanceof BackendConfigurationError)console.error(JSON.stringify({code:error.code,fields:error.fields}));
  console.error(`FAIL: read-only data comparison at ${stage}; credential/provider details withheld. No writes performed.`);
  process.exitCode=1;
}
