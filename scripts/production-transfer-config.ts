import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {loadBackendConfig} from '../src/server/config';

// Operator files only. Never writes these files or changes Netlify settings.
export async function productionTransferConfig(){
  const testingEnv=parseEnv(await readFile('.env','utf8'));
  const productionEnv=parseEnv(await readFile('.env-prod','utf8'));
  const candidate={...productionEnv};
  for(const name of Object.keys(testingEnv).filter(name=>name.startsWith('BACKEND_'))){
    if(!candidate[name])candidate[name]=testingEnv[name];
  }
  candidate.SUPABASE_URL=`https://${candidate.BACKEND_PRODUCTION_SUPABASE_REF}.supabase.co`;
  if(candidate.R2_PUBLIC_BASE_URL&&!candidate.R2_PUBLIC_BASE_URL.includes('://'))candidate.R2_PUBLIC_BASE_URL='https://'+candidate.R2_PUBLIC_BASE_URL;
  const testing=loadBackendConfig(testingEnv),production=loadBackendConfig(candidate);
  if(testing.APP_ENV!=='testing'||production.APP_ENV!=='production')throw new Error('Transfer environment mismatch');
  return{testing,production,testingEnv,productionEnv};
}
