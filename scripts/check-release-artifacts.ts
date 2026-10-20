import {readFile,readdir,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,basename} from 'node:path';
import {parseEnv} from 'node:util';
import {artifactPackageReferences} from './artifact-inspection';

// Read-only artifact inspection. This never imports Astro or invokes a build.
const root=resolve('.'),publicRoot=resolve('dist'),serverRoot=resolve('.netlify/v1/functions/ssr');
let failed=false;
async function exists(path:string){try{return(await stat(path)).isFile();}catch{return false;}}
async function files(path:string):Promise<string[]>{
  let entries;try{entries=await readdir(path,{withFileTypes:true});}catch{return[];}
  const result:string[]=[];
  for(const entry of entries){const file=resolve(path,entry.name);if(entry.isDirectory())result.push(...await files(file));else if(entry.isFile())result.push(file);}
  return result;
}
try{
  if(!await exists(resolve(serverRoot,'ssr.mjs')))throw new Error('Fresh Netlify SSR artifact missing. Stop dev servers, run the build locally, and inspect artifacts before running Astro commands again.');
  for(const path of ['about/index.html','whats-next/index.html']){
    if(!await exists(resolve(publicRoot,path)))throw new Error('Expected static informational page missing');
  }
  for(const path of ['index.html','artists/index.html','submit-profile/index.html','submit-profile-preview/index.html']){
    if(await exists(resolve(publicRoot,path)))throw new Error('Expected runtime route was generated as static HTML');
  }
  const all=[...await files(publicRoot),...await files(serverRoot)];
  const sourceFiles=['astro.config.mjs','netlify.toml','package.json','package-lock.json',...await files(resolve('src')),...await files(resolve('public')),...await files(resolve('netlify/functions'))];
  const newestSource=Math.max(...await Promise.all(sourceFiles.map(async path=>(await stat(path)).mtimeMs)));
  const serverTime=(await stat(resolve(serverRoot,'ssr.mjs'))).mtimeMs;
  if(serverTime<newestSource)throw new Error('SSR artifact predates current submission/confirmation sources; rebuild locally');
  const settings=parseEnv(await readFile('.env','utf8'));
  const privateValues=Object.entries(settings).flatMap(([name,value])=>/SECRET|PRIVATE_KEY|API_KEY|TEST_DATABASE_URL|EMAIL_ALLOWLIST|NOTIFICATION_EMAILS/.test(name)&&value&&value.length>12?[value]:[]);
  const vulnerablePackages=new Set<string>(),developmentPackages=new Set<string>();let scanned=0;
  for(const path of all){
    const name=basename(path),portable=relative(root,path).replaceAll('\\','/');
    if(/^\.env/.test(name)||/historical-submissions.*\.json$/i.test(name)||/\.(?:pem|key)$/i.test(name))throw new Error('Private configuration/source file in generated artifact; inspect privately');
    if(!/\.(?:js|mjs|cjs|json|html|map|css|txt)$/.test(name))continue;
    const data=await readFile(path,'utf8');scanned++;
    if(privateValues.some(value=>data.includes(value)))throw new Error('Saved private configuration value found in generated artifact; inspect privately');
    if(path.startsWith(serverRoot)){
      for(const pkg of artifactPackageReferences(portable,data))
        (['braces','node-forge'].includes(pkg)?vulnerablePackages:developmentPackages).add(pkg);
    }
  }
  const report={checkedAt:new Date().toISOString(),scannedTextFiles:scanned,staticPagesPresent:true,runtimePagesNotPrerendered:true,serverArtifactFresh:true,
    privateFilesOrValuesFound:false,vulnerableSSRPackageReferences:[...vulnerablePackages],developmentSSRPackageReferences:[...developmentPackages],
    customFunctionBundleInspection:'Requires Netlify testing deployment; Astro build does not bundle the handwritten functions'};
  await mkdir('.netlify/release-validation',{recursive:true});await writeFile('.netlify/release-validation/artifacts.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(vulnerablePackages.size||developmentPackages.size)throw new Error('Generated SSR development/vulnerable dependency references need review');
  console.log('PASS: fresh static/runtime output and private-data scan; SSR dependency-reference scan found no listed development/vulnerable packages');
  console.log('PENDING: this scan is not a security exception or proof about Netlify-packaged custom functions');
}catch(error){failed=true;console.error(`FAIL: ${error instanceof Error?error.message:'Artifact inspection unavailable'}`);}
if(failed)process.exitCode=1;
