import type {Sql} from 'postgres';
import {GetObjectCommand,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import type {BackendConfig} from './config';
import {createStorageClient} from './storage';
import {MAX_IMAGE_BYTES} from './image-processing';
import {readLimited} from './remote-image';
import {checksum,sourceLabelSchema,type HistoricalRecord,type ImportAsset,type ImportSnapshot,type LegacyImportStore} from './legacy-import';

export function createLegacyImportStore(sql:Sql,config:BackendConfig):LegacyImportStore&{close():void;abandon(id:string):Promise<void>}{
  const published=createStorageClient(config,'published');
  const validate=(asset:ImportAsset)=>{
    if(asset.bucket!==published.bucket||asset.object_key!==`legacy-imports/${asset.id}.webp`||!/^[0-9a-f-]{36}$/.test(asset.id))throw new Error('Unexpected import object');
  };
  return{
    publishedBucket:published.bucket,
    async snapshot(id){
      const [receipt]=await sql`select to_jsonb(r) as receipt,to_jsonb(a) as asset from private.legacy_profile_imports r left join private.image_assets a on a.id=r.asset_id where r.artist_id=${id}`;
      const [profile]=await sql`select id,profile,status,revision,image_asset_id,photo_key from public.artist_profiles where id=${id}`;
      return{receipt:receipt?.receipt??undefined,asset:receipt?.asset??undefined,profile} as ImportSnapshot;
    },
    async prepare(data){await sql`select private.legacy_profile_prepare(${sql.json(JSON.parse(JSON.stringify(data)))})`;},
    async commit(id,hash,imageHash){const [r]=await sql`select private.legacy_profile_commit(${id},${hash},${imageHash}) as state`;return r.state;},
    async readObject(asset){
      validate(asset);
      try{
        const object=await published.client.send(new GetObjectCommand({Bucket:published.bucket,Key:asset.object_key}));
        if(!object.Body||(object.ContentLength??0)>MAX_IMAGE_BYTES)throw new Error('Invalid stored image');
        return await readLimited(object.Body as AsyncIterable<Uint8Array>);
      }catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return null;throw error;}
    },
    async putObject(asset,bytes){
      validate(asset);
      try{await published.client.send(new PutObjectCommand({Bucket:published.bucket,Key:asset.object_key,Body:bytes,ContentType:'image/webp',StorageClass:'STANDARD',IfNoneMatch:'*',CacheControl:'public, max-age=31536000, immutable'}));}
      catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw error;}
    },
    async abandon(id){
      const [r]=await sql`select private.legacy_profile_abandon(${id}) as result`;
      const asset=r.result.asset as ImportAsset|null;
      if(asset){
        validate(asset);
        await published.client.send(new DeleteObjectCommand({Bucket:published.bucket,Key:asset.object_key}));
        await sql`update private.image_assets set processing_state='deleted' where id=${asset.id}`;
      }
      await sql`update private.legacy_profile_imports set object_deleted_at=now() where artist_id=${id} and state='abandoned'`;
    },
    close(){published.client.destroy();},
  };
}

export async function importHistoricalRecords(sql:Sql,records:HistoricalRecord[],sourceLabel:string,apply:boolean){
  sourceLabelSchema.parse(sourceLabel);
  const result={planned:0,inserted:0,unchanged:0,sourceChanged:0};
  // All-or-nothing prevents a malformed source from partially importing private data.
  await sql.begin(async tx=>{
    for(const r of records){
      const hash=checksum(r);
      const [existing]=await tx`select source_checksum from private.historical_submissions where source_record_id=${r.sourceRecordId}`;
      if(existing){existing.source_checksum===hash?result.unchanged++:result.sourceChanged++;continue;}
      if(!apply){result.planned++;continue;}
      const inserted=await tx`insert into private.historical_submissions(source_record_id,artist_id,email,consent_at,consent_version,upgrade_notifications,source_label,source_checksum)
        values(${r.sourceRecordId},${r.artistId},${r.email},${r.consentAt??null},${r.consentVersion??null},${r.upgradeNotifications??null},${sourceLabel},${hash}) on conflict do nothing returning source_record_id`;
      if(inserted.length)result.inserted++;
      else{const [current]=await tx`select source_checksum from private.historical_submissions where source_record_id=${r.sourceRecordId}`;
        current?.source_checksum===hash?result.unchanged++:result.sourceChanged++;}
    }
  });
  return result;
}
