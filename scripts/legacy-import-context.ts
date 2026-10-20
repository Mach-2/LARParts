import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import {loadBackendConfig} from '../src/server/config';

export async function legacyImportContext(){
  const config=loadBackendConfig();if(config.APP_ENV!=='testing')throw new Error('Step 6 tools require testing');
  let url:URL;try{url=new URL(process.env.TEST_DATABASE_URL??'');}catch{throw new Error('Testing database URI required');}
  const ref=config.BACKEND_TESTING_SUPABASE_REF;
  if(!(url.hostname===`db.${ref}.supabase.co`||(url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username)===`postgres.${ref}`)))throw new Error('Testing database pin mismatch');
  const ca=process.env.TEST_DATABASE_CA_FILE?await readFile(process.env.TEST_DATABASE_CA_FILE,'utf8'):undefined;
  const sql=postgres(url.href,{ssl:ca?{ca,rejectUnauthorized:true}:'verify-full',max:1,connect_timeout:10,onnotice:()=>{}});
  return{config,sql};
}
