import test from 'node:test';
import assert from 'node:assert/strict';
import { FolderTree, explorerFileKind } from '../src/folder-tree.ts';
import { pathKey, Workbench } from '../src/workbench.ts';
import { pathWithin, rebasePath, renameWorkbenchPaths } from '../src/path-changes.ts';
import { confirmFileDeletion } from '../src/delete-confirmation.ts';
const folder=(path,name=path.split('\\').at(-1))=>({path,name,directory:true});
const file=path=>({path,name:path.split('\\').at(-1),directory:false});
const root=folder('C:\\日本語'),sub=folder('C:\\日本語\\sub'),cas=file('C:\\日本語\\a.CAS');

test('tree expands only loaded folders and retains nested expansion when collapsed',()=>{
  const tree=new FolderTree();tree.reset({...root,entries:[sub,cas]});
  assert.deepEqual(tree.rows().map(r=>[r.entry.name,r.depth]),[['日本語',1],['sub',2],['a.CAS',2]]);
  tree.expanded.add(pathKey(sub.path));assert.equal(tree.children.has(pathKey(sub.path)),false);
  tree.setChildren(sub.path,[file(sub.path+'\\b.cas')]);assert.equal(tree.rows().at(-2).depth,3);
  tree.expanded.delete(pathKey(root.path));assert.equal(tree.rows().length,1);
  tree.expanded.add(pathKey(root.path));assert.equal(tree.rows().length,4);
});
test('creation uses the selected folder or the selected file’s parent with Windows path aliases',()=>{
  const tree=new FolderTree();tree.reset({...root,entries:[sub,cas]});
  tree.setChildren(sub.path,[file(sub.path+'\\b.cas')]);
  assert.equal(tree.creationParent(),root.path);
  assert.equal(tree.creationParent(sub.path),sub.path);
  assert.equal(tree.creationParent('c:/日本語/sub/B.CAS'),sub.path);
  assert.equal(tree.creationParent(cas.path),root.path);
  assert.equal(tree.creationParent('C:\\missing.cas'),root.path);
});
test('refresh prunes removed subtrees, cached rows and selection while preserving other expansions',()=>{
  const tree=new FolderTree();tree.reset({...root,entries:[sub,cas]});
  tree.setChildren(sub.path,[folder(sub.path+'\\nested')]);tree.expanded.add(pathKey(sub.path));
  tree.setChildren(sub.path+'\\nested',[file(sub.path+'\\nested\\b.cas')]);tree.selected=sub.path+'\\nested\\b.cas';
  tree.setChildren(root.path,[cas]);
  assert.equal(tree.creationParent(),root.path);assert.equal(tree.children.size,1);
  assert.equal(tree.expanded.has(pathKey(sub.path)),false);assert.deepEqual(tree.rows().map(r=>r.entry.path),[root.path,cas.path]);
});
test('changing or closing a folder does not close editor tabs or change project registration',()=>{
  const wb=new Workbench(),doc=wb.create('unsaved');wb.project={path:null,fileIds:[doc.id],dirty:true};
  const tree=new FolderTree();tree.reset({...root,entries:[sub,cas]});tree.reset({...folder('C:\\other'),entries:[]});tree.reset(null);
  assert.deepEqual(tree.rows(),[]);assert.equal(tree.children.size,0);assert.equal(tree.selected,null);
  assert.equal(wb.source(doc.id),doc);assert.deepEqual(wb.project.fileIds,[doc.id]);assert.equal(doc.source,'unsaved');
});
test('only CAS and CMK names open in the application and directory-link paths remain finite',()=>{
  assert.equal(explorerFileKind('MAIN.CAS'),'cas');assert.equal(explorerFileKind('p.CmK'),'cmk');
  assert.equal(explorerFileKind('notes.txt'),null);assert.equal(explorerFileKind('main.cas.bak'),null);
  const tree=new FolderTree(),link=folder(root.path+'\\link');tree.reset({...root,entries:[link]});
  tree.expanded.add(pathKey(link.path));tree.setChildren(link.path,[folder(link.path+'\\link')]);
  assert.equal(tree.rows().length,3);assert.equal(tree.rows().at(-1).depth,3);
});

