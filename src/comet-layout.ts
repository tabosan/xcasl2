import layoutJson from './comet-layout.json' with { type: 'json' };

export interface Point { x:number; y:number }
export interface LayoutWire { id:string; from:string; to:string; points:Point[] }
export interface CometLayout { version:1; width:number; height:number; nodes:Record<string,Point>; texts:Record<string,Point>; wires:LayoutWire[] }
export const textCounts:Record<string,number> = {ir:3,decoder:9,controller:2,pr:2,sp:2,gr:17,mar:2,adder:1,ea:2,mdr:2,alu:1,fr:3,memory:1};
const connections='pr-mar sp-mar ir-decoder ir-adder decoder-adder gr-adder adder-ea ea-mar mar-memory memory-mdr mdr-memory mdr-ir gr-mdr mdr-gr gr-alu mdr-alu alu-gr alu-fr sp-alu ea-pr ea-gr pr-mdr mdr-pr'.split(' ');
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('配置データはJSONオブジェクトで指定してください。');return v as Record<string,unknown>;};
const number=(v:unknown,min=-8192,max=8192)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(`座標・サイズは${min}〜${max}の数値で指定してください。`);return v;};
const point=(v:unknown):Point=>{const p=object(v);return {x:number(p.x),y:number(p.y)};};
export function validateCometLayout(input:unknown):CometLayout {
  const data=object(input);
  if(data.version!==1)throw Error('未対応の配置データです（version: 1 が必要です）。');
  const nodes=object(data.nodes),texts=object(data.texts),out:CometLayout={version:1,width:number(data.width,200,4096),height:number(data.height,200,4096),nodes:{},texts:{},wires:[]};
  if(Object.keys(nodes).length!==Object.keys(textCounts).length)throw Error('ブロックの数が一致しません。');
  for(const id of Object.keys(textCounts))out.nodes[id]=point(nodes[id]);
  for(const [id,value]of Object.entries(texts)) {
    const [node,index]=id.split('.');
    if(!Object.hasOwn(textCounts,node)||!/^\d+$/.test(index??'')||Number(index)>=textCounts[node]||id!==`${node}.${Number(index)}`)throw Error(`未対応の文字ID: ${id}`);
    out.texts[id]=point(value);
  }
  if(!Array.isArray(data.wires)||data.wires.length!==connections.length)throw Error('配線の数が一致しません。');
  const seen=new Set<string>();
  for(const item of data.wires) {
    const wire=object(item),id=String(wire.id),[from,to]=id.split('-');
    if(!connections.includes(id)||seen.has(id)||wire.from!==from||wire.to!==to)throw Error(`未対応・重複した配線: ${id}`);
    if(!Array.isArray(wire.points)||wire.points.length<2||wire.points.length>512)throw Error('配線の点は2〜512個で指定してください。');
    seen.add(id);out.wires.push({id,from,to,points:wire.points.map(point)});
  }
  return out;
}
export const defaultCometLayout=validateCometLayout(layoutJson);
export const cloneLayout=(layout:CometLayout):CometLayout=>structuredClone(layout);
export function parseCometLayout(json:string):CometLayout {
  if(json.length>2_000_000)throw Error('配置ファイルが大きすぎます。');
  return validateCometLayout(JSON.parse(json));
}
export function orthogonalPoints(points:Point[]):Point[] {
  const out:Point[]=[];
  for(const p of points) {
    const last=out.at(-1);
    if(last&&last.x!==p.x&&last.y!==p.y)out.push({x:p.x,y:last.y});
    if(!last||last.x!==p.x||last.y!==p.y)out.push({...p});
  }
  return out;
}
export function wirePoints(layout:CometLayout,id:string):Point[] {
  const wire=layout.wires.find(w=>w.id===id)!;
  return orthogonalPoints(wire.points.map((p,i)=>{
    const offset=i===0?layout.nodes[wire.from]:i===wire.points.length-1?layout.nodes[wire.to]:{x:0,y:0};
    return {x:p.x+offset.x,y:p.y+offset.y};
  }));
}
export function setWirePoints(layout:CometLayout,id:string,points:Point[]) {
  const wire=layout.wires.find(w=>w.id===id)!;
  wire.points=points.map((p,i)=>{
    const offset=i===0?layout.nodes[wire.from]:i===points.length-1?layout.nodes[wire.to]:{x:0,y:0};
    return {x:p.x-offset.x,y:p.y-offset.y};
  });
}
export function wirePath(layout:CometLayout,id:string):string {
  return wirePoints(layout,id).map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ');
}
const viewId=(el:Element)=>el.getAttribute('data-view')??el.id;
export function applyCometLayout(svg:SVGSVGElement,layout:CometLayout=defaultCometLayout) {
  svg.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);
  for(const node of svg.querySelectorAll<SVGGElement>('g')) {
    const key=viewId(node);if(!key.startsWith('node-'))continue;
    const id=key.slice(5),offset=layout.nodes[id];if(!offset)continue;
    node.dataset.layoutNode=id;node.setAttribute('transform',`translate(${offset.x} ${offset.y})`);
    node.querySelectorAll<SVGTextElement>('text').forEach((text,i)=>{
      const textId=`${id}.${i}`,shift=layout.texts[textId]??{x:0,y:0};
      text.dataset.layoutText=textId;text.setAttribute('transform',`translate(${shift.x} ${shift.y})`);
    });
  }
  for(const path of svg.querySelectorAll<SVGPathElement>('.bus-lines path')) {
    const id=path.dataset.wireId??`${path.dataset.from}-${path.dataset.to}`;
    path.dataset.wireId=id;path.setAttribute('d',wirePath(layout,id));
  }
}
