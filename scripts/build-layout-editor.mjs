import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const result=await build({entryPoints:['src/layout-editor/main.ts'],bundle:true,format:'iife',target:'es2022',write:false,minify:true});
let html=await readFile('comet-layout-editor.html','utf8');
const css=(await Promise.all(['src/theme.css','src/comet-diagram.css','src/layout-editor/style.css'].map(path=>readFile(path,'utf8')))).join('\n');
html=html.replace(/<link[^>]+>/g,'').replace('</head>',`<style>${css}</style></head>`).replace(/<script[^>]+><\/script>/,()=>`<script>${result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir('tools',{recursive:true});await writeFile('tools/comet-layout-editor.html',html);
console.log('Standalone editor: tools/comet-layout-editor.html');
