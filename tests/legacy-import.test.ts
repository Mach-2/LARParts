import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {checksum,importLegacyProfiles,legacyPhotoBytes,loadLegacyProfiles,planHistoricalImport,prepareLegacyPhoto,type ImportSnapshot,type LegacyImportStore} from '../src/server/legacy-import';
import type {ArtistProfile} from '../src/data/artistProfile';

const artist:ArtistProfile={id:'legacy-example',displayName:'Legacy Example',kingdom:'Northern Lights',awards:[],skills:['Sewing'],contact:{},photoUrl:'https://example.invalid/photo.png'};
const image=()=>sharp({create:{width:16,height:12,channels:3,background:'#937356'}}).png().toBuffer();
function memoryStore(){
  let snapshot:ImportSnapshot={},object:Buffer|null=null,commits=0,writes=0;
  const store:LegacyImportStore={publishedBucket:'test-published',snapshot:async()=>snapshot,
    prepare:async(data:any)=>{
      const id=randomUUID();snapshot={receipt:{artist_id:data.id,source_checksum:data.checksum,state:'prepared',photo_outcome:data.photoOutcome,photo_failure:data.photoFailure,image_sha256:data.asset?.sha256,asset_id:data.asset?id:null},
        asset:data.asset?{id,bucket:'test-published',object_key:`legacy-imports/${id}.webp`,width:data.asset.width,height:data.asset.height,byte_size:data.asset.byteSize,processing_state:'pending'}:undefined};
    },readObject:async()=>object,putObject:async(_asset,bytes)=>{object=bytes;writes++;},
    commit:async()=>{commits++;snapshot.receipt!.state='completed';snapshot.receipt!.imported_revision=1;
      snapshot.profile={id:artist.id,profile:{displayName:artist.displayName},status:'published',revision:1,image_asset_id:snapshot.asset?.id??null,photo_key:snapshot.asset?.object_key??null};return'completed';},
  };
  return{store,get snapshot(){return snapshot;},get commits(){return commits;},get writes(){return writes;}};
}
const options={apply:true,checkImages:true,sourceLabel:'synthetic',loadPhoto:async()=>image()};

test('legacy dry-run does no storage/database writes and does not download unless requested',async()=>{
  const memory=memoryStore();let reads=0;
  const rows=await importLegacyProfiles([artist],memory.store,{...options,apply:false,checkImages:false,loadPhoto:async()=>{reads++;return image();}});
  assert.equal(rows[0].state,'planned');assert.equal(rows[0].photoOutcome,'not_checked');assert.equal(reads,0);assert.equal(memory.writes,0);assert.equal(memory.commits,0);assert.equal(memory.snapshot.receipt,undefined);
});
test('legacy image source/decode failures yield reported placeholders without scraping',async()=>{
  assert.deepEqual(await prepareLegacyPhoto(artist,async()=>{throw new Error('private URL details');}),{outcome:'unavailable',failure:'source_unavailable'});
  assert.deepEqual(await prepareLegacyPhoto(artist,async()=>Buffer.from('<html><img src="https://example.invalid/hidden.jpg"></html>')),{outcome:'unavailable',failure:'invalid_image'});
  const rows=await importLegacyProfiles([artist],memoryStore().store,{...options,loadPhoto:async()=>Buffer.from('not an image')});
  assert.equal(rows[0].state,'completed');assert.equal(rows[0].photoOutcome,'unavailable');assert.ok(!JSON.stringify(rows).includes('https://'));
  await assert.rejects(legacyPhotoBytes('/photos/%2e%2e%2f.env','public'));
  await assert.rejects(legacyPhotoBytes('/photos/..\\.env','public'));
});
test('interruption after R2 upload resumes the persisted object without refetching its source',async()=>{
  const memory=memoryStore(),put=memory.store.putObject;
  memory.store.putObject=async(asset,bytes)=>{await put(asset,bytes);throw new Error('Response lost');};
  const first=await importLegacyProfiles([artist],memory.store,options);assert.equal(first[0].state,'retry_required');assert.equal(memory.commits,0);
  memory.store.putObject=put;
  const second=await importLegacyProfiles([artist],memory.store,{...options,loadPhoto:async()=>{throw new Error('Must not refetch');}});
  assert.equal(second[0].state,'completed');assert.equal(memory.writes,1);assert.equal(memory.commits,1);
});
test('ambiguous commits, later edits/unpublish, deleted imports and changed JSON never overwrite',async()=>{
  const memory=memoryStore(),commit=memory.store.commit;
  memory.store.commit=async(...args)=>{await commit(...args);throw new Error('Commit response lost');};
  assert.equal((await importLegacyProfiles([artist],memory.store,options))[0].state,'retry_required');
  assert.equal((await importLegacyProfiles([artist],memory.store,options))[0].state,'unchanged');
  memory.snapshot.profile!.revision=2;memory.snapshot.profile!.status='unpublished';
  assert.equal((await importLegacyProfiles([artist],memory.store,options))[0].state,'preserved_edit');
  assert.equal((await importLegacyProfiles([{...artist,displayName:'Changed JSON'}],memory.store,options))[0].state,'source_changed');
  delete memory.snapshot.profile;
  assert.equal((await importLegacyProfiles([artist],memory.store,options))[0].state,'preserved_deleted');assert.equal(memory.commits,1);assert.equal(memory.writes,1);
});
test('private history preserves factual null consent and email aliases; ambiguous/missing/duplicate input is blocked',()=>{
  const input={sourceRecordId:'synthetic-1',artistId:artist.id,email:'  Example+Artist@Example.invalid  '};
  const plan=planHistoricalImport([input],new Set([artist.id]));assert.equal(plan.valid,true);assert.equal(plan.records[0].email,'example+artist@example.invalid');assert.equal(plan.records[0].consentAt,undefined);
  const invalid=planHistoricalImport([input,{...input,artistId:'missing-id'}],new Set([artist.id]));
  assert.deepEqual(invalid.issues,{missingArtists:1,duplicateRecords:2,ambiguousEmails:2});assert.equal(invalid.valid,false);
  assert.throws(()=>planHistoricalImport([{...input,verified:true}],new Set()),error=>!String(error).includes(input.email));
  assert.equal(checksum({b:1,a:2}),checksum({a:2,b:1}));
  for(const preference of [true,false,null,undefined]){
    const minimal={artistId:artist.id,email:'synthetic@example.invalid',...(preference===undefined?{}:{upgradeNotifications:preference})};
    const normalized=planHistoricalImport([minimal],new Set([artist.id]));
    assert.ok(normalized.valid);assert.equal(normalized.records[0].sourceRecordId,artist.id);
    assert.equal(normalized.records[0].upgradeNotifications,preference);
    assert.equal(checksum(normalized.records[0]),checksum(planHistoricalImport([{...minimal,sourceRecordId:artist.id}],new Set([artist.id])).records[0]));
  }
  const minimal={artistId:artist.id,email:'synthetic@example.invalid'};
  assert.equal(planHistoricalImport([minimal,minimal],new Set([artist.id])).issues.duplicateRecords,2);
  assert.throws(()=>planHistoricalImport([{...minimal,upgradeNotifications:'true'}],new Set([artist.id])));
});
test('checked-in public source retains stable IDs and validates as one directory',async()=>{
  const profiles=await loadLegacyProfiles('src/data/artists');assert.ok(profiles.length>0);assert.ok(profiles.some(p=>p.id==='nl-0002'));
});
