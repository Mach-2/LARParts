import {createHash} from 'node:crypto';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {z} from 'zod';
import {parseArtistFiles,type ArtistProfile} from '../data/artistProfile';
import {processImage,MAX_IMAGE_BYTES} from './image-processing';
import {fetchRemoteImage} from './remote-image';

export function checksum(value:unknown):string{
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?
    Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export const byteChecksum=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const sourceLabelSchema=z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/);
export async function loadLegacyProfiles(directory:string):Promise<ArtistProfile[]>{
  const files:Record<string,unknown>={};
  for(const name of (await readdir(directory)).filter(n=>n.endsWith('.json')).sort()){
    files[name]=JSON.parse(await readFile(resolve(directory,name),'utf8'));
  }
  return parseArtistFiles(files);
}
export function publicLegacyProfile(artist:ArtistProfile){const {id:_,photoUrl:__,...profile}=artist;return profile;}
export async function legacyPhotoBytes(source:string,publicDirectory:string):Promise<Buffer>{
  if(source.startsWith('/photos/')){
    // Only a single file under the real photos directory; symlinks cannot escape.
    const name=decodeURIComponent(source.slice('/photos/'.length));
    if(!name||/[\\/?#\0]/.test(name)||name==='.'||name==='..')throw new Error('Invalid local image path');
    const root=await realpath(resolve(publicDirectory,'photos'));
    const path=await realpath(resolve(root,name));
    if(!path.startsWith(root+sep)||dirname(path)!==root)throw new Error('Invalid local image path');
    const info=await stat(path);if(!info.isFile()||info.size>MAX_IMAGE_BYTES)throw new Error('Local image unavailable');
    return readFile(path);
  }
  return fetchRemoteImage(source);
}
export type ProcessedPhoto=Awaited<ReturnType<typeof processImage>>;
type PhotoResult={outcome:'none'|'unavailable';failure?:'source_unavailable'|'invalid_image'}|
  {outcome:'copied';image:ProcessedPhoto;sha256:string};
export async function prepareLegacyPhoto(artist:ArtistProfile,loader:(source:string)=>Promise<Buffer>):Promise<PhotoResult>{
  if(!artist.photoUrl)return{outcome:'none'};
  let bytes:Buffer;try{bytes=await loader(artist.photoUrl);}catch{return{outcome:'unavailable',failure:'source_unavailable'};}
  try{const image=await processImage(bytes);return{outcome:'copied',image,sha256:byteChecksum(image.bytes)};}
  catch{return{outcome:'unavailable',failure:'invalid_image'};}
}
export interface ImportAsset{id:string;bucket:string;object_key:string;width:number;height:number;byte_size:number;processing_state:string}
export interface ImportReceipt{artist_id:string;source_checksum:string;state:'prepared'|'completed'|'conflict'|'abandoned';photo_outcome:'none'|'copied'|'unavailable';photo_failure?:string|null;image_sha256?:string|null;imported_revision?:number|string|null;asset_id?:string|null}
export interface ImportSnapshot{receipt?:ImportReceipt;asset?:ImportAsset;profile?:{id:string;profile:unknown;status:string;revision:number|string;image_asset_id:string|null;photo_key:string|null}}
export interface LegacyImportStore{
  publishedBucket:string;
  snapshot(id:string):Promise<ImportSnapshot>;
  prepare(data:unknown):Promise<void>;
  commit(id:string,sourceChecksum:string,imageHash:string|null):Promise<string>;
  readObject(asset:ImportAsset):Promise<Buffer|null>;
  putObject(asset:ImportAsset,bytes:Buffer):Promise<void>;
}
export interface ImportReportRow{artistId:string;state:string;photoOutcome:string;photoFailure?:string;warnings:string[];sourceChecksum:string}
export async function importLegacyProfiles(artists:ArtistProfile[],store:LegacyImportStore,options:{apply:boolean;checkImages:boolean;sourceLabel:string;loadPhoto:(source:string)=>Promise<Buffer>;onRow?:(row:ImportReportRow)=>void}){
  sourceLabelSchema.parse(options.sourceLabel);
  const report:ImportReportRow[]=[];
  for(const artist of artists){
    const hash=checksum(artist);let snapshot=await store.snapshot(artist.id);
    const warnings:string[]=[];
    const row:ImportReportRow={artistId:artist.id,state:'planned',photoOutcome:artist.photoUrl?'not_checked':'none',warnings,sourceChecksum:hash};
    const append=()=>{report.push(row);options.onRow?.(row);};
    const receipt=snapshot.receipt;
    if(receipt){
      row.photoOutcome=receipt.photo_outcome;if(receipt.photo_failure)row.photoFailure=receipt.photo_failure;
      if(receipt.source_checksum!==hash){row.state='source_changed';append();continue;}
      if(receipt.state!=='prepared'){
        row.state=receipt.state==='completed'?(!snapshot.profile?'preserved_deleted':
          String(snapshot.profile.revision)!==String(receipt.imported_revision)?'preserved_edit':'unchanged'):receipt.state;
        append();continue;
      }
    }else if(snapshot.profile){row.state='existing_preserved';append();continue;}
    let photo:PhotoResult|undefined;
    if(!receipt&&(options.apply||options.checkImages)){
      photo=await prepareLegacyPhoto(artist,options.loadPhoto);row.photoOutcome=photo.outcome;
      if(photo.outcome==='unavailable')row.photoFailure=photo.failure;
    }
    if(!options.apply){row.state=receipt?'resume_planned':'planned';append();continue;}
    let stage='reserve';
    try{
      if(!receipt){
        if(!photo)throw new Error('Photo preflight missing');
        await store.prepare({id:artist.id,checksum:hash,sourceLabel:options.sourceLabel,profile:publicLegacyProfile(artist),
          photoOutcome:photo.outcome,photoFailure:photo.outcome==='unavailable'?photo.failure:null,
          asset:photo.outcome==='copied'?{bucket:store.publishedBucket,sha256:photo.sha256,byteSize:photo.image.bytes.length,width:photo.image.width,height:photo.image.height}:null});
        snapshot=await store.snapshot(artist.id);
      }
      const active=snapshot.receipt;
      if(!active){row.state='existing_preserved';append();continue;}
      if(active.source_checksum!==hash)throw new Error('Concurrent source changed');
      if(active.state!=='prepared'){row.state=active.state;append();continue;}
      if(active.asset_id){
        stage='read_prepared_object';
        const asset=snapshot.asset;
        if(!asset||asset.bucket!==store.publishedBucket||asset.object_key!==`legacy-imports/${asset.id}.webp`)throw new Error('Unexpected import asset');
        let bytes=await store.readObject(asset);
        if(!bytes){
          stage='copy_prepared_object';
          if(photo?.outcome!=='copied')photo=await prepareLegacyPhoto(artist,options.loadPhoto);
          if(photo.outcome!=='copied'||photo.sha256!==active.image_sha256)throw new Error('Original prepared image changed or unavailable');
          await store.putObject(asset,photo.image.bytes);bytes=await store.readObject(asset);
        }
        if(!bytes||byteChecksum(bytes)!==active.image_sha256||bytes.length!==asset.byte_size)throw new Error('Stored image differs');
      }
      stage='commit_profile';
      row.state=await store.commit(artist.id,hash,active.image_sha256??null);
      row.photoOutcome=active.photo_outcome;if(active.photo_failure)row.photoFailure=active.photo_failure;
    }catch(error){
      row.state='retry_required';warnings.push(stage);
      const code=(error as {code?:string}).code,status=(error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode;
      if(code&&/^[A-Z0-9_]{1,40}$/.test(code))warnings.push(code);
      if(status)warnings.push(`HTTP_${status}`);
      for(const field of ['table_name','column_name'] as const){
        const value=(error as Record<string,unknown>)[field];
        if(typeof value==='string'&&/^[a-z_]{1,60}$/.test(value))warnings.push(value);
      }
    }
    append();
  }
  return report;
}

const historySchema=z.object({
  sourceRecordId:z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/).optional(),artistId:z.string().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  email:z.string().trim().pipe(z.email().max(254)).transform(v=>v.toLowerCase()),
  consentAt:z.iso.datetime({offset:true}).nullable().optional(),consentVersion:z.string().trim().min(1).max(100).nullable().optional(),
  upgradeNotifications:z.boolean().nullable().optional(),
}).strict().transform(record=>({...record,sourceRecordId:record.sourceRecordId??record.artistId}));
export type HistoricalRecord=z.infer<typeof historySchema>;
export function planHistoricalImport(input:unknown,artistIds:Set<string>){
  const parsed=z.array(historySchema).max(100000).safeParse(input);
  if(!parsed.success)throw new Error('Invalid private history file; values suppressed');
  const records=parsed.data;const ids=new Map<string,number>(),emails=new Map<string,Set<string>>();
  for(const r of records){ids.set(r.sourceRecordId,(ids.get(r.sourceRecordId)??0)+1);const set=emails.get(r.email)??new Set<string>();set.add(r.artistId);emails.set(r.email,set);}
  const issues={missingArtists:0,duplicateRecords:0,ambiguousEmails:0};
  for(const r of records){if(!artistIds.has(r.artistId))issues.missingArtists++;if(ids.get(r.sourceRecordId)!==1)issues.duplicateRecords++;if(emails.get(r.email)!.size>1)issues.ambiguousEmails++;}
  return{records,issues,valid:!Object.values(issues).some(Boolean)};
}
