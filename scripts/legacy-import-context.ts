import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import {loadBackendConfig,type BackendConfig} from '../src/server/config';

export function importDatabaseTarget(config:BackendConfig,env:NodeJS.ProcessEnv,allowProduction=false){
  const production=config.APP_ENV==='production';
  const ref=production?config.BACKEND_PRODUCTION_SUPABASE_REF:config.BACKEND_TESTING_SUPABASE_REF;
  if(production&&(!allowProduction||env.PRODUCTION_IMPORT_CONFIRM!==ref))throw new Error('Production import requires explicit project confirmation');
  const prefix=production?'PRODUCTION':'TEST';
  let url:URL;try{url=new URL(env[`${prefix}_DATABASE_URL`]??'');}catch{throw new Error('Database URI required');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash||
    !(url.hostname===`db.${ref}.supabase.co`||(url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username)===`postgres.${ref}`)))throw new Error('Database pin mismatch');
  return{url,caFile:env[`${prefix}_DATABASE_CA_FILE`]};
}

export async function legacyImportContext(allowProduction=false){
  const config=loadBackendConfig();
  const {url,caFile}=importDatabaseTarget(config,process.env,allowProduction);
  const ca=caFile?await readFile(caFile,'utf8'):undefined;
  const sql=postgres(url.href,{ssl:ca?{ca,rejectUnauthorized:true}:'verify-full',max:1,connect_timeout:10,onnotice:()=>{}});
  return{config,sql};
}
