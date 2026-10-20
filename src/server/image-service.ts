import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { GetObjectCommand,PutObjectCommand,DeleteObjectCommand,ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import type { BackendConfig } from './config';
import { createStorageClient } from './storage';
import { processImage,MAX_IMAGE_BYTES,IMAGE_TYPES } from './image-processing';
import { fetchRemoteImage,readLimited } from './remote-image';

const sessionSchema=z.object({id:z.uuid(),mode:z.enum(['upload','remote']),state:z.string(),lease_id:z.uuid().nullable(),
  expected_bytes:z.number().nullable(),expected_type:z.string().nullable(),asset_id:z.uuid().nullable(),expires_at:z.string()});
export type ImageSession=z.infer<typeof sessionSchema>;
export const capabilityHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export type ImageRpc=(action:string,id?:string,hash?:string,data?:Record<string,unknown>)=>Promise<unknown>;
export function createImageRpc(config:BackendConfig):ImageRpc {
  return async(action,id,hash,data={})=>{
    const response=await fetch(new URL('/rest/v1/rpc/image_session_operation',config.SUPABASE_URL),{
      method:'POST',headers:{apikey:config.SUPABASE_SECRET_KEY,'content-type':'application/json'},
      body:JSON.stringify({p_action:action,p_id:id??null,p_hash:hash??null,p_data:data}),signal:AbortSignal.timeout(15000),cache:'no-store',
    });
    if(!response.ok) throw new Error('Image operation unavailable');
    return response.json();
  };
}

export class ImageService {
  private storage;
  constructor(config:BackendConfig,private rpc:ImageRpc=createImageRpc(config)) {
    this.storage=createStorageClient(config,'temporary');
  }
  close(){this.storage.client.destroy();}
  async start(mode:'upload'|'remote',bytes?:number,type?:string) {
    if(mode==='upload' && (!Number.isInteger(bytes) || !bytes || bytes>MAX_IMAGE_BYTES || bytes<1 || !IMAGE_TYPES.includes(type as typeof IMAGE_TYPES[number]))) throw new Error('Invalid image upload');
    const id=randomUUID(),capability=randomBytes(32).toString('base64url');
    await this.rpc('start',id,capabilityHash(capability),{mode,bytes,type});
    const uploadUrl=mode==='upload' ? await getSignedUrl(this.storage.client,new PutObjectCommand({
      Bucket:this.storage.bucket,Key:`raw/${id}/original`,ContentType:type,ContentLength:bytes,
    }),{expiresIn:300,signableHeaders:new Set(['content-type','content-length'])}) : undefined;
    return {sessionId:id,capability,uploadUrl,expiresIn:uploadUrl?300:undefined};
  }
  async get(id:string,capability:string){return sessionSchema.parse(await this.rpc('get',id,capabilityHash(capability)));}
  async process(id:string,capability:string,sourceUrl?:string) {
    const hash=capabilityHash(capability);
    const session=sessionSchema.parse(await this.rpc('claim',id,hash));
    if(session.state==='ready') return this.preview(id,capability);
    const key=`processed/${id}/${session.lease_id}.webp`;
    let stored=false;
    try {
      let source:Buffer;
      if(session.mode==='remote') {
        if(!sourceUrl) throw new Error('Direct image URL required');
        source=await fetchRemoteImage(sourceUrl);
      } else {
        if(sourceUrl) throw new Error('Upload sessions cannot fetch URLs');
        const object=await this.storage.client.send(new GetObjectCommand({Bucket:this.storage.bucket,Key:`raw/${id}/original`}),{abortSignal:AbortSignal.timeout(15000)});
        if(!object.Body || object.ContentLength!==session.expected_bytes || (object.ContentLength??0)>MAX_IMAGE_BYTES) {
          object.Body?.transformToWebStream().cancel(); throw new Error('Invalid uploaded image size');
        }
        source=await readLimited(object.Body as AsyncIterable<Uint8Array>);
        if(source.length!==session.expected_bytes) throw new Error('Incomplete image upload');
      }
      const processed=await processImage(source);
      await this.storage.client.send(new PutObjectCommand({Bucket:this.storage.bucket,Key:key,Body:processed.bytes,
        ContentType:'image/webp',CacheControl:'private, no-store',StorageClass:'STANDARD',IfNoneMatch:'*'}));
      stored=true;
      // Never delete an object on an ambiguous finish response: DB may have committed.
      await this.rpc('finish',id,hash,{lease:session.lease_id,bucket:this.storage.bucket,bytes:processed.bytes.length,width:processed.width,height:processed.height});
      // Raw URL can still be reused for five minutes. It can only affect raw/.
      return await this.preview(id,capability);
    } catch {
      if(!stored) await this.rpc('fail',id,hash,{lease:session.lease_id}).catch(()=>{});
      // Immutable candidate objects are tracked by session prefix and cleanup,
      // including a failed/ambiguous finish or expired worker lease.
      throw new Error('Image could not be processed; retry or start a new image');
    }
  }
  async preview(id:string,capability:string) {
    const s=await this.get(id,capability);
    if(s.state!=='ready' || !s.asset_id || !s.lease_id) throw new Error('Processed image unavailable');
    const previewUrl=await getSignedUrl(this.storage.client,new GetObjectCommand({Bucket:this.storage.bucket,
      Key:`processed/${s.id}/${s.lease_id}.webp`,ResponseContentType:'image/webp',ResponseCacheControl:'private, no-store',
      ResponseContentDisposition:'inline',
    }),{expiresIn:60});
    return {sessionId:s.id,assetId:s.asset_id,previewUrl,expiresIn:60};
  }
  async cleanup() {
    const sessions=z.array(sessionSchema).parse(await this.rpc('cleanup_claim'));
    let removed=0,failed=0;
    for(const s of sessions) {
      try {
        for(const prefix of [`raw/${s.id}/`,`processed/${s.id}/`]) {
          let token:string|undefined;
          do {
            const objects=await this.storage.client.send(new ListObjectsV2Command({Bucket:this.storage.bucket,Prefix:prefix,ContinuationToken:token,MaxKeys:100}));
            for(const object of objects.Contents??[]) {
              if(object.Key) await this.storage.client.send(new DeleteObjectCommand({Bucket:this.storage.bucket,Key:object.Key}));
            }
            token=objects.IsTruncated?objects.NextContinuationToken:undefined;
          } while(token);
        }
        await this.rpc('cleanup_done',s.id,undefined,{lease:s.lease_id}); removed++;
      } catch {failed++;} // Lease expiry retries failures; absent R2 objects are safe.
    }
    return {removed,failed};
  }
}
