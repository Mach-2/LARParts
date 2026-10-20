import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';

// Configuration names/status only. Never print stored values or parser errors.
for(const file of ['.env','.env-prod']){
  try{
    const env=parseEnv(await readFile(file,'utf8'));
    console.log(JSON.stringify({file,populatedNames:Object.keys(env).filter(name=>!!env[name]).sort(),
      inheritedOperatorNames:['NETLIFY_AUTH_TOKEN','NETLIFY_SITE_ID','PRODUCTION_DATABASE_URL'].filter(name=>!!process.env[name])}));
  }catch{console.log(JSON.stringify({file,readable:false}));}
}
