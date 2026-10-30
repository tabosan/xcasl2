import { cometDiagramMarkup } from '../comet-diagram.ts';
import { applyCometLayout, cloneLayout, defaultCometLayout, parseCometLayout, setWirePoints, textCounts, validateCometLayout, wirePoints, type CometLayout, type Point } from '../comet-layout.ts';

type Kind='node'|'text'|'wire';
interface Selection {kind:Kind;id:string;point?:number;segment?:number}
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const host=$('layout-editor');
host.innerHTML=`<header class="toolbar"><h1>COMET 配置エディター</h1><button id="undo" title="Ctrl+Z">元に戻す</button><button id="redo" title="Ctrl+Y">やり直し</button><button id="import">JSON読込み</button><button id="export" class="primary">JSON書出し</button><button id="export-svg">SVG書出し</button><select id="theme" aria-label="テーマ"><option value="light">ライト</option><option value="dark">ダーク</option></select><input id="file" type="file" accept=".json,application/json" hidden></header>
<div class="editor-body"><aside class="sidebar"><h2>編集する対象</h2><div class="mode-tabs"><button data-mode="node" aria-pressed="true">ブロック</button><button data-mode="text" aria-pressed="false">文字</button><button data-mode="wire" aria-pressed="false">配線</button></div><select id="object-list" size="15" aria-label="対象一覧"></select><hr class="section-divider"><label class="field"><span>グリッド</span><input id="grid" type="checkbox" checked></label><label class="field"><span>スナップ</span><input id="snap" type="number" min="0" max="100" value="5" title="0で自由移動"></label><div class="zoom-controls"><button id="zoom-out" aria-label="縮小">−</button><span id="zoom-value">100%</span><button id="zoom-in" aria-label="拡大">＋</button><button id="fit">全体</button></div><p class="help">ブロックと文字をドラッグ。配線は線を選び、丸い点や線分をドラッグします。矢印キーで微調整、Shift併用で10倍。</p></aside>
<main id="workspace" class="workspace" aria-label="図の編集領域"><div class="canvas-frame" id="canvas-frame">${cometDiagramMarkup()}</div></main>
<aside class="properties"><div class="notice">xCASL2と同じSVGを使います。数値は配置確認用のサンプルです。</div><h2 id="selection-title">対象を選択してください</h2><div id="selection-properties" hidden><label class="field"><span id="x-label">X移動量</span><input id="x" type="number" step="1" min="-8192" max="8192"></label><label class="field"><span id="y-label">Y移動量</span><input id="y" type="number" step="1" min="-8192" max="8192"></label><label class="field" id="vertex-field" hidden><span>配線の点</span><select id="vertex" aria-label="配線の点"></select></label><div class="property-buttons"><button id="bend">折れ曲がり追加</button><button id="remove-point">点を削除</button><button id="reset-target">対象を初期化</button></div><p id="target-help" class="help"></p></div><hr class="section-divider"><h2>キャンバス</h2><label class="field"><span>幅</span><input id="width" type="number" min="200" max="4096"></label><label class="field"><span>高さ</span><input id="height" type="number" min="200" max="4096"></label><label class="field"><span>選択経路を点灯</span><input id="active-preview" type="checkbox" checked></label><button id="reset-all">図全体を初期化</button><hr class="section-divider"><h2>調整結果の渡し方</h2><p class="help">「JSON書出し」で保存した <b>comet-layout.json</b> をチャットへ添付してください。SVGは見た目の確認用です。</p><p class="help">変更はこのブラウザーにも下書き保存します。大事な配置はJSONへ書き出してください。JSONを読み込めば別のブラウザーやPCでも続きを編集できます。</p></aside></div>
<footer class="status"><span id="status" role="status">配置を調整できます。</span><span id="draft-status">下書き自動保存</span></footer>`;

