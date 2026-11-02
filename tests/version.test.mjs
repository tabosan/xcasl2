import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('version changes stay synchronized, reject invalid input and enforce exact release tags',()=>{
  const root=mkdtempSync(join(tmpdir(),'xcasl2-version-'));
  try {
    mkdirSync(join(root,'scripts'));mkdirSync(join(root,'src-tauri'));
    for(const file of ['scripts/version.mjs','package.json','package-lock.json','Cargo.toml','Cargo.lock','src-tauri/tauri.conf.json']) copyFileSync(new URL('../'+file,import.meta.url),join(root,file));
    const run=(...args)=>spawnSync(process.execPath,[join(root,'scripts/version.mjs'),...args],{encoding:'utf8'});
    assert.equal(run('--check').status,0);
    assert.equal(run('--set','1.2.3').status,0);assert.equal(run('--check').status,0);
    assert.equal(JSON.parse(readFileSync(join(root,'package.json'))).version,'1.2.3');
    assert.equal(run('--tag','v1.2.3').status,0);assert.notEqual(run('--tag','v1.2.4').status,0);
    const original=readFileSync(join(root,'Cargo.lock'),'utf8');
    for(const invalid of ['v1.2.3','01.2.3','1.2','1.2.3-beta.1','65536.0.0']) assert.notEqual(run('--set',invalid).status,0);
    assert.equal(readFileSync(join(root,'Cargo.lock'),'utf8'),original);
    const pkg=JSON.parse(readFileSync(join(root,'package.json')));pkg.version='9.9.9';
    // A mismatch introduced manually must fail before CI packaging.
    writeFileSync(join(root,'package.json'),JSON.stringify(pkg));assert.notEqual(run('--check').status,0);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
