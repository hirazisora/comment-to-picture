import {LIMITS, rectangle, validRegion, exportDocument} from './model.mjs';
import * as pdfjs from './vendor/pdfjs/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
const state = {sources: [], pages: [], current: -1, draft: null, dirty: false, zoom: 1, renderToken: 0, importJob: null, rendering: false, deleting: false, copying: false};
let pendingAction = null, confirmationAction = null, renderTask = null, drag = null, preview = null, pan = null;
const id = () => crypto.randomUUID();
const current = () => state.pages[state.current];
const commentColors = ['#a35416','#2869a5','#923d78','#367442','#7853a2','#a33746','#277577','#735b2e','#4959a2','#566634'];
function colorComment(element,index) {const color=commentColors[index % commentColors.length];element.style.setProperty('--comment-color',color);element.style.setProperty('--comment-tint',color+'1a');}
const tell = (message, error = false) => { $('status').textContent = error ? message : ''; $('status').hidden = !error; };
function button(text, action, className = '') { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = className; b.onclick = action; return b; }
function guarded(action) { if(state.deleting || confirmationAction || $('unsaved-dialog').open)return; if (state.dirty) { stopPan();pendingAction = action; $('unsaved-dialog').showModal(); } else { closeEditor(); action(); } }
function closeEditor() { state.draft = null; state.dirty = false; $('editor').hidden = true; $('editor-error').textContent = ''; drawRegions(); }
function editComment(comment) {
  state.draft = {id: comment.id || id(), region: {...comment.region}, text: comment.text || '', existing: !!comment.id};
  state.dirty = !comment.id; $('editor').hidden = false;
  $('editor-title').textContent = comment.id ? 'コメントを編集' : '新しいコメント';
  $('comment-text').value = state.draft.text;
  $('editor-error').textContent = ''; drawRegions(); $('comment-text').focus();
}
function saveDraft() {
  if (!state.draft || !current()) return true;
  const text = $('comment-text').value, region = {...state.draft.region};
  if (!text.trim() || !validRegion(region)) { $('editor-error').textContent = !text.trim() ? 'コメントを入力してください。' : '範囲は画像内に収め、幅と高さを0より大きくしてください。'; return false; }
  const c = {id: state.draft.id, text, region}, list = current().comments;
  const index = list.findIndex(item => item.id === c.id);
  if (index < 0) list.push(c); else list[index] = c;
  closeEditor(); refreshComments(); refreshPages(); refreshSummary(); tell('コメントを保存しました。JSONに含まれます。'); return true;
}
$('editor').onsubmit = e => { e.preventDefault(); saveDraft(); };
$('comment-text').oninput = () => { state.dirty = true; };
$('cancel-edit').onclick = () => guarded(() => tell('編集を終了しました。'));
for (const choice of ['save','discard','stay']) $('draft-'+choice).onclick = () => {
  if (choice === 'save' && !saveDraft()) { $('unsaved-dialog').close(); pendingAction = null; return; }
  const action = pendingAction; pendingAction = null; $('unsaved-dialog').close();
  if(choice !== 'stay') {closeEditor(); action?.();}
};
$('unsaved-dialog').addEventListener('cancel', () => { pendingAction = null; });
function confirmRemoval(title,message,action) {
  if(state.deleting || state.importJob || confirmationAction || $('unsaved-dialog').open)return;
  stopPan();confirmationAction=action;$('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-dialog').showModal();
}
function cancelRemoval() {confirmationAction=null;$('confirm-dialog').close();}
$('cancel-delete').onclick=cancelRemoval;
$('confirm-dialog').addEventListener('cancel',()=>{confirmationAction=null;});
$('confirm-delete').onclick=async()=>{
  if(!confirmationAction || state.deleting)return;
  const action=confirmationAction;confirmationAction=null;state.deleting=true;refreshSummary();refreshPages();refreshNavigation();$('confirm-dialog').close();
  try {await action();} catch {tell('削除処理でエラーが発生しました。表示を確認し、もう一度お試しください。',true);}
  finally {state.deleting=false;refreshSummary();refreshPages();refreshNavigation();}
};
function refreshNavigation() {
  const active=!!current();
  $('previous').disabled=!active || state.current===0 || state.deleting;
  $('next').disabled=!active || state.current===state.pages.length-1 || state.deleting;
  for(const key of ['zoom-in','zoom-out','fit'])$(key).disabled=!active || state.deleting;
}
function showEmptyState() {
  stopInteractions();
  ++state.renderToken;renderTask?.cancel();renderTask=null;state.current=-1;state.rendering=false;
  drag=null;preview=null;closeEditor();refreshPages();refreshComments();refreshSummary();refreshNavigation();
  $('stage').hidden=true;$('render-error').hidden=true;$('empty-state').hidden=false;$('canvas').width=1;$('canvas').height=1;$('page-label').textContent='プレビュー';$('dimensions').textContent='';tell('');
}
async function releaseSources(sources) {
  await Promise.all(sources.map(async source=>{if(source.url)URL.revokeObjectURL(source.url);await source.document?.destroy();}));
}
async function deletePage(pageId) {
  const index=state.pages.findIndex(p=>p.id===pageId);if(index<0)return;
  const selectedId=current()?.id,removed=state.pages[index],wasCurrent=selectedId===pageId;
  if(wasCurrent){++state.renderToken;renderTask?.cancel();renderTask=null;closeEditor();}
  state.pages.splice(index,1);
  const retired=state.sources.filter(s=>s.id===removed.sourceId && !state.pages.some(p=>p.sourceId===s.id));
  state.sources=state.sources.filter(s=>!retired.includes(s));
  if(!state.pages.length)showEmptyState();
  else if(wasCurrent){state.current=-1;await selectPage(Math.min(index,state.pages.length-1));}
  else {state.current=state.pages.findIndex(p=>p.id===selectedId);refreshComments();refreshPages();refreshSummary();refreshNavigation();$('page-label').textContent=`${state.current+1} / ${state.pages.length}`;}
  await releaseSources(retired);
}
function requestPageDeletion(pageId) {
  const p=state.pages.find(p=>p.id===pageId);if(!p)return;
  const unsaved=p.id===current()?.id && state.dirty ? ' 入力中の未保存コメントも削除されます。' : '';
  confirmRemoval('このページを削除しますか？',`${p.name}${p.unit==='pt'?' の元PDF '+p.number+'ページ':''}と、このページのコメントを削除します。元ファイルは変更しません。${unsaved}`,()=>deletePage(pageId));
}
function refreshSummary() {
  const count = state.pages.reduce((n,p)=>n+p.comments.length,0);
  $('summary').textContent = `${state.sources.length}ファイル / ${state.pages.length}ページ / ${count}コメント`;
  $('page-count').textContent = state.pages.length;
  $('copy-json').disabled=!state.pages.length || state.deleting || state.copying;
  $('download-json').disabled=!state.pages.length || state.deleting;
  $('clear-all').disabled=!state.pages.length || state.deleting || !!state.importJob;
  for(const key of ['add-files','empty-add'])$(key).disabled=state.deleting || !!state.importJob;
}
function refreshPages() {
  const list = $('page-list'); list.replaceChildren(); $('page-empty').hidden = !!state.pages.length;
  state.pages.forEach((p,index) => {
    const b = button('', () => guarded(()=>selectPage(index)), 'page-item'+(index===state.current?' active':''));
    b.setAttribute('aria-current', index===state.current?'page':'false');b.disabled=state.deleting;b.dataset.pageId=p.id;
    if(p.url) {const img = document.createElement('img'); img.src=p.url; img.alt=''; b.append(img);}
    const title = document.createElement('span'); title.className='page-number'; title.textContent=`${index+1}. ${p.name}`;
    const detail=document.createElement('small'); detail.textContent=`${p.unit==='pt'?'PDF '+p.number+'ページ':'画像'} · ${p.comments.length}コメント`; b.append(title,detail);
    const entry=document.createElement('div');entry.className='page-entry';
    const remove=button('×',()=>requestPageDeletion(p.id),'page-remove');remove.dataset.pageId=p.id;remove.setAttribute('aria-label',`${p.name}${p.unit==='pt'?' PDF '+p.number+'ページ':''} を削除`);remove.disabled=state.deleting || !!state.importJob;entry.append(b,remove);list.append(entry);
  });
}
function refreshComments() {
  const p = current(), list=$('comment-list'); list.replaceChildren();
  $('comment-count').textContent=p?.comments.length || 0; $('comment-empty').hidden=!!p?.comments.length;
  p?.comments.forEach((c,index)=>{
    const card=document.createElement('div'); card.className='comment-card';card.dataset.commentId=c.id;colorComment(card,index);
    const open=button('',()=>guarded(()=>editComment(c)),'comment-open');
    open.setAttribute('aria-label',`コメント ${index+1} を編集`);
    const label=document.createElement('strong'); label.className='comment-number';label.textContent=String(index+1);
    const text=document.createElement('p'); text.textContent=c.text; open.append(label,text);
    card.append(open,button('削除',()=>confirmRemoval('このコメントを削除しますか？',state.dirty && state.draft?.id===c.id?'編集中の未保存内容も削除されます。':'この範囲のコメントを削除します。',()=>{if(state.draft?.id===c.id)closeEditor();p.comments=p.comments.filter(x=>x.id!==c.id);refreshComments();refreshPages();refreshSummary();drawRegions();}),'delete')); list.append(card);
  }); drawRegions();
}
function addRegionElement(region, number, active=false, action=null) {
  const el=action?button('',action,'region'):document.createElement('div');
  if(!action)el.className='region preview';
  if(active)el.classList.add('active');
  colorComment(el,number ? number-1 : current()?.comments.length || 0);
  Object.assign(el.style,{left:region.x*100+'%',top:region.y*100+'%',width:region.width*100+'%',height:region.height*100+'%'});
  if(number) {const label=document.createElement('span');label.textContent=number;el.append(label);el.setAttribute('aria-label',`コメント ${number} を編集`);}
  $('overlay').append(el);return el;
}
function drawRegions() {
  $('overlay').replaceChildren(); const p=current();
  p?.comments.forEach((c,i)=>{if(c.id!==state.draft?.id)addRegionElement(c.region,i+1,false,()=>guarded(()=>editComment(c)));});
  if(state.draft && validRegion(state.draft.region)){
    const index=p.comments.findIndex(c=>c.id===state.draft.id);
    addRegionElement(state.draft.region,index<0?p.comments.length+1:index+1,true);
  }
  for(const card of $('comment-list').children)card.classList.toggle('active',card.dataset.commentId===state.draft?.id);
}
function fitStage() {
  const p=current(); if(!p)return;
  const available=Math.max(180,$('viewport').clientWidth-48);
  const base=Math.min(available,Math.max(180,($('viewport').clientHeight-48)*p.width/p.height));
  const width=base*state.zoom;
  $('stage').style.width=width+'px'; $('stage').style.height=width*p.height/p.width+'px'; $('zoom-label').textContent=Math.round(state.zoom*100)+'%';
}
new ResizeObserver(fitStage).observe($('viewport'));
function zoom(delta) {stopInteractions();state.zoom=Math.min(4,Math.max(.25,state.zoom+delta)); fitStage();}
$('zoom-in').onclick=()=>zoom(.25); $('zoom-out').onclick=()=>zoom(-.25); $('fit').onclick=()=>{stopInteractions();state.zoom=1;fitStage();$('viewport').scrollTo(0,0);};
async function selectPage(index) {
  if(index<0||index>=state.pages.length)return;
  stopInteractions();
  state.current=index; state.zoom=1;state.rendering=true; const token=++state.renderToken;
  if(renderTask) {renderTask.cancel();renderTask=null;}
  $('empty-state').hidden=true; $('stage').hidden=true;$('render-error').hidden=true;
  $('page-label').textContent=`${index+1} / ${state.pages.length}`;
  refreshNavigation();
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
    $('stage').hidden=false;
    $('dimensions').textContent=`${p.name} · ${p.number}ページ · ${Math.round(p.width)} × ${Math.round(p.height)} ${p.unit==='pt'?'pt':'px'}`;
    state.rendering=false;tell('ドラッグして範囲を指定し、コメントを追加してください。');
  } catch(error) {
    if(token!==state.renderToken)return;
    state.rendering=false;$('render-error').hidden=false;$('render-error').textContent='このページを表示できませんでした。別のページを選ぶか、ファイルを再読み込みしてください。';tell('ページの表示に失敗しました。',true);
  }
}
$('previous').onclick=()=>guarded(()=>selectPage(state.current-1)); $('next').onclick=()=>guarded(()=>selectPage(state.current+1));
function point(e) {const box=$('overlay').getBoundingClientRect();return {x:(e.clientX-box.left)/box.width,y:(e.clientY-box.top)/box.height};}
function stopPan() {
  const finished=pan;pan=null;$('viewport').classList.remove('panning');
  if(finished && $('viewport').hasPointerCapture(finished.pointer))$('viewport').releasePointerCapture(finished.pointer);
}
function stopInteractions() {
  stopPan();const finished=drag;drag=null;preview?.remove();preview=null;
  if(finished && $('overlay').hasPointerCapture(finished.pointer))$('overlay').releasePointerCapture(finished.pointer);
}
$('viewport').addEventListener('pointerdown',e=>{
  if(e.button!==1 || !current() || state.rendering || state.deleting || drag || pan)return;
  e.preventDefault();e.stopPropagation();
  pan={pointer:e.pointerId,x:e.clientX,y:e.clientY,left:$('viewport').scrollLeft,top:$('viewport').scrollTop};
  $('viewport').setPointerCapture(e.pointerId);$('viewport').classList.add('panning');
},true);
$('viewport').addEventListener('mousedown',e=>{if(e.button===1 && current())e.preventDefault();},true);
$('viewport').addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});
$('viewport').addEventListener('pointermove',e=>{
  if(!pan || e.pointerId!==pan.pointer)return;
  if(!(e.buttons&4)){stopPan();return;}
  e.preventDefault();$('viewport').scrollLeft=pan.left-(e.clientX-pan.x);$('viewport').scrollTop=pan.top-(e.clientY-pan.y);
});
$('viewport').addEventListener('pointerup',e=>{if(pan && e.pointerId===pan.pointer && (e.button===1 || !(e.buttons&4)))stopPan();});
$('viewport').addEventListener('pointercancel',stopPan);
$('viewport').addEventListener('lostpointercapture',stopPan);
$('viewport').addEventListener('wheel',stopPan,{passive:true});
window.addEventListener('blur',stopInteractions);
window.addEventListener('resize',stopInteractions);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopInteractions();});
$('overlay').onpointerdown=e=>{
  if(e.button!==0||e.target.closest('button')||state.rendering||state.deleting||pan||!current())return;
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
  refreshPages();
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
      if(state.sources.some(s=>s.fingerprint===fingerprint))continue;
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
  tell(notices.join(' '),notices.length>0);
}
function openPicker(){guarded(()=>$('file-input').click());}
$('add-files').onclick=openPicker;$('empty-add').onclick=openPicker;
function requestImport(files) {
  if(!files.length)return;
  if(state.importJob || state.deleting){tell('処理中です。完了後にもう一度追加してください。',true);return;}
  if(document.querySelector('dialog[open]'))return;
  guarded(()=>importFiles(files));
}
$('file-input').onchange=e=>{const files=Array.from(e.target.files);e.target.value='';requestImport(files);};
document.addEventListener('paste',e=>{
  const files=Array.from(e.clipboardData?.files || []).filter(file=>file.type.startsWith('image/'));
  if(!files.length)return;
  e.preventDefault();requestImport(files);
});
let fileDragDepth=0;
const hasDraggedFiles=e=>Array.from(e.dataTransfer?.types || []).includes('Files');
const editingTarget=e=>e.target instanceof Element && e.target.closest('input,textarea,[contenteditable]:not([contenteditable="false"])');
function clearFileDrag(){fileDragDepth=0;document.body.classList.remove('file-dragging');}
document.addEventListener('dragenter',e=>{
  if(!hasDraggedFiles(e))return;
  e.preventDefault();fileDragDepth++;document.body.classList.add('file-dragging');
});
document.addEventListener('dragover',e=>{
  if(!hasDraggedFiles(e)){
    if(!editingTarget(e)){e.preventDefault();e.dataTransfer.dropEffect='none';}
    return;
  }
  e.preventDefault();e.dataTransfer.dropEffect=state.importJob || state.deleting || document.querySelector('dialog[open]')?'none':'copy';
});
document.addEventListener('dragleave',()=>{if(fileDragDepth>0 && --fileDragDepth===0)clearFileDrag();});
document.addEventListener('drop',e=>{
  const files=Array.from(e.dataTransfer?.files || []),isFileDrop=files.length || hasDraggedFiles(e);
  clearFileDrag();if(!isFileDrop){
    if(!editingTarget(e)){
      e.preventDefault();
      if(Array.from(e.dataTransfer?.types || []).includes('text/uri-list'))tell('URLからは読み込めません。画像・PDFファイルを追加してください。',true);
    }
    return;
  }
  e.preventDefault();
  if(files.length)requestImport(files);else tell('画像・PDFファイルを直接ドロップしてください。',true);
});
document.addEventListener('dragend',clearFileDrag);window.addEventListener('blur',clearFileDrag);
$('cancel-import').onclick=()=>{const job=state.importJob;if(job){job.cancelled=true;job.cancelCurrent?.();$('progress').textContent='中止しています…';}};
$('clear-all').onclick=()=>confirmRemoval('すべて削除しますか？',`読み込んだすべての画像・PDFとコメントを削除します。必要なコメントJSONは先に保存してください。${state.dirty?' 入力中の未保存コメントも削除されます。':''}`,async()=>{const retired=state.sources;state.sources=[];state.pages=[];showEmptyState();await releaseSources(retired);});
const json = () => JSON.stringify(exportDocument(state.sources,state.pages),null,2);
$('copy-json').onclick=()=>{if(state.copying)return;guarded(async()=>{const text=json();state.copying=true;refreshSummary();try{await navigator.clipboard.writeText(text);stopPan();tell('');$('copy-success-dialog').showModal();}catch{stopPan();$('copy-fallback').value=text;$('copy-dialog').showModal();$('copy-fallback').focus();$('copy-fallback').select();tell('コピーできませんでした。手動コピーまたはJSON保存をご利用ください。',true);}finally{state.copying=false;refreshSummary();}});};
function closeCopyDialog(dialog) {$(dialog).close();if(!$('copy-json').disabled)$('copy-json').focus();}
$('close-copy').onclick=()=>closeCopyDialog('copy-dialog');
$('close-copy-success').onclick=()=>closeCopyDialog('copy-success-dialog');
for(const dialog of ['copy-dialog','copy-success-dialog']){
  $(dialog).addEventListener('cancel',e=>{e.preventDefault();closeCopyDialog(dialog);});
  $(dialog).addEventListener('close',()=>{if(!$('copy-json').disabled)$('copy-json').focus();});
}
$('download-json').onclick=()=>guarded(()=>{const url=URL.createObjectURL(new Blob([json()],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='ココヲコウ-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);tell('全ページのJSONファイルを保存しました。');});
window.addEventListener('beforeunload',e=>{if(state.pages.length||state.importJob){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{
  if($('unsaved-dialog').open||$('copy-dialog').open||$('copy-success-dialog').open||$('confirm-dialog').open||state.deleting)return;
  if(e.key==='Escape'){if(pan||drag){stopInteractions();return;}if(state.draft){e.preventDefault();guarded(()=>tell('編集を終了しました。'));}return;}
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&state.draft){e.preventDefault();$('editor').requestSubmit();return;}
  if(e.target.closest('input,textarea,button,summary')||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='ArrowLeft'){e.preventDefault();guarded(()=>selectPage(state.current-1));}
  if(e.key==='ArrowRight'){e.preventDefault();guarded(()=>selectPage(state.current+1));}
  if(e.key==='+'||e.key==='=')zoom(.25);if(e.key==='-')zoom(-.25);
});
