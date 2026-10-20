import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {crc32} from 'node:zlib';
import {auditFunctionPackages,inspectFunctionZip,expectedFunctions} from '../scripts/function-package-audit.mjs';
import {onPostBuild} from '../plugins/function-package-audit/index.mjs';

function storedZip(entries:Record<string,string|Buffer>){
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const [name,value]of Object.entries(entries)){
    const filename=Buffer.from(name),data=Buffer.from(value),checksum=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(checksum,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,data);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(checksum,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);
    central.push(directory,filename);offset+=header.length+filename.length+data.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,cd,end]);
}

test('inspects ZIP contents without extracting, catches private data and tooling, and ignores metadata-only dependency names',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'larparts-zip-audit-'));
  try{
    const path=join(directory,'example.zip');
    await writeFile(path,storedZip({'index.mjs':'export default () => new Response("OK");','package.json':JSON.stringify({name:'safe',dependencies:{braces:'3.0.3'}})}));
    assert.deepEqual((await inspectFunctionZip(path)).violations,[]);
    await writeFile(path,storedZip({'index.mjs':'const marker="-----BEGIN PRIVATE KEY-----";'}));
    assert.deepEqual((await inspectFunctionZip(path)).violations,[]);
    await writeFile(path,storedZip({'key.txt':'-----BEGIN PRIVATE KEY-----\n'+'A'.repeat(60)}));
    assert.deepEqual((await inspectFunctionZip(path)).violations,['credential_pattern']);
    await writeFile(path,storedZip({'.env':'hidden','index.mjs':'import "braces"; const key="synthetic-private-value";'}));
    const result=await inspectFunctionZip(path,{needles:['synthetic-private-value']});
    assert.deepEqual(result.violations,['private_file','private_value','unwanted_package:braces']);
    assert.ok(!JSON.stringify(result).includes('synthetic-private-value'));
    await writeFile(path,storedZip({'node_modules/node-forge/package.json':'{"name":"node-forge","version":"1.4.0"}'}));
    assert.deepEqual((await inspectFunctionZip(path)).violations,['unwanted_package:node-forge']);
    await writeFile(path,storedZip({'../escape.txt':'no'}));await assert.rejects(inspectFunctionZip(path));
    await writeFile(path,Buffer.from('not a ZIP'));await assert.rejects(inspectFunctionZip(path));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('requires expected function packages and Linux image dependencies, and detects encoded secrets',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'larparts-package-audit-'));
  try{
    const path=join(directory,'profile-image.zip');
    await assert.rejects(auditFunctionPackages(directory,{expected:['profile-image'],env:{}}));
    await writeFile(path,storedZip({'index.mjs':'OK'}));
    const missing=await auditFunctionPackages(directory,{expected:['profile-image'],env:{}});
    assert.equal(missing.passed,false);assert.ok(missing.packages[0].violations.includes('image_runtime_dependency_missing'));
    const elf=Buffer.alloc(20);Buffer.from([127,69,76,70,2,1]).copy(elf);elf.writeUInt16LE(process.arch==='arm64'?183:62,18);
    await writeFile(path,storedZip({'index.mjs':'OK','node_modules/sharp/package.json':'{"name":"sharp","version":"0.35.5"}','sharp.node':elf}));
    const passed=await auditFunctionPackages(directory,{expected:['profile-image'],env:{COMMIT_REF:'synthetic-commit'}});
    assert.equal(passed.passed,true);assert.equal(passed.commit,'synthetic-commit');assert.match(passed.packages[0].sha256,/^[a-f0-9]{64}$/);
    await writeFile(join(directory,'github-submission.zip'),storedZip({'index.mjs':'legacy helper'}));
    await assert.rejects(auditFunctionPackages(directory,{expected:['profile-image'],env:{}}));
    await rm(join(directory,'github-submission.zip'));
    await writeFile(path,storedZip({'sharp.node':'MZwindows','index.mjs':Buffer.from('synthetic-private-key').toString('base64')}));
    const rejected=await auditFunctionPackages(directory,{expected:['profile-image'],env:{SUPABASE_SECRET_KEY:'synthetic-private-key'}});
    assert.ok(rejected.packages[0].violations.includes('private_value'));assert.ok(rejected.packages[0].violations.includes('non_linux_native_binary'));
    assert.ok(!JSON.stringify(rejected).includes('synthetic-private-key'));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('build plugin fails closed without logging private archive/parser error details',async()=>{
  const failures:string[]=[],statuses:unknown[]=[];
  await onPostBuild({constants:{FUNCTIONS_DIST:join(tmpdir(),'missing-synthetic-private-value')},utils:{build:{failBuild:(message:string)=>failures.push(message)},status:{show:(value:unknown)=>statuses.push(value)}}});
  assert.equal(failures.length,1);assert.ok(!failures[0].includes('synthetic-private-value'));assert.equal(statuses.length,0);
});

test('post-build hook audits the six final packages and reports a safe deploy summary',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'larparts-postbuild-audit-'));
  const original=console.log,logs:unknown[][]=[],statuses:Array<{title:string}>=[],failures:string[]=[];
  try{
    const elf=Buffer.alloc(20);Buffer.from([127,69,76,70,2,1]).copy(elf);elf.writeUInt16LE(process.arch==='arm64'?183:62,18);
    for(const name of expectedFunctions)await writeFile(join(directory,name+'.zip'),storedZip({'index.mjs':'export default () => new Response("OK")','node_modules/sharp/package.json':'{"name":"sharp","version":"0.35.5"}','sharp.node':elf}));
    console.log=(...args:unknown[])=>{logs.push(args);};
    await onPostBuild({constants:{FUNCTIONS_DIST:directory},utils:{build:{failBuild:(message:string)=>failures.push(message)},status:{show:(value:{title:string})=>statuses.push(value)}}});
    assert.equal(failures.length,0);assert.equal(statuses[0].title,'Function package audit passed');
    const report=JSON.parse(String(logs[0][1]));assert.equal(report.passed,true);assert.equal(report.packages.length,6);
  }finally{console.log=original;await rm(directory,{recursive:true,force:true});}
});
