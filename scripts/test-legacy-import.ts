import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {legacyImportContext} from './legacy-import-context';
import {createLegacyImportStore,importHistoricalRecords} from '../src/server/legacy-import-store';
import {importLegacyProfiles,planHistoricalImport,byteChecksum} from '../src/server/legacy-import';
import {readPublishedArtist} from '../src/server/artists';
import {publicPhotoUrl} from '../src/server/asset-urls';
import type {ArtistProfile} from '../src/data/artistProfile';

const {sql,config}=await legacyImportContext(),store=createLegacyImportStore(sql,config);
const suffix=randomUUID().replaceAll('-',''),id=`synthetic-legacy-${suffix}`,conflictId=`synthetic-legacy-conflict-${suffix}`,historyId=`synthetic-history-${suffix}`;
const artist:ArtistProfile={id,displayName:`Synthetic migration ${suffix}`,kingdom:'Northern Lights',awards:[],skills:['Synthetic weaving'],contact:{},photoUrl:'https://example.invalid/synthetic.png'};
const options={apply:true,checkImages:true,sourceLabel:'synthetic-step6',loadPhoto:async()=>sharp({create:{width:16,height:12,channels:3,background:'#985432'}}).png().toBuffer()};
let stage='runner lock',failed=false;
try{
  const [lock]=await sql`select pg_try_advisory_lock(101001006) as acquired`;assert.ok(lock.acquired);
  stage='interrupted object write';
  const interrupted={...store,putObject:async(...args:Parameters<typeof store.putObject>)=>{await store.putObject(...args);throw new Error('Simulated lost PUT response');}};
  assert.equal((await importLegacyProfiles([artist],interrupted,options))[0].state,'retry_required');
  assert.equal(await readPublishedArtist(config,id),null);
  stage='recover persisted object';
  const recovered=await importLegacyProfiles([artist],store,{...options,loadPhoto:async()=>{throw new Error('Original unavailable');}});
  if(recovered[0].state!=='completed')console.log(JSON.stringify({state:recovered[0].state,codes:recovered[0].warnings}));
  assert.equal(recovered[0].state,'completed');
  const snapshot=await store.snapshot(id);assert.ok(snapshot.asset);assert.ok(snapshot.receipt?.image_sha256);
  const publicImage=await fetch(publicPhotoUrl(config,snapshot.asset.object_key),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  assert.equal(publicImage.status,200);assert.equal(byteChecksum(new Uint8Array(await publicImage.arrayBuffer())),snapshot.receipt.image_sha256);
  assert.equal((await readPublishedArtist(config,id))?.displayName,artist.displayName);
  stage='private history synthetic-only dry-run/idempotency';
  const plan=planHistoricalImport([{sourceRecordId:historyId,artistId:id,email:`synthetic+${suffix}@example.invalid`}],new Set([id]));assert.ok(plan.valid);
  assert.equal((await importHistoricalRecords(sql,plan.records,'synthetic-step6',false)).planned,1);
  assert.equal((await importHistoricalRecords(sql,plan.records,'synthetic-step6',true)).inserted,1);
  assert.equal((await importHistoricalRecords(sql,plan.records,'synthetic-step6',true)).unchanged,1);
  const [historical]=await sql`select consent_at,consent_version,upgrade_notifications from private.historical_submissions where source_record_id=${historyId}`;
  assert.deepEqual(historical,{consent_at:null,consent_version:null,upgrade_notifications:null});
  stage='preserve actual database edits and unpublishing';
  await sql`select private.admin_change_profile(${id},1,${sql.json({...snapshot.profile!.profile as object,biography:'Synthetic later edit'})},'unpublished',${snapshot.asset.id}::uuid,'synthetic-step6','Prove reruns preserve operator changes')`;
  assert.equal((await importLegacyProfiles([artist],store,options))[0].state,'preserved_edit');assert.equal(await readPublishedArtist(config,id),null);
  assert.equal((await importLegacyProfiles([{...artist,displayName:'Source changed'}],store,options))[0].state,'source_changed');
  stage='identity collision and orphan abandonment';
  assert.equal((await importLegacyProfiles([{...artist,id:conflictId,photoUrl:undefined}],store,options))[0].state,'conflict');
  await store.abandon(conflictId);
  assert.equal((await importLegacyProfiles([{...artist,id:conflictId,photoUrl:undefined}],store,options))[0].state,'abandoned');
  console.log('PASS: testing import resume after R2 write, public delivery, restricted-key reads, historical null consent/idempotency, edit/unpublish preservation and identity conflict');
}catch{failed=true;console.error(`FAIL: migration probe at ${stage}; source/provider details suppressed`);}
finally{
  try{
    await sql`delete from private.historical_submissions where source_record_id=${historyId}`;
    await sql`select set_config('app.audit_actor','synthetic-step6',false),set_config('app.audit_reason','Remove only synthetic migration fixtures',false)`;
    for(const artistId of [id,conflictId]){
      // Synthetic-only cleanup is deliberately separate from the operator's safe abandon API.
      const snapshot=await store.snapshot(artistId);
      await sql`delete from public.artist_profiles where id=${artistId}`;
      await sql`delete from private.profile_audit where artist_id=${artistId}`;
      // Receipt is converted to an unreferenced fixture solely after deleting its synthetic history.
      if(snapshot.receipt){await sql`update private.legacy_profile_imports set state='conflict' where artist_id=${artistId}`;await store.abandon(artistId);}
      await sql`delete from private.legacy_profile_imports where artist_id=${artistId}`;
      if(snapshot.asset)await sql`delete from private.image_assets where id=${snapshot.asset.id}`;
    }
    console.log('PASS: synthetic migration records and object removed');
  }catch{failed=true;console.error('FAIL: inspect synthetic-step6 receipts and assets privately in testing');}
  store.close();await sql.end({timeout:5});if(failed)process.exitCode=1;
}
