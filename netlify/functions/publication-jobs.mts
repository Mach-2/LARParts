import type {Config} from '@netlify/functions';
import {loadPublicationConfig} from '../../src/server/publication-config';
import {PublicationService} from '../../src/server/publication-service';
export default async()=>{
  if(process.env.PUBLICATION_JOBS_ENABLED!=='true')return;
  const config=loadPublicationConfig();
  const service=new PublicationService(config);
  try{const result=await service.maintenance();console.log('Publication jobs',result);if(result.failed)throw new Error('Publication jobs require retry');}
  finally{service.close();}
};
export const config:Config={schedule:'*/5 * * * *'};
