import assert from 'node:assert/strict';
import sharp from 'sharp';
import {legacyImportContext} from './legacy-import-context';
import {createLegacyImportStore} from '../src/server/legacy-import-store';
import {loadLegacyProfiles,checksum,byteChecksum,publicLegacyProfile,prepareLegacyPhoto,legacyPhotoBytes,type ImportAsset} from '../src/server/legacy-import';
import {readPublishedArtists,readPublishedArtist} from '../src/server/artists';

const {sql,config}=await legacyImportContext(),store=createLegacyImportStore(sql,config);
const allowCorrections=process.argv.includes('--allow-audited-corrections');
const args=process.argv.slice(2).filter(arg=>arg!=='--allow-audited-corrections');let origin:string|undefined;
if(args.length){
  if(args.length!==2||args[0]!=='--http-origin')throw new Error('Expected optional loopback HTTP origin');
  const url=new URL(args[1]);if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('HTTP probe must target loopback origin');origin=url.origin;
}
let stage='source and published directory',failed=false;
try{
  const source=await loadLegacyProfiles('src/data/artists'),published=await readPublishedArtists(config);
  const map=new Map(published.map(a=>[a.id,a]));let copied=0,placeholders=0,noPhoto=0;
  const auditedCorrections:string[]=[];
  const checks:Array<{artistId:string;state:string;photo:string}>=[];
  async function page(path:string){
    const response=await fetch(origin+path,{cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
    for(const h of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.equal(response.headers.get(h),'no-store');
    return response.text();
  }
  const directoryHtml=origin?await page('/artists/'):undefined;
  for(const artist of source){
    stage=`compare public profile ${artist.id}`;
    const snapshot=await store.snapshot(artist.id),actual=map.get(artist.id);
    assert.ok(snapshot.receipt);assert.equal(snapshot.receipt.state,'completed');assert.ok(actual);
    let asset=snapshot.asset,expectedDigest=snapshot.receipt.image_sha256;
    const corrected=snapshot.receipt.source_checksum!==checksum(artist)||String(snapshot.profile?.revision)!==String(snapshot.receipt.imported_revision);
    if(corrected){
      assert.ok(allowCorrections,'Post-import edit/source change requires explicit audited comparison');
      const [audit]=await sql`select a.id from private.profile_audit a join public.artist_profiles p on p.id=a.artist_id
        where p.id=${artist.id} and a.operation='UPDATE' and length(btrim(a.actor))>0 and length(btrim(a.reason))>0
        and (a.after_row->>'revision')::bigint=p.revision
        and (a.before_row->>'revision')::bigint>=${snapshot.receipt.imported_revision??1}
        and a.after_row->'profile'=p.profile and a.after_row->>'status'=p.status
        and (a.after_row->>'image_asset_id') is not distinct from p.image_asset_id::text limit 1`;
      assert.ok(audit,'Current correction must have matching audit evidence');
      const photo=await prepareLegacyPhoto(artist,source=>legacyPhotoBytes(source,'public'));
      if(snapshot.profile?.image_asset_id){
        assert.equal(photo.outcome,'copied');assert.ok(photo.outcome==='copied');expectedDigest=photo.sha256;
        const [current]=await sql`select id,bucket,object_key,width,height,byte_size,processing_state from private.image_assets where id=${snapshot.profile.image_asset_id}`;
        assert.ok(current);assert.equal(current.processing_state,'processed');asset=current as ImportAsset;
      }else{assert.equal(photo.outcome,'none');asset=undefined;expectedDigest=null;}
      auditedCorrections.push(artist.id);
    }
    assert.equal(checksum(publicLegacyProfile(actual)),checksum(publicLegacyProfile(artist)));
    assert.equal(checksum(await readPublishedArtist(config,artist.id)),checksum(actual));
    if(asset){
      const bytes=await store.readObject(asset);assert.ok(bytes);assert.equal(byteChecksum(bytes),expectedDigest);
      const metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,asset.width);assert.equal(metadata.height,asset.height);
      for(const field of ['exif','icc','iptc','xmp'] as const)assert.equal(metadata[field],undefined);
      assert.ok(actual.photoUrl?.startsWith(config.R2_PUBLIC_BASE_URL.replace(/\/$/,'')+'/legacy-imports/'));
      const response=await fetch(actual.photoUrl!,{cache:'no-store',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.equal(byteChecksum(new Uint8Array(await response.arrayBuffer())),expectedDigest);copied++;
    }else{
      assert.equal(actual.photoUrl,undefined);snapshot.receipt.photo_outcome==='unavailable'?placeholders++:noPhoto++;
    }
    if(origin){
      const html=await page(`/artists/${artist.id}/`);assert.ok(html.includes('<title>'));assert.ok(directoryHtml?.includes(`/artists/${artist.id}/`));
      if(artist.kingdom){const slug=artist.kingdom.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');await page(`/kingdoms/${slug}/`);}
    }
    checks.push({artistId:artist.id,state:'matched',photo:snapshot.receipt.photo_outcome});
  }
  if(origin)await page('/');
  // Other unrelated testing profiles are allowed; every source ID must be accounted for.
  console.log(JSON.stringify({sourceProfiles:source.length,matched:checks.length,totalPublished:published.length,copiedPhotos:copied,unavailablePhotoPlaceholders:placeholders,profilesWithoutPhoto:noPhoto,httpChecked:!!origin,auditedCorrections}));
  console.log('PASS: source fields/stable IDs, restricted reads, processed image metadata/digests and public image delivery');
}catch{failed=true;console.error(`FAIL: migration verification at ${stage}; source/provider details suppressed`);}
finally{store.close();await sql.end({timeout:5});if(failed)process.exitCode=1;}
