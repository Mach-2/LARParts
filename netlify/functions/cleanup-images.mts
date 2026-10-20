import type { Config } from '@netlify/functions';
import { loadBackendConfig } from '../../src/server/config';
import { ImageService } from '../../src/server/image-service';
export default async()=>{
  // Netlify scheduled functions run only on published deployments. Disabled by
  // default; enable only after migrations, env scoping and lifecycle checks.
  if(process.env.IMAGE_CLEANUP_ENABLED!=='true')return;
  const service=new ImageService(loadBackendConfig());
  try {const result=await service.cleanup();console.log('Image cleanup',result);if(result.failed)throw new Error('Image cleanup needs retry');}
  finally{service.close();}
};
export const config:Config={schedule:'@hourly'};
