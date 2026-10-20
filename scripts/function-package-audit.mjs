import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,resolve,posix} from 'node:path';
import yauzl from 'yauzl';

export const expectedFunctions=['cleanup-images','profile-image','publication-jobs','ssr','submit-profile','verified-profile'];
const blockedPackages=['braces','node-forge','@netlify/dev','@netlify/functions-dev','@netlify/zip-it-and-ship-it','ipx','listhen'];
const maxEntry=64*1024*1024,maxTotal=512*1024*1024;

/** @param {Record<string,string|undefined>} env */
export function privateNeedles(env){
  return [...new Set(Object.entries(env).flatMap(([key,value])=>
    /SECRET|PRIVATE_KEY|API_KEY|ACCESS_KEY_ID|DATABASE_URL|EMAIL_ALLOWLIST|NOTIFICATION_EMAILS/.test(key)&&value&&value.length>=8?
      [value,Buffer.from(value).toString('base64'),encodeURIComponent(value)]:[]))];
}

/** Read-only inspection: never extracts or imports archived code.
 * @param {string} path @param {{needles?:string[],linux?:boolean}} options */
export async function inspectFunctionZip(path,{needles=[],linux=true}={}){
  const zip=await yauzl.openPromise(path,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true});
  const violations=new Set(),seen=new Set();let files=0,bytes=0,nativeFiles=0,linuxNativeFiles=0,sharpVersion=null;
  try{
    for await(const entry of zip.eachEntry()){
      const name=entry.fileName;
      if(name.endsWith('/'))continue;
      if(seen.has(name))throw new Error('Duplicate archive entry');seen.add(name);
      if(entry.isEncrypted()||entry.uncompressedSize>maxEntry)throw new Error('Unsupported archive entry');
      bytes+=entry.uncompressedSize;if(bytes>maxTotal)throw new Error('Archive exceeds inspection budget');
      files++;
      const stream=await zip.openReadStreamPromise(entry);const chunks=[];let size=0;
      for await(const chunk of stream){size+=chunk.length;if(size>maxEntry)throw new Error('Entry exceeds inspection budget');chunks.push(chunk);}
      const data=Buffer.concat(chunks);
      if(data.length!==entry.uncompressedSize)throw new Error('Archive entry size mismatch');
      const symlink=((entry.externalFileAttributes>>>16)&0o170000)===0o120000;
      if(symlink){
        const target=data.toString('utf8'),resolved=posix.normalize(posix.join(posix.dirname(name),target));
        if(target.startsWith('/')||target.includes('\\')||/^[A-Za-z]:/.test(target)||resolved==='..'||resolved.startsWith('../'))violations.add('unsafe_symlink');
      }
      if(/(^|\/)\.env(?:$|[.-])|\.(?:pem|key|pfx|p12)$|historical-submissions.*\.json$/i.test(name))violations.add('private_file');
      if(/^(?:tests|docs|scripts|supabase)\//.test(name))violations.add('unnecessary_project_files');
      if(needles.some(value=>data.includes(Buffer.from(value))))violations.add('private_value');
      if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\r?\n|\\n|\\r\\n)[A-Za-z0-9+/]{40,}|\b(?:ghp_|github_pat_|sb_secret_)[A-Za-z0-9_]{16,}/.test(data.toString('utf8')))violations.add('credential_pattern');
      for(const pkg of blockedPackages){
        if(name.includes(`node_modules/${pkg}/`))violations.add(`unwanted_package:${pkg}`);
        if(/\.(?:mjs|cjs|js)$/.test(name)){
          const escaped=pkg.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          if(new RegExp(`node_modules/${escaped}/|(?:from\\s*|import\\s*|(?:require|import)\\s*\\(\\s*)['"]${escaped}(?:/|['"])`).test(data.toString('utf8')))violations.add(`unwanted_package:${pkg}`);
        }
      }
      if(basename(name)==='package.json'){
        let metadata;try{metadata=JSON.parse(data.toString('utf8'));}catch{throw new Error('Invalid package metadata');}
        if(blockedPackages.includes(metadata.name))violations.add(`unwanted_package:${metadata.name}`);
        if(metadata.name==='sharp'){
          sharpVersion=/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(metadata.version)?metadata.version:'unrecognized';
          if(sharpVersion!=='0.35.5')violations.add('unexpected_sharp_version');
        }
      }
      if(!symlink&&/\.(?:node|dll|so(?:\.\d+)*)$/.test(name)){
        nativeFiles++;
        const elf=data.length>=20&&data.subarray(0,4).equals(Buffer.from([127,69,76,70]));
        if(elf)linuxNativeFiles++;
        if(linux&&!elf)violations.add('non_linux_native_binary');
        if(linux&&elf&&(data[4]!==2||data[5]!==1||data.readUInt16LE(18)!==(process.arch==='arm64'?183:62)))violations.add('native_architecture_mismatch');
      }
    }
  }finally{zip.close();}
  return{files,uncompressedBytes:bytes,nativeFiles,linuxNativeFiles,sharpVersion,violations:[...violations].sort()};
}

/** @param {string} directory @param {{env?:Record<string,string|undefined>,linux?:boolean,expected?:string[]}} options */
export async function auditFunctionPackages(directory,{env=process.env,linux=true,expected=expectedFunctions}={}){
  const entries=await readdir(directory,{withFileTypes:true});
  const archives=entries.filter(e=>e.isFile()&&e.name.endsWith('.zip')).map(e=>e.name).sort();
  if(JSON.stringify(archives)!==JSON.stringify(expected.map(name=>name+'.zip').sort()))throw new Error('Unexpected function package inventory');
  const needles=privateNeedles(env),packages=[];
  for(const file of archives){
    const path=resolve(directory,file),name=file.slice(0,-4);
    const report=await inspectFunctionZip(path,{needles,linux});
    if(name==='profile-image'&&linux&&(!report.linuxNativeFiles||report.sharpVersion!=='0.35.5'))report.violations.push('image_runtime_dependency_missing');
    packages.push({name,sha256:createHash('sha256').update(await readFile(path)).digest('hex'),...report});
  }
  return{passed:packages.every(p=>p.violations.length===0),commit:env.COMMIT_REF??null,deployId:env.DEPLOY_ID??null,platform:linux?'linux':'local',packages};
}
