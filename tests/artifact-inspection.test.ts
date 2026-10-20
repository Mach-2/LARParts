import assert from 'node:assert/strict';
import test from 'node:test';
import {artifactPackageReferences} from '../scripts/artifact-inspection';

test('artifact scan detects copied package paths and bundled/static/dynamic runtime imports',()=>{
  assert.deepEqual(artifactPackageReferences('server/node_modules/braces/lib/parse.js',''),['braces']);
  assert.deepEqual(artifactPackageReferences('server\\node_modules\\node-forge\\lib\\rsa.js',''),['node-forge']);
  assert.deepEqual(artifactPackageReferences('server.mjs',`import forge from 'node-forge'; const glob=require('braces'); await import('@netlify/dev');`),['braces','node-forge','@netlify/dev']);
  assert.deepEqual(artifactPackageReferences('server.mjs','// node_modules/ipx/dist/index.mjs'),['ipx']);
});
test('artifact scan does not classify dependency metadata or similarly named safe packages as runtime imports',()=>{
  assert.deepEqual(artifactPackageReferences('package.json',JSON.stringify({dependencies:{braces:'3.0.3','node-forge':'1.4.0'}})),[]);
  assert.deepEqual(artifactPackageReferences('server.mjs',`import value from 'braces-safe'; require('node-forge-safe');`),[]);
});
