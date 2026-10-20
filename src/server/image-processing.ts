import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg','image/png','image/webp'] as const;
sharp.cache(false);
sharp.concurrency(1);

export async function processImage(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image must be at most 5 MB');
  const header=Buffer.from(bytes.subarray(0,12));
  const magicFormat=header.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))?'jpeg':
    header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':
    header.subarray(0,4).toString('ascii')==='RIFF' && header.subarray(8,12).toString('ascii')==='WEBP'?'webp':null;
  // Never invoke parsers for SVG/HTML or other unsupported formats.
  if(!magicFormat)throw new Error('Unsupported image');
  const input = sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning',animated:false});
  const meta = await input.metadata();
  if (meta.format!==magicFormat || !meta.width || !meta.height ||
    meta.width>10000 || meta.height>10000 || meta.width*meta.height>40_000_000 || (meta.pages ?? 1)>1) throw new Error('Unsupported image');
  // Sharp strips metadata by default; never call keepMetadata/withMetadata.
  const {data,info} = await input.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true})
    .webp({quality:85}).timeout({seconds:12}).toBuffer({resolveWithObject:true});
  if (data.length>MAX_IMAGE_BYTES) throw new Error('Processed image too large');
  return {bytes:data,width:info.width,height:info.height,contentType:'image/webp' as const};
}
