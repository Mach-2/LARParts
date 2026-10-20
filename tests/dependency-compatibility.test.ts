import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';

test('Netlify IPX uses the patched application Sharp and still transforms supported photos',async()=>{
  // Resolve from the adapter through its real dependency chain, rather than
  // accidentally exercising a different top-level image package.
  let requireFrom=createRequire(import.meta.url);
  for(const name of ['@astrojs/netlify','@netlify/vite-plugin','@netlify/dev','@netlify/images','ipx']){
    requireFrom=createRequire(requireFrom.resolve(name));
  }
  const actualSharp=requireFrom.resolve('sharp');
  assert.equal(actualSharp,createRequire(import.meta.url).resolve('sharp'));
  const {createIPX}=await import(pathToFileURL(requireFrom.resolve('ipx')).href);
  for(const format of ['png','jpeg','webp'] as const){
    const input=await sharp({create:{width:12,height:10,channels:3,background:'#437faa'}}).toFormat(format).toBuffer();
    const ipx=createIPX({storage:{getMeta:async()=>({}),getData:async()=>input}});
    const output=await ipx('/synthetic-photo',{w:'6',f:'webp'}).process();
    const metadata=await sharp(output.data).metadata();
    assert.equal(metadata.format,'webp');assert.equal(metadata.width,6);assert.equal(metadata.height,5);
  }
  // Guard against a lockfile silently reinstalling the old vulnerable copy.
  const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.ok(!lock.packages['node_modules/ipx/node_modules/sharp']);
});
