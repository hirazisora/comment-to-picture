import {LIMITS, rectangle, validRegion, exportDocument} from './model.mjs';
import * as pdfjs from './vendor/pdfjs/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
const state = {sources: [], pages: [], current: -1, draft: null, dirty: false, zoom: 1, renderToken: 0, importJob: null, rendering: false};
let pendingAction = null, renderTask = null, drag = null, preview = null;
const id = () => crypto.randomUUID();
const current = () => state.pages[state.current];
const tell = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
function button(text, action, className = '') { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = className; b.onclick = action; return b; }
function guarded(action) { if (state.dirty) { pendingAction = action; $('unsaved-dialog').showModal(); } else { closeEditor(); action(); } }
function closeEditor() { state.draft = null; state.dirty = false; $('editor').hidden = true; $('editor-error').textContent = ''; drawRegions(); }
function draftRegion() { return Object.fromEntries(['x','y','width','height'].map(k => [k, Number($('region-'+k).value)/100])); }
function editComment(comment) {
  state.draft = {id: comment.id || id(), region: {...comment.region}, text: comment.text || '', existing: !!comment.id};
  state.dirty = !comment.id; $('editor').hidden = false;
  $('editor-title').textContent = comment.id ? 'コメントを編集' : '新しいコメント';
  $('comment-text').value = state.draft.text;
  for (const k of ['x','y','width','height']) $('region-'+k).value = +(state.draft.region[k]*100).toFixed(3);
  $('editor-error').textContent = ''; drawRegions(); $('comment-text').focus();
}
function saveDraft() {
  if (!state.draft || !current()) return true;
  const text = $('comment-text').value.trim(), region = draftRegion();
  if (!text || !validRegion(region)) { $('editor-error').textContent = !text ? 'コメントを入力してください。' : '範囲は画像内に収め、幅と高さを0より大きくしてください。'; return false; }
  const c = {id: state.draft.id, text, region}, list = current().comments;
  const index = list.findIndex(item => item.id === c.id);
  if (index < 0) list.push(c); else list[index] = c;
  closeEditor(); refreshComments(); refreshPages(); refreshSummary(); tell('コメントを保存しました。JSONに含まれます。'); return true;
}
$('editor').onsubmit = e => { e.preventDefault(); saveDraft(); };
$('comment-text').oninput = () => { state.dirty = true; };
for (const k of ['x','y','width','height']) $('region-'+k).oninput = () => { state.dirty = true; if(state.draft) {state.draft.region = draftRegion(); drawRegions();} };
$('cancel-edit').onclick = () => guarded(() => tell('編集を終了しました。'));
for (const choice of ['save','discard','stay']) $('draft-'+choice).onclick = () => {
  if (choice === 'save' && !saveDraft()) { $('unsaved-dialog').close(); pendingAction = null; return; }
  const action = pendingAction; pendingAction = null; $('unsaved-dialog').close();
  if(choice !== 'stay') {closeEditor(); action?.();}
};
$('unsaved-dialog').addEventListener('cancel', () => { pendingAction = null; });
function refreshSummary() {
  const count = state.pages.reduce((n,p)=>n+p.comments.length,0);
  $('summary').textContent = `${state.sources.length}ファイル / ${state.pages.length}ページ / ${count}コメント`;
  $('page-count').textContent = state.pages.length;
  for (const key of ['copy-json','download-json','clear-all']) $(key).disabled = !state.pages.length;
}
function refreshPages() {
  const list = $('page-list'); list.replaceChildren(); $('page-empty').hidden = !!state.pages.length;
  state.pages.forEach((p,index) => {
    const b = button('', () => guarded(()=>selectPage(index)), 'page-item'+(index===state.current?' active':''));
    b.setAttribute('aria-current', index===state.current?'page':'false');
    if(p.url) {const img = document.createElement('img'); img.src=p.url; img.alt=''; b.append(img);}
    const title = document.createElement('span'); title.className='page-number'; title.textContent=`${index+1}. ${p.name}`;
    const detail=document.createElement('small'); detail.textContent=`${p.unit==='pt'?'PDF '+p.number+'ページ':'画像'} · ${p.comments.length}コメント`; b.append(title,detail); list.append(b);
  });
}
function refreshComments() {
  const p = current(), list=$('comment-list'); list.replaceChildren();
  $('comment-count').textContent=p?.comments.length || 0; $('comment-empty').hidden=!!p?.comments.length;
  p?.comments.forEach((c,index)=>{
    const card=document.createElement('div'); card.className='comment-card';
    const open=button('',()=>guarded(()=>editComment(c)),'comment-open');
    const label=document.createElement('strong'); label.textContent=`${index+1}. コメント`;
    const text=document.createElement('p'); text.textContent=c.text; open.append(label,text);
    const region=document.createElement('small'); region.className='muted'; region.textContent=`左 ${Math.round(c.region.x*100)}% · 上 ${Math.round(c.region.y*100)}% · 幅 ${Math.round(c.region.width*100)}% · 高さ ${Math.round(c.region.height*100)}%`;
    card.append(open,region,button('削除',()=>guarded(()=>{if(confirm('このコメントを削除しますか？')) {p.comments=p.comments.filter(x=>x.id!==c.id); refreshComments(); refreshPages(); refreshSummary(); drawRegions();}}),'delete')); list.append(card);
  }); drawRegions();
}
function addRegionElement(region, number, active=false, action=null) {
  const el=action?button('',action,'region'):document.createElement('div');
  if(!action)el.className='region preview';
  if(active)el.classList.add('active');
  Object.assign(el.style,{left:region.x*100+'%',top:region.y*100+'%',width:region.width*100+'%',height:region.height*100+'%'});
  if(number) {const label=document.createElement('span');label.textContent=number;el.append(label);el.setAttribute('aria-label',`コメント ${number} を編集`);}
  $('overlay').append(el);return el;
}
function drawRegions() {
  $('overlay').replaceChildren(); const p=current();
  p?.comments.forEach((c,i)=>{if(c.id!==state.draft?.id)addRegionElement(c.region,i+1,false,()=>guarded(()=>editComment(c)));});
  if(state.draft && validRegion(state.draft.region))addRegionElement(state.draft.region,null,true);
}
function fitStage() {
  const p=current(); if(!p)return;
  const available=Math.max(180,$('viewport').clientWidth-48);
  const base=Math.min(available,Math.max(180,($('viewport').clientHeight-48)*p.width/p.height));
  const width=base*state.zoom;
  $('stage').style.width=width+'px'; $('stage').style.height=width*p.height/p.width+'px'; $('zoom-label').textContent=Math.round(state.zoom*100)+'%';
}
new ResizeObserver(fitStage).observe($('viewport'));
function zoom(delta) {state.zoom=Math.min(4,Math.max(.25,state.zoom+delta)); fitStage();}
$('zoom-in').onclick=()=>zoom(.25); $('zoom-out').onclick=()=>zoom(-.25); $('fit').onclick=()=>{state.zoom=1;fitStage();$('viewport').scrollTo(0,0);};
async function selectPage(index) {
  if(index<0||index>=state.pages.length)return;
  state.current=index; state.zoom=1;state.rendering=true; const token=++state.renderToken;
  if(renderTask) {renderTask.cancel();renderTask=null;}
  $('empty-state').hidden=true; $('stage').hidden=true;$('render-error').hidden=true;
  $('page-label').textContent=`${index+1} / ${state.pages.length}`;
  for(const key of ['zoom-in','zoom-out','fit'])$(key).disabled=false;
  $('keyboard-region').disabled=true;$('previous').disabled=index===0; $('next').disabled=index===state.pages.length-1;
  refreshPages(); refreshComments(); fitStage();$('viewport').scrollTo(0,0);
  const p=current(), source=state.sources.find(s=>s.id===p.sourceId);
  tell('ページを表示しています…');
  try {
    const scale=Math.min(2,Math.sqrt(LIMITS.renderPixels/(p.width*p.height)));
    const canvas=document.createElement('canvas');
    if(p.url) {
      const image=new Image(); image.src=p.url; await image.decode();
      canvas.width=Math.max(1,Math.round(p.width*Math.min(1,scale)));canvas.height=Math.max(1,Math.round(p.height*Math.min(1,scale)));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    } else {
      const pdfPage=await source.document.getPage(p.number);
      if(token!==state.renderToken)return;
      const vp=pdfPage.getViewport({scale});canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
      const task=pdfPage.render({canvasContext:canvas.getContext('2d'),viewport:vp,background:'white'}); renderTask=task;
      await task.promise; if(renderTask===task)renderTask=null;pdfPage.cleanup();
    }
    if(token!==state.renderToken)return;
    $('canvas').width=canvas.width; $('canvas').height=canvas.height;$('canvas').getContext('2d').drawImage(canvas,0,0);
    $('stage').hidden=false;$('keyboard-region').disabled=false;
    $('dimensions').textContent=`${p.name} · ${p.number}ページ · ${Math.round(p.width)} × ${Math.round(p.height)} ${p.unit==='pt'?'pt':'px'}`;
    state.rendering=false;tell('ドラッグして範囲を指定し、コメントを追加してください。');
  } catch(error) {
    if(token!==state.renderToken)return;
    state.rendering=false;$('render-error').hidden=false;$('render-error').textContent='このページを表示できませんでした。別のページを選ぶか、ファイルを再読み込みしてください。';tell('ページの表示に失敗しました。',true);
  }
}
$('previous').onclick=()=>guarded(()=>selectPage(state.current-1)); $('next').onclick=()=>guarded(()=>selectPage(state.current+1));
function newDefaultRegion() {if(current()&&!state.rendering)guarded(()=>editComment({region:{x:.25,y:.25,width:.5,height:.5}}));}
$('keyboard-region').onclick=newDefaultRegion;
function point(e) {const box=$('overlay').getBoundingClientRect();return {x:(e.clientX-box.left)/box.width,y:(e.clientY-box.top)/box.height};}
$('overlay').onpointerdown=e=>{
  if(e.button!==0||e.target.closest('button')||state.rendering||!current())return;
  if(state.dirty){guarded(()=>tell('もう一度ドラッグして範囲を指定してください。'));return;}
  closeEditor();drag={start:point(e),pointer:e.pointerId};$('overlay').setPointerCapture(e.pointerId);preview=addRegionElement({x:0,y:0,width:0,height:0},null);
};
$('overlay').onpointermove=e=>{if(!drag)return;const r=rectangle(drag.start,point(e));Object.assign(preview.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.width*100+'%',height:r.height*100+'%'});};
$('overlay').onpointerup=e=>{if(!drag)return;const r=rectangle(drag.start,point(e));drag=null;preview?.remove();preview=null;if(validRegion(r)&&r.width>=.005&&r.height>=.005)editComment({region:r});else tell('少し大きくドラッグして範囲を囲んでください。');};
$('overlay').onpointercancel=()=>{drag=null;preview?.remove();preview=null;};
function timeout(promise, ms, cancel) {return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cancel?.();reject(new Error('読み込み時間が上限を超えました。'));},ms);promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});}
async function importFiles(files) {
  if(state.importJob)return;
  const job={cancelled:false,cancelCurrent:null};state.importJob=job; $('loading').hidden=false;$('add-files').disabled=true;$('empty-add').disabled=true;$('clear-all').disabled=true;
  const notices=[]; let added=0;
  for(const file of files) {
    if(job.cancelled)break;
    let url=null, document=null, task=null;
    $('progress').textContent=`${file.name} を読み込み中…`;
    try {
      if(file.size>LIMITS.fileBytes)throw new Error('1ファイル50MBを超えています。');
      if(file.size===0)throw new Error('空のファイルです。');
      const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
      if(!isPdf && !/^(image\/(png|jpeg|webp|gif|bmp))$/.test(file.type))throw new Error('対応する画像形式またはPDFを選んでください。');
      const bytes=await file.arrayBuffer();if(job.cancelled)break;
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      if(job.cancelled)break;
      const fingerprint=file.name+':'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
      if(state.sources.some(s=>s.fingerprint===fingerprint)){notices.push(`${file.name}: 追加済みのためスキップ。`);continue;}
      if(state.sources.reduce((n,s)=>n+s.size,0)+file.size>LIMITS.totalBytes)throw new Error('合計150MBを超えます。');
      const source={id:id(),name:file.name,size:file.size,fingerprint,type:isPdf?'pdf':'image',pageCount:1}; const pages=[];
      if(isPdf) {
        const data=new Uint8Array(bytes);if(job.cancelled)break;
        task=pdfjs.getDocument({data,cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href,useSystemFonts:false,isEvalSupported:false,enableXfa:false});
        const passwordFailure=new Promise((resolve,reject)=>{task.onPassword=()=>{const e=new Error('パスワード付きPDFは読み込めません。');e.name='PasswordException';reject(e);};});
        let rejectCancel;
        const cancelFailure=new Promise((resolve,reject)=>{rejectCancel=reject;});
        job.cancelCurrent=()=>{rejectCancel(new Error('cancelled'));task.destroy().catch(()=>{});};
        document=await timeout(Promise.race([task.promise,passwordFailure,cancelFailure]),30000,()=>task.destroy());
        if(document.numPages+state.pages.length>LIMITS.pages)throw new Error('最大100ページを超えます。');
        for(let n=1;n<=document.numPages;n++) {
          if(job.cancelled)break;
          const pdfPage=await timeout(Promise.race([document.getPage(n),cancelFailure]),10000,()=>task.destroy());const v=pdfPage.getViewport({scale:1});
          if(!Number.isFinite(v.width)||!Number.isFinite(v.height)||v.width<=0||v.height<=0||v.width>100000||v.height>100000)throw new Error('ページ寸法が不正または過大です。');
          pages.push({id:id(),sourceId:source.id,name:file.name,number:n,width:v.width,height:v.height,unit:'pt',rotation:pdfPage.rotate,comments:[]});pdfPage.cleanup();
        }
        source.pageCount=document.numPages;source.document=document;
      } else {
        if(state.pages.length>=LIMITS.pages)throw new Error('最大100ページを超えます。');
        url=URL.createObjectURL(file);const image=new Image();image.src=url;
        job.cancelCurrent=()=>{image.src='';};
        await timeout(image.decode(),15000);
        if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>LIMITS.imagePixels)throw new Error('画像は最大4000万画素までです。');
        pages.push({id:id(),sourceId:source.id,name:file.name,number:1,width:image.naturalWidth,height:image.naturalHeight,unit:'px',rotation:0,url,comments:[]});source.url=url;
      }
      if(job.cancelled){if(url)URL.revokeObjectURL(url);await document?.destroy();break;}
      state.sources.push(source);state.pages.push(...pages);url=null;document=null;task=null;added+=pages.length;
    } catch(error) {
      if(url)URL.revokeObjectURL(url);await (document?.destroy() || task?.destroy())?.catch(()=>{});
      if(!job.cancelled)notices.push(`${file.name}: ${error.name==='PasswordException'?'パスワード付きPDFは読み込めません。':error.message?.includes('上限')||error.message?.includes('超え')||error.message?.includes('形式')||error.message?.includes('最大')||error.message?.includes('空')?error.message:'読み込めませんでした。不正・破損・パスワード付きのファイルをご確認ください。'}`);
    } finally {job.cancelCurrent=null;}
  }
  state.importJob=null;$('loading').hidden=true;$('add-files').disabled=false;$('empty-add').disabled=false;refreshSummary();refreshPages();
  if(state.current===-1 && state.pages.length)await selectPage(0);
  else if(current()) { $('page-label').textContent=`${state.current+1} / ${state.pages.length}`; $('next').disabled=state.current===state.pages.length-1; }
  tell(`${job.cancelled?'読み込みを中止しました。完了したファイルは残ります。':`${added}ページを追加しました。`} ${notices.join(' ')}`,notices.length>0);
}
function openPicker(){guarded(()=>$('file-input').click());}
$('add-files').onclick=openPicker;$('empty-add').onclick=openPicker;
$('file-input').onchange=e=>{const files=Array.from(e.target.files);e.target.value='';if(files.length)importFiles(files);};
$('cancel-import').onclick=()=>{const job=state.importJob;if(job){job.cancelled=true;job.cancelCurrent?.();$('progress').textContent='中止しています…';}};
$('clear-all').onclick=()=>guarded(async()=>{
  if(!confirm('すべての画像・PDFとコメントを取り除きますか？必要なJSONは先に保存してください。'))return;
  ++state.renderToken;renderTask?.cancel();renderTask=null;
  for(const s of state.sources){if(s.url)URL.revokeObjectURL(s.url);await s.document?.destroy();}
  state.sources=[];state.pages=[];state.current=-1;state.rendering=false;closeEditor();refreshPages();refreshComments();refreshSummary();
  $('stage').hidden=true;$('render-error').hidden=true;$('empty-state').hidden=false;$('canvas').width=1;$('canvas').height=1;$('page-label').textContent='プレビュー';
  for(const key of ['previous','next','zoom-in','zoom-out','fit','keyboard-region'])$(key).disabled=true;
  $('dimensions').textContent='データはこのタブのメモリ内だけに保存されます。';tell('すべて取り除きました。');
});
const json = () => JSON.stringify(exportDocument(state.sources,state.pages),null,2);
$('copy-json').onclick=()=>guarded(async()=>{const text=json();try{await navigator.clipboard.writeText(text);tell('全ページのJSONをコピーしました。元ファイルと一緒にAIへ渡してください。');}catch{ $('copy-fallback').value=text;$('copy-dialog').showModal();$('copy-fallback').focus();$('copy-fallback').select();tell('コピーできませんでした。手動コピーまたはJSON保存をご利用ください。',true);}});
$('close-copy').onclick=()=>$('copy-dialog').close();
$('download-json').onclick=()=>guarded(()=>{const url=URL.createObjectURL(new Blob([json()],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='comment-to-picture-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);tell('全ページのJSONファイルを保存しました。');});
window.addEventListener('beforeunload',e=>{if(state.pages.length||state.importJob){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{
  if($('unsaved-dialog').open||$('copy-dialog').open)return;
  if(e.key==='Escape'){if(drag){drag=null;preview?.remove();preview=null;return;}if(state.draft){e.preventDefault();guarded(()=>tell('編集を終了しました。'));}return;}
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&state.draft){e.preventDefault();saveDraft();return;}
  if(e.target.closest('input,textarea,button,summary')||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='ArrowLeft'){e.preventDefault();guarded(()=>selectPage(state.current-1));}
  if(e.key==='ArrowRight'){e.preventDefault();guarded(()=>selectPage(state.current+1));}
  if(e.key==='+'||e.key==='=')zoom(.25);if(e.key==='-')zoom(-.25);if(e.key.toLowerCase()==='n')newDefaultRegion();
});
