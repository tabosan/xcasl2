import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(resolve(root,name),'utf8');
const json = name => JSON.parse(read(name));
const write = (name,value) => writeFileSync(resolve(root,name),value);
const packageInfo = json('package.json');
const argument = process.argv[2];
// Initially publish stable versions only; installer version limits also apply.
const valid = value => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split('.').every(n=>Number(n)<=65535);
const cargoVersion = text => text.match(/\[workspace\.package\]\s*\r?\nversion = "([^"]+)"/)?.[1];

if (argument === '--set') {
  const version = process.argv[3];
  if (!version || !valid(version)) throw Error('例: npm run version:set -- 0.1.1（各数値は0〜65535）');
  if (!cargoVersion(read('Cargo.toml'))) throw Error('Cargo.tomlのworkspaceバージョンを取得できません。');
  for (const name of ['package.json','src-tauri/tauri.conf.json','package-lock.json']) {
    const data=json(name); data.version=version;
    if(name==='package-lock.json') data.packages[''].version=version;
    write(name,JSON.stringify(data,null,2)+'\n');
  }
  write('Cargo.toml',read('Cargo.toml').replace(/(\[workspace\.package\]\s*\r?\nversion = ")[^"]+/,`$1${version}`));
  write('Cargo.lock',read('Cargo.lock').replace(/(name = "xcasl2-(?:core|desktop)"\r?\nversion = ")[^"]+/g,`$1${version}`));
  console.log(`バージョンを ${version} に更新しました。変更を確認してコミットしてください。`);
} else {
  const version=packageInfo.version;
  if (!valid(version)) throw Error('対応するバージョン形式は MAJOR.MINOR.PATCH です。');
  const versions=[json('src-tauri/tauri.conf.json').version,cargoVersion(read('Cargo.toml')),json('package-lock.json').version,json('package-lock.json').packages[''].version];
  for(const name of ['core','desktop']) versions.push(read('Cargo.lock').match(new RegExp(`name = "xcasl2-${name}"\\r?\\nversion = "([^"]+)"`))?.[1]);
  if(versions.some(value=>value!==version)) throw Error(`バージョンが不一致です: ${JSON.stringify([version,...versions])}`);
  if(argument==='--tag' && process.argv[3]!==`v${version}`) throw Error(`タグは v${version} にしてください。`);
  if(argument && argument!=='--tag' && argument!=='--check') throw Error('引数は --check / --tag vX.Y.Z / --set X.Y.Z です。');
  console.log(`xCASL2 ${version}: バージョン一致`);
}