test('renaming a folder preserves loaded descendants, expansion and keyboard selection',()=>{
  const tree=new FolderTree();tree.reset({...root,entries:[sub,cas]});
  const nested=folder(sub.path+'\\nested');tree.setChildren(sub.path,[nested]);
  tree.setChildren(nested.path,[file(nested.path+'\\main.cas')]);
  tree.expanded.add(pathKey(sub.path));tree.expanded.add(pathKey(nested.path));tree.selected=nested.path+'\\main.cas';
  const to=root.path+'\\renamed';tree.rename(sub.path,to);
  assert.equal(tree.selected,to+'\\nested\\main.cas');
  assert.equal(tree.entry(to).name,'renamed');assert.equal(tree.parent(tree.selected),to+'\\nested');
  assert.equal(tree.expanded.has(pathKey(to+'\\nested')),true);
  assert.equal(tree.rows().at(-2).entry.path,tree.selected);
  tree.setChildren(root.path,[folder(to),cas]);assert.equal(tree.children.size,3);
  tree.rename(to,root.path+'\\Renamed');assert.equal(tree.entry(to).name,'Renamed');
});

test('path rebasing respects component boundaries, case and extended Windows/UNC aliases',()=>{
  assert.equal(pathWithin('C:\\src-old\\a.cas','C:\\src'),false);
  assert.equal(pathWithin(null,'C:\\src'),false);
  assert.equal(rebasePath('C:/SRC/Nested/A.cas','c:\\src\\','C:\\new'),'C:\\new\\Nested\\A.cas');
  assert.equal(rebasePath('\\\\?\\C:\\src\\A.cas','c:/src','C:\\new'),'C:\\new\\A.cas');
  assert.equal(rebasePath('C:\\src\\A.cas','\\\\?\\C:\\src','C:\\new'),'C:\\new\\A.cas');
  assert.equal(rebasePath('\\\\?\\UNC\\host\\share\\src\\A.cas','\\\\host\\share\\src','\\\\host\\share\\new'),'\\\\host\\share\\new\\A.cas');
  assert.equal(rebasePath('C:\\src-old\\a.cas','C:\\src','C:\\new'),'C:\\src-old\\a.cas');
});

test('renaming linked sources keeps document identity and edits while invalidating simulator paths',()=>{
  const wb=new Workbench(),a=wb.open({path:'C:\\src\\a.cas',source:'saved'}),b=wb.open({path:'C:\\other\\b.cas',source:'other'});
  a.source='unsaved';wb.project={path:'C:\\src\\project.cmk',fileIds:[a.id,b.id],dirty:false};
  const sim=wb.ensureSimulator(b.id,{step_mode:'instruction'});sim.sourceIds=[b.id,a.id];sim.sourceFiles.set(a.id,a.name);sim.buildKey='old';
  const tabs=[...wb.editorTabs],changed=renameWorkbenchPaths(wb,'C:\\src','C:\\moved');
  assert.deepEqual([...changed],[a.id]);assert.equal(wb.source(a.id),a);assert.equal(a.source,'unsaved');assert.equal(a.saved,'saved');
  assert.deepEqual(wb.editorTabs,tabs);assert.equal(a.path,'C:\\moved\\a.cas');assert.equal(wb.project.path,'C:\\moved\\project.cmk');
  assert.equal(wb.project.dirty,true);assert.equal(sim.buildKey,null);assert.equal(b.path,'C:\\other\\b.cas');
  renameWorkbenchPaths(wb,a.path,'C:\\moved\\renamed.cas');assert.equal(sim.sourceFiles.get(a.id),'renamed.cas');
});

test('delete confirmation defaults to Move each time and only remembers an accepted opt-out',async()=>{
  const previous=globalThis.document, checkbox={checked:true}, message={textContent:''};
  let close,focused='cancel';
  const accept={focus(){focused='delete';}},cancel={};
  const dialog={returnValue:'',addEventListener(type,callback){assert.equal(type,'close');close=callback;},showModal(){},querySelector(selector){return selector==='[value=cancel]'?cancel:accept;},close(value){this.returnValue=value;close();}};
  globalThis.document={getElementById(id){return {'delete-dialog':dialog,'delete-dont-ask':checkbox,'delete-message':message}[id];}};
  try {
    const cancelled=confirmFileDeletion('日本語.cas',false);
    assert.equal(focused,'delete');assert.equal(dialog.returnValue,'cancel');assert.equal(checkbox.checked,false);
    checkbox.checked=true;dialog.returnValue='cancel';close();assert.deepEqual(await cancelled,{confirmed:false,dontAskAgain:false});
    focused='cancel';const accepted=confirmFileDeletion('<folder>',true);
    assert.equal(focused,'delete');assert.equal(checkbox.checked,false);assert.match(message.textContent,/<folder> とその中の項目/);
    checkbox.checked=true;let prevented=false;
    dialog.onkeydown({key:'Enter',target:checkbox,isComposing:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);
    dialog.onkeydown({key:'Enter',target:checkbox,isComposing:false,preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.deepEqual(await accepted,{confirmed:true,dontAskAgain:true});
  } finally { globalThis.document=previous; }
});