const svg=document.querySelector<SVGSVGElement>('svg.datapath')!;
svg.classList.add('canvas');svg.removeAttribute('role');svg.setAttribute('aria-label','COMET配置の編集キャンバス');
svg.setAttribute('tabindex','0');
let layout=cloneLayout(defaultCometLayout),mode:Kind='node',selection:Selection|null=null,zoom=1;
const undo:CometLayout[]=[],redo:CometLayout[]=[],draftKey='xcasl2-comet-layout-draft-v1';
let drag:{pointer:number;start:Point;before:CometLayout;selection:Selection}|null=null;
function status(text:string,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function saveDraft(){try{localStorage.setItem(draftKey,JSON.stringify(layout));$('draft-status').textContent='下書き保存済み';}catch{$('draft-status').textContent='下書き保存不可：JSONを書き出してください';}}
function commit(before:CometLayout){if(JSON.stringify(before)!==JSON.stringify(layout)){undo.push(before);if(undo.length>100)undo.shift();redo.length=0;saveDraft();}render();}
function mutate(change:()=>void){const before=cloneLayout(layout);try{change();layout=validateCometLayout(layout);commit(before);}catch(e){layout=before;status(String(e),true);render();}}
function snap(value:number){const grid=Number($<HTMLInputElement>('snap').value);return Math.max(-8192,Math.min(8192,grid>0?Math.round(value/grid)*grid:value));}
function svgPoint(event:PointerEvent):Point{const matrix=svg.getScreenCTM();if(!matrix)throw Error('図の座標を取得できません。');const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return {x:p.x,y:p.y};}
function elementFor(sel:Selection):SVGGraphicsElement|null{return sel.kind==='wire'?svg.querySelector(`[data-wire-id="${sel.id}"]`):svg.querySelector(`[data-layout-${sel.kind}="${sel.id}"]`);}
function nameFor(kind:Kind,id:string){if(kind==='node')return id.toUpperCase();if(kind==='wire')return id.replace('-',' → ').toUpperCase();const el=svg.querySelector(`[data-layout-text="${id}"]`);return `${id}  ${el?.textContent??''}`;}
function rebuildList(){const list=$<HTMLSelectElement>('object-list');list.replaceChildren();const ids=mode==='node'?Object.keys(textCounts):mode==='wire'?layout.wires.map(w=>w.id):Object.entries(textCounts).flatMap(([id,count])=>Array.from({length:count},(_,i)=>`${id}.${i}`));for(const id of ids){const option=document.createElement('option');option.value=id;option.textContent=nameFor(mode,id);list.append(option);}list.value=selection?.kind===mode?selection.id:'';}
function select(next:Selection|null){selection=next;if(next?.kind==='wire'&&next.point===undefined&&next.segment===undefined)next.point=0;rebuildList();render();}
const samples:Record<string,string>={pr:'0034',sp:'0144',mar:'FFFF',mdr:'FFFF',ir1:'FFFF',ir2:'FFFF',ea:'FFFF',opcode:'00',r:'0000',x:'0000',adr:'0000',fr:'000',controller:'実行 / STEP 0'};
for(const [key,value]of Object.entries(samples))svg.querySelector(`#value-${key}`)!.textContent=value;
for(let i=0;i<8;i++)svg.querySelector(`#comet-gr-${i}`)!.textContent='FFFF';
for(const path of svg.querySelectorAll('.bus-lines path'))path.setAttribute('marker-end','url(#bus-arrow)');
const hits=document.createElementNS('http://www.w3.org/2000/svg','g');hits.classList.add('editor-hit-layer');svg.querySelector('.bus-lines')!.after(hits);
const overlay=document.createElementNS('http://www.w3.org/2000/svg','g');overlay.classList.add('editor-overlay');svg.append(overlay);
function svgEl(name:string,attributes:Record<string,string|number>){const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value]of Object.entries(attributes))el.setAttribute(key,String(value));return el;}
function drawOverlay(){
  hits.replaceChildren();overlay.replaceChildren();
  if(mode==='wire')for(const path of svg.querySelectorAll<SVGPathElement>('.bus-lines path'))hits.append(svgEl('path',{d:path.getAttribute('d')!,'data-wire-id':path.dataset.wireId!,class:'editor-hit'}));
  if(!selection)return;
  if(selection.kind==='wire'){
    const points=wirePoints(layout,selection.id);
    points.forEach((p,i)=>{if(i<points.length-1)overlay.append(svgEl('line',{x1:p.x,y1:p.y,x2:points[i+1].x,y2:points[i+1].y,class:'wire-segment','data-segment':i}));});
    points.forEach((p,i)=>overlay.append(svgEl('circle',{cx:p.x,cy:p.y,r:4/Math.min(zoom,1),class:`handle${selection?.point===i?' selected':''}`,'data-point':i})));
  }else{
    const el=elementFor(selection);if(!el)return;const box=el.getBBox(),matrix=svg.getCTM()!.inverse().multiply(el.getCTM()!);
    const a=new DOMPoint(box.x,box.y).matrixTransform(matrix),b=new DOMPoint(box.x+box.width,box.y+box.height).matrixTransform(matrix);
    overlay.append(svgEl('rect',{x:a.x-4,y:a.y-4,width:b.x-a.x+8,height:b.y-a.y+8,class:'selection-box'}));
  }
}
function propertyPoint():Point|null{if(!selection)return null;if(selection.kind==='node')return layout.nodes[selection.id];if(selection.kind==='text')return layout.texts[selection.id]??{x:0,y:0};return wirePoints(layout,selection.id)[selection.point??0]??null;}
function render(){
  applyCometLayout(svg,layout);svg.classList.remove('mode-node','mode-text','mode-wire');svg.classList.add(`mode-${mode}`);svg.classList.toggle('grid',$<HTMLInputElement>('grid').checked);
  svg.style.width=`${layout.width*zoom}px`;svg.style.height=`${layout.height*zoom}px`;const grid=Number($<HTMLInputElement>('snap').value)||10;svg.style.backgroundSize=`${grid*zoom}px ${grid*zoom}px`;
  for(const el of svg.querySelectorAll('.active'))el.classList.remove('active');
  if(selection?.kind==='wire'&&$<HTMLInputElement>('active-preview').checked){const wire=layout.wires.find(w=>w.id===selection!.id)!;elementFor(selection)?.classList.add('active');svg.querySelector(`[data-layout-node="${wire.from}"]`)?.classList.add('active');svg.querySelector(`[data-layout-node="${wire.to}"]`)?.classList.add('active');}
  drawOverlay();$('selection-properties').hidden=!selection;$('selection-title').textContent=selection?nameFor(selection.kind,selection.id):'対象を選択してください';
  const p=propertyPoint();if(p){$<HTMLInputElement>('x').value=String(Math.round(p.x*10)/10);$<HTMLInputElement>('y').value=String(Math.round(p.y*10)/10);}
  $('x-label').textContent=selection?.kind==='wire'?'点のX':'X移動量';$('y-label').textContent=selection?.kind==='wire'?'点のY':'Y移動量';
  const wire=selection?.kind==='wire';$('vertex-field').hidden=!wire;$('bend').hidden=!wire;$('remove-point').hidden=!wire;
  if(wire){const points=wirePoints(layout,selection!.id),vertex=$<HTMLSelectElement>('vertex');vertex.replaceChildren(...points.map((_,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${i+1}${i===0?'（始点）':i===points.length-1?'（終点）':''}`;return option;}));vertex.value=String(selection!.point??0);$<HTMLButtonElement>('remove-point').disabled=selection!.point===undefined||selection!.point===0||selection!.point===points.length-1;}
  $('target-help').textContent=wire?'丸い点で端点・折れ曲がりを移動。線分ドラッグは平行移動。ブロックを動かすと配線の両端も追従します。':'ブロックは枠と内部文字を一緒に移動します。「文字」モードならラベルや値を個別に調整できます。';
  $<HTMLInputElement>('width').value=String(layout.width);$<HTMLInputElement>('height').value=String(layout.height);$('zoom-value').textContent=`${Math.round(zoom*100)}%`;
  $<HTMLButtonElement>('undo').disabled=!undo.length;$<HTMLButtonElement>('redo').disabled=!redo.length;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
}
function moveSelection(base:CometLayout,sel:Selection,dx:number,dy:number){
  layout=cloneLayout(base);
  if(sel.kind!=='wire'){const store=sel.kind==='node'?layout.nodes:layout.texts,p=store[sel.id]??{x:0,y:0};store[sel.id]={x:snap(p.x+dx),y:snap(p.y+dy)};}
  else{
    const points=wirePoints(base,sel.id);
    if(sel.segment!==undefined){const i=sel.segment,a=points[i],b=points[i+1];if(a.y===b.y){a.y=snap(a.y+dy);b.y=a.y;}else{a.x=snap(a.x+dx);b.x=a.x;}}
    else{const p=points[sel.point??0];p.x=snap(p.x+dx);p.y=snap(p.y+dy);}
    setWirePoints(layout,sel.id,points);
  }
}
svg.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;const target=event.target as Element;
  if(mode==='wire'){
    const point=target.getAttribute('data-point'),segment=target.getAttribute('data-segment');
    if((point!==null||segment!==null)&&selection?.kind==='wire')selection={kind:'wire',id:selection.id,...point!==null?{point:Number(point)}:{segment:Number(segment)}};
    else{const path=target.closest<SVGElement>('[data-wire-id]');if(!path){select(null);return;}select({kind:'wire',id:path.dataset.wireId!});return;}
  }else{
    const element=target.closest<SVGElement>(`[data-layout-${mode}]`);if(!element){select(null);return;}selection={kind:mode,id:element.getAttribute(`data-layout-${mode}`)!};
  }
  event.preventDefault();svg.focus({preventScroll:true});drag={pointer:event.pointerId,start:svgPoint(event),before:cloneLayout(layout),selection:{...selection!}};svg.setPointerCapture(event.pointerId);rebuildList();render();
});
svg.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointer)return;const p=svgPoint(event);moveSelection(drag.before,drag.selection,p.x-drag.start.x,p.y-drag.start.y);render();});
function endDrag(event:PointerEvent){if(!drag||event.pointerId!==drag.pointer)return;const before=drag.before;drag=null;commit(before);status('配置を変更しました。Ctrl+Zで戻せます。');}
svg.addEventListener('pointerup',endDrag);svg.addEventListener('pointercancel',()=>{if(drag){layout=drag.before;drag=null;render();}});
function historyMove(back:boolean){const from=back?undo:redo,to=back?redo:undo;const next=from.pop();if(!next)return;to.push(cloneLayout(layout));layout=next;selection=null;saveDraft();rebuildList();render();}
$('undo').onclick=()=>historyMove(true);$('redo').onclick=()=>historyMove(false);
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode as Kind;select(null);});
$<HTMLSelectElement>('object-list').onchange=()=>select({kind:mode,id:$<HTMLSelectElement>('object-list').value});
$<HTMLSelectElement>('vertex').onchange=()=>{if(selection?.kind==='wire'){selection.point=Number($<HTMLSelectElement>('vertex').value);delete selection.segment;render();}};
for(const axis of ['x','y'] as const)$<HTMLInputElement>(axis).onchange=()=>{
  if(!selection)return;const value=Number($<HTMLInputElement>(axis).value);if(!Number.isFinite(value))return;
  mutate(()=>{const sel=selection!;if(sel.kind==='wire'){const points=wirePoints(layout,sel.id);points[sel.point??0][axis]=value;setWirePoints(layout,sel.id,points);}else{const store=sel.kind==='node'?layout.nodes:layout.texts;store[sel.id]={...(store[sel.id]??{x:0,y:0}),[axis]:value};}});
};
for(const axis of ['width','height']as const)$<HTMLInputElement>(axis).onchange=()=>mutate(()=>{layout[axis]=Number($<HTMLInputElement>(axis).value);});
$('reset-target').onclick=()=>mutate(()=>{if(!selection)return;if(selection.kind==='node')layout.nodes[selection.id]={x:0,y:0};else if(selection.kind==='text')delete layout.texts[selection.id];else layout.wires[layout.wires.findIndex(w=>w.id===selection!.id)]=structuredClone(defaultCometLayout.wires.find(w=>w.id===selection!.id)!);});
$('reset-all').onclick=()=>{mutate(()=>{layout=cloneLayout(defaultCometLayout);selection=null;});status('初期配置へ戻しました。Undoで取り消せます。');};
$('remove-point').onclick=()=>mutate(()=>{if(selection?.kind!=='wire'||selection.point===undefined)return;const points=wirePoints(layout,selection.id),i=selection.point;if(i===0||i===points.length-1)return;points.splice(i,1);setWirePoints(layout,selection.id,points);selection.point=Math.max(0,i-1);});
$('bend').onclick=()=>mutate(()=>{
  if(selection?.kind!=='wire')return;const points=wirePoints(layout,selection.id),i=Math.min(selection.segment??selection.point??0,points.length-2),a=points[i],b=points[i+1],horizontal=a.y===b.y;
  const mid=snap(horizontal?(a.x+b.x)/2:(a.y+b.y)/2),size=20;
  const extra=horizontal?[{x:mid,y:a.y},{x:mid,y:a.y+size},{x:mid+size,y:a.y+size},{x:mid+size,y:a.y}]:[{x:a.x,y:mid},{x:a.x+size,y:mid},{x:a.x+size,y:mid+size},{x:a.x,y:mid+size}];
  points.splice(i+1,0,...extra);setWirePoints(layout,selection.id,points);selection.point=i+2;delete selection.segment;
});
for(const id of ['grid','snap','active-preview'])$(id).onchange=render;
$('zoom-in').onclick=()=>{zoom=Math.min(3,zoom+.1);render();};$('zoom-out').onclick=()=>{zoom=Math.max(.25,zoom-.1);render();};
$('fit').onclick=()=>{const area=$('workspace');zoom=Math.max(.25,Math.min(2,(area.clientWidth-60)/layout.width,(area.clientHeight-60)/layout.height));render();};
$<HTMLSelectElement>('theme').onchange=()=>{document.documentElement.dataset.theme=$<HTMLSelectElement>('theme').value;render();};
function download(name:string,content:string,type:string){const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('export').onclick=()=>{try{download('comet-layout.json',JSON.stringify(validateCometLayout(layout),null,2)+'\n','application/json');status('comet-layout.jsonを書き出しました。このJSONをチャットへ添付してください。');}catch(e){status(String(e),true);}};
$('import').onclick=()=>$<HTMLInputElement>('file').click();
$<HTMLInputElement>('file').onchange=async()=>{const input=$<HTMLInputElement>('file'),file=input.files?.[0];if(!file)return;try{if(file.size>2_000_000)throw Error('ファイルが大きすぎます。');const next=parseCometLayout(await file.text()),before=cloneLayout(layout);layout=next;selection=null;commit(before);rebuildList();status(`${file.name}を読み込みました。`);}catch(e){status(`読み込めません: ${e}`,true);}finally{input.value='';}};
$('export-svg').onclick=()=>{
  const copy=svg.cloneNode(true) as SVGSVGElement;copy.querySelectorAll('.editor-overlay,.editor-hit-layer').forEach(el=>el.remove());copy.removeAttribute('style');copy.setAttribute('class','datapath');copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.setAttribute('width',String(layout.width));copy.setAttribute('height',String(layout.height));
  const computed=getComputedStyle(document.documentElement);for(const name of ['mono','bg','fg','raised','outline','border','border-strong','muted','secondary','strong','syntax-register','selection-bg','selection-fg','accent','warning','changed-bg','bus','bus-active'])copy.style.setProperty(`--${name}`,computed.getPropertyValue(`--${name}`));
  const sheet=Array.from(document.styleSheets).flatMap(sheet=>{try{return Array.from(sheet.cssRules).map(rule=>rule.cssText);}catch{return [];}}).filter(rule=>/bus-lines|datapath-node|gr-row|decoder-field|memory-port|bus-arrow/.test(rule)).join('\n');
  const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent=sheet;copy.prepend(style);download('comet-layout-preview.svg',new XMLSerializer().serializeToString(copy),'image/svg+xml');status('見た目確認用のSVGを書き出しました。実装へ渡す際はJSONも添付してください。');
};
document.addEventListener('keydown',event=>{
  if((event.target as Element).matches('input,select,textarea'))return;
  if(event.ctrlKey&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();historyMove(event.key.toLowerCase()==='z'&&!event.shiftKey);return;}
  if(!selection||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();const step=(Number($<HTMLInputElement>('snap').value)||1)*(event.shiftKey?10:1),before=cloneLayout(layout);moveSelection(before,selection,event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0);commit(before);
});
document.documentElement.dataset.theme='light';
try{const draft=localStorage.getItem(draftKey);if(draft){layout=parseCometLayout(draft);status('ブラウザー内の下書きを復元しました。');}}catch{status('下書きを復元できませんでした。JSONから読み込めます。',true);}
applyCometLayout(svg,layout);rebuildList();render();
