import {readFile,mkdir,writeFile,realpath,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {legacyImportContext} from './legacy-import-context';
import {createLegacyImportStore,importHistoricalRecords} from '../src/server/legacy-import-store';
import {importLegacyProfiles,loadLegacyProfiles,legacyPhotoBytes,planHistoricalImport,sourceLabelSchema} from '../src/server/legacy-import';

const args=process.argv.slice(2),allowed=new Set(['--apply','--check-images','--history','--source-label','--abandon']);
function option(name:string){const index=args.indexOf(name);return index<0?undefined:args[index+1];}
let stage='configuration',close:(()=>void)|undefined,finish:(()=>Promise<void>)|undefined;
try{
  for(let i=0;i<args.length;i++){
    const name=args[i];if(!allowed.has(name))throw new Error('Unknown import argument');
    if(['--history','--source-label','--abandon'].includes(name)){if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing import argument');i++;}
  }
  const apply=args.includes('--apply'),sourceLabel=sourceLabelSchema.parse(option('--source-label')??'release-v1.0.1');
  const {sql,config}=await legacyImportContext(true);finish=()=>sql.end({timeout:5});
  // Only import/abandon runners contend on this lock; public reads/admin edits continue.
  const [lock]=await sql`select pg_try_advisory_lock(101001006) as acquired`;
  if(!lock.acquired)throw new Error('Another import runner is active');
  const store=createLegacyImportStore(sql,config);close=()=>store.close();
  const abandon=option('--abandon');
  if(abandon){
    if(!apply||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(abandon))throw new Error('Abandon requires explicit apply and valid ID');
    stage='abandon prepared/conflicted image';await store.abandon(abandon);console.log('PASS: import abandoned and unreferenced object removed');
  }else if(option('--history')){
    stage='private history validation';
    const path=await realpath(resolve(option('--history')!));const root=(await realpath('.')).toLowerCase();
    if(path.toLowerCase()===root||path.toLowerCase().startsWith(root+sep))throw new Error('Private history must be outside the Git repository');
    if((await stat(path)).size>20*1024*1024)throw new Error('Private source file too large');
    const input=JSON.parse(await readFile(path,'utf8'));
    const ids=new Set((await sql`select id from public.artist_profiles`).map(r=>r.id as string));
    const plan=planHistoricalImport(input,ids);
    // Counts only, never paths, emails, consent values, or private record identifiers.
    console.log(JSON.stringify({mode:apply?'apply':'dry-run',records:plan.records.length,issues:plan.issues}));
    if(!plan.valid)throw new Error('Private source has unresolved issues');
    if(apply&&config.APP_ENV==='testing'&&plan.records.some(r=>!r.email.endsWith('@example.invalid')))throw new Error('Testing history imports must use synthetic example.invalid addresses');
    stage='private history import';console.log(JSON.stringify(await importHistoricalRecords(sql,plan.records,sourceLabel,apply)));
  }else{
    stage='public source validation';const artists=await loadLegacyProfiles('src/data/artists');
    stage='public profile and image import';
    const report=await importLegacyProfiles(artists,store,{apply,checkImages:args.includes('--check-images'),sourceLabel,
      loadPhoto:source=>legacyPhotoBytes(source,'public'),onRow:r=>console.log(`${r.artistId}: ${r.state}; photo=${r.photoOutcome}${r.photoFailure?`; ${r.photoFailure}`:''}`)});
    await mkdir('.netlify/migration-reports',{recursive:true});
    await writeFile(`.netlify/migration-reports/${apply?'apply':'dry-run'}.json`,JSON.stringify({mode:apply?'apply':'dry-run',sourceLabel,createdAt:new Date().toISOString(),profiles:report},null,2)+'\n');
    console.log(JSON.stringify({mode:apply?'apply':'dry-run',sourceProfiles:artists.length,states:report.reduce<Record<string,number>>((a,r)=>(a[r.state]=(a[r.state]??0)+1,a),{}),photoFollowUps:report.filter(r=>r.photoOutcome==='unavailable').length}));
    if(report.some(r=>['retry_required','conflict','source_changed','abandoned'].includes(r.state)))process.exitCode=1;
  }
}catch{console.error(`FAIL: legacy import at ${stage}; private source/provider details suppressed`);process.exitCode=1;}
finally{close?.();await finish?.();}
