import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),dep=n=>require(process.env.TEST_MODULES?process.env.TEST_MODULES+'/'+n:n);
const {chromium}=dep('playwright'),{PNG}=dep('pngjs'),{PDFDocument,degrees}=dep('pdf-lib');
const output='test-results/resize';await mkdir(output,{recursive:true});
const png=new PNG({width:1200,height:800});for(let y=0;y<800;y++)for(let x=0;x<1200;x++){const i=(y*1200+x)*4;png.data[i]=x%200<100?210:165;png.data[i+1]=y%200<100?225:190;png.data[i+2]=210;png.data[i+3]=255;}const image=PNG.sync.write(png);
const pdf=await PDFDocument.create();pdf.addPage([800,600]).setRotation(degrees(90));const pdfBytes=Buffer.from(await pdf.save());
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
const page=await context.newPage(),results=[],errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method(),body:r.postData()}));page.on('dialog',d=>d.accept());
const pass=s=>{results.push(s);console.log('PASS '+s);};
const close=(a,b,tol=2e-5)=>{for(const k of ['x','y','width','height'])assert.ok(Math.abs(a[k]-b[k])<tol,k+': '+a[k]+' vs '+b[k]);};
const draft=()=>page.locator('.region.active').evaluate(el=>Object.fromEntries(['left','top','width','height'].map((k,i)=>[['x','y','width','height'][i],parseFloat(el.style[k])/100])));
const saved=async()=>{await page.locator('#copy-json').click();await page.locator('#copy-success-dialog').waitFor({state:'visible'});const json=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));await page.locator('#close-copy-success').click();return json;};
const select=async(a,b)=>{const box=await page.locator('#overlay').boundingBox();await page.mouse.move(box.x+a.x*box.width,box.y+a.y*box.height);await page.mouse.down();await page.mouse.move(box.x+b.x*box.width,box.y+b.y*box.height,{steps:4});await page.mouse.up();};
const save=async text=>{if(text!==undefined)await page.locator('#comment-text').fill(text);await page.locator('#comment-text').press('Control+Enter');await page.locator('#editor').waitFor({state:'hidden'});};
const edit=async(index=0)=>{await page.locator('.comment-open').nth(index).click();await page.waitForFunction(()=>document.querySelector('#video').hidden||!document.querySelector('#video').seeking);await page.locator('.region-handle').first().waitFor();};
const start=async corner=>{await page.locator('.region-handle.'+corner).scrollIntoViewIfNeeded();const h=await page.locator('.region-handle.'+corner).boundingBox(),box=await page.locator('#overlay').boundingBox();const p={x:h.x+h.width/2,y:h.y+h.height/2};await page.mouse.move(p.x,p.y);await page.mouse.down();return {p,box};};
const move=async({p,box},dx,dy)=>page.mouse.move(p.x+box.width*dx,p.y+box.height*dy,{steps:5});
const resize=async(corner,dx,dy)=>{const gesture=await start(corner);await move(gesture,dx,dy);await page.mouse.up();return gesture;};
const discard=async()=>{await page.locator('#cancel-edit').click();if(await page.locator('#unsaved-dialog').isVisible())await page.locator('#draft-discard').click();};
const expected=(r,c,dx,dy)=>({x:r.x+(c.endsWith('w')?dx:0),y:r.y+(c.startsWith('n')?dy:0),width:r.width+(c.endsWith('w')?-dx:dx),height:r.height+(c.startsWith('n')?-dy:dy)});
try {
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('#file-input').setInputFiles([{name:'resize.png',mimeType:'image/png',buffer:image},{name:'second.png',mimeType:'image/png',buffer:image},{name:'rotated.pdf',mimeType:'application/pdf',buffer:pdfBytes}]);
  await page.locator('#loading').waitFor({state:'hidden'});await page.locator('#stage').waitFor({state:'visible'});
  await select({x:.25,y:.25},{x:.55,y:.55});await save('Resize first\n  Preserve exact text');
  await select({x:.7,y:.7},{x:.85,y:.85});await save('Untouched second');
  const baseline=await saved();let before=baseline;
  for(const corner of ['nw','ne','sw','se']) {
    await edit();const r=await draft(),dx=corner.endsWith('w')?-.025:.025,dy=corner.startsWith('n')?-.025:.025;
    const gesture=await resize(corner,dx,dy),target=expected(r,corner,dx,dy);close(await draft(),target,.003);
    await save();const after=await saved();const old=before.pages[0].comments[0],updated=after.pages[0].comments[0];
    close(updated.region,target,.003);assert.equal(updated.comment_id,old.comment_id);assert.equal(updated.number,old.number);assert.equal(updated.comment,old.comment);assert.deepEqual(after.pages[0].comments[1],baseline.pages[0].comments[1]);assert.deepEqual(after.files,baseline.files);before=after;
    pass(corner+' resizes saved region, fixes opposite corner, preserves IDs, text, order and other comments');
  }
  await edit();const original=await draft();const h=await start('se');await page.mouse.up();close(await draft(),original);await discard();assert.ok(await page.locator('#unsaved-dialog').isHidden());assert.deepEqual(await saved(),before);pass('clicking a handle without moving creates no dirty draft or coordinate jump');
  for(const corner of ['nw','ne','sw','se']) {
    await edit();await resize(corner,corner.endsWith('w')?-2:2,corner.startsWith('n')?-2:2);const r=await draft();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1.000001&&r.y+r.height<=1.000001);assert.ok(Math.abs((corner.endsWith('w')?r.x:r.x+r.width)-(corner.endsWith('w')?0:1))<1e-6);assert.ok(Math.abs((corner.startsWith('n')?r.y:r.y+r.height)-(corner.startsWith('n')?0:1))<1e-6);await discard();
    await edit();await resize(corner,corner.endsWith('w')?2:-2,corner.startsWith('n')?2:-2);const small=await draft();assert.ok(Math.abs(small.width-.005)<1e-6);assert.ok(Math.abs(small.height-.005)<1e-6);await resize(corner,corner.endsWith('w')?-.1:.1,corner.startsWith('n')?-.1:.1);assert.ok((await draft()).width>.09);await discard();
  }
  assert.deepEqual(await saved(),before);pass('all corners clamp at image edges and minimum 0.5%; crossing never flips; tiny regions can expand again; discard restores JSON');
  for(const cancel of ['Escape','pointercancel','lostpointercapture','blur','resize','zoom','missing-buttons']) {
    await edit();await page.locator('#comment-text').fill('Unsaved text stays '+cancel);const r=await draft(),g=await start('se');await move(g,.06,.05);assert.ok((await draft()).width>r.width+.04);
    if(cancel==='Escape')await page.keyboard.press('Escape');
    else if(cancel==='zoom'){await page.locator('#zoom-in').evaluate(el=>el.click());}
    else if(cancel==='resize')await page.setViewportSize({width:1400,height:1080});
    else if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    else if(cancel==='missing-buttons')await page.locator('#overlay').dispatchEvent('pointermove',{pointerId:1,buttons:0});
    else await page.locator('#overlay').dispatchEvent(cancel,{pointerId:1});
    await page.waitForFunction(r=>{const el=document.querySelector('.region.active');return el&&Math.abs(parseFloat(el.style.width)/100-r.width)<1e-6&&Math.abs(parseFloat(el.style.height)/100-r.height)<1e-6;},r);
    close(await draft(),r);assert.equal(await page.locator('#comment-text').inputValue(),'Unsaved text stays '+cancel);await page.mouse.up();close(await draft(),r);await discard();await page.locator('#fit').click();await page.setViewportSize({width:1440,height:1100});
  }
  assert.deepEqual(await saved(),before);pass('Escape, pointercancel, capture loss, blur, resize, zoom and lost button roll back only active gesture and retain typed text');
  await edit();let g=await start('nw');await move(g,-.03,-.02);await page.mouse.up();const completed=await draft();g=await start('se');await move(g,.05,.05);await page.keyboard.press('Escape');await page.mouse.up();close(await draft(),completed);await save();before=await saved();close(before.pages[0].comments[0].region,completed);pass('cancel keeps an earlier completed resize and saved JSON uses the completed region');
  await edit();await resize('se',.03,.03);await page.locator('#comment-text').fill('Save on navigation');await page.locator('#next').click();await page.locator('#draft-stay').click();assert.equal(await page.locator('#page-label').innerText(),'1 / 3');await page.locator('#next').click();await page.locator('#draft-save').click();await page.waitForFunction(()=>document.querySelector('#page-label').textContent==='2 / 3');await page.locator('#previous').click();await page.locator('#stage').waitFor({state:'visible'});before=await saved();assert.equal(before.pages[0].comments[0].comment,'Save on navigation');pass('resized region participates in existing stay/save navigation guard');
  await edit();const panBaseline=await draft();for(let i=0;i<4;i++)await page.locator('#zoom-in').click();assert.equal(await page.locator('#zoom-label').innerText(),'200%');
  await page.locator('#viewport').evaluate(el=>{el.scrollLeft=80;el.scrollTop=80;});await page.locator('.region-handle.se').scrollIntoViewIfNeeded();const hbox=await page.locator('.region-handle.se').boundingBox();await page.mouse.move(hbox.x+hbox.width/2,hbox.y+hbox.height/2);await page.mouse.down({button:'middle'});assert.ok(await page.locator('#viewport').evaluate(el=>el.classList.contains('panning')));await page.mouse.move(hbox.x+hbox.width/2-45,hbox.y+hbox.height/2-35);await page.mouse.up({button:'middle'});close(await draft(),panBaseline);assert.equal(await page.locator('#unsaved-dialog').isVisible(),false);
  const zoomBefore=await draft();await resize('se',.03,.02);const zoomAfter=expected(zoomBefore,'se',.03,.02);close(await draft(),zoomAfter,.003);await save();before=await saved();close(before.pages[0].comments[0].region,zoomAfter,.003);assert.equal(before.pages[0].comments.length,2);pass('200% plus scroll/pan exports normalized coordinates; middle button over handle pans without resizing or creating comments');
  for(const [label,button,clicks] of [['25%','zoom-out',3],['400%','zoom-in',12]]) {
    await page.locator('#fit').click();await edit();for(let i=0;i<clicks;i++)await page.locator('#'+button).click();assert.equal(await page.locator('#zoom-label').innerText(),label);
    const original=await draft();await page.locator('.region-handle.nw').scrollIntoViewIfNeeded();assert.equal((await page.locator('.region-handle.nw').boundingBox()).width,20);await resize('nw',-.02,-.02);close(await draft(),expected(original,'nw',-.02,-.02),.001);await save();before=await saved();close(before.pages[0].comments[0].region,expected(original,'nw',-.02,-.02),.001);
  }
  pass('25% and 400% zoom extremes retain 20px mouse targets and export the same normalized resize deltas');
  await page.locator('#fit').click();await edit();await resize('se',.02,.02);await page.screenshot({path:output+'/desktop.png',fullPage:true});
  const target=await draft();await save();before=await saved();const downloadPromise=page.waitForEvent('download');await page.locator('#download-json').click();const download=await downloadPromise;await download.saveAs(output+'/download.json');assert.deepEqual(JSON.parse(await readFile(output+'/download.json','utf8')),before);close(before.pages[0].comments[0].region,target);await writeFile(output+'/export.json',JSON.stringify(before,null,2));pass('clipboard and downloaded JSON agree exactly, including final resized coordinates');
  await page.locator('.page-item').nth(2).click();await page.locator('#stage').waitFor({state:'visible'});await select({x:.2,y:.2},{x:.5,y:.5});await resize('nw',-.04,-.03);await save('Rotated PDF');const pdfData=await saved();assert.equal(pdfData.pages[2].original.rotation_degrees,90);assert.equal(pdfData.pages[2].original.unit,'pt');close(pdfData.pages[2].comments[0].region,{x:.16,y:.17,width:.34,height:.33},.005);assert.deepEqual(pdfData.pages[0],before.pages[0]);pass('new drafts and rotated PDF share resize behavior, retain PDF units/rotation and image comment mapping');
  // Record a local fixture so this resize test does not depend on another suite's files.
  const recording=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.fillStyle='#528879';ctx.fillRect(0,0,640,360);
    const stream=canvas.captureStream(20),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();await new Promise(resolve=>setTimeout(resolve,600));recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  const video=Buffer.from(recording),infoId=Buffer.from([0x15,0x49,0xa9,0x66]);let at=0;
  while((at=video.indexOf(infoId,at))>=0){if(video[at-3]!==0x53||video[at-2]!==0xab||video[at-1]!==0x84)break;at+=4;}
  assert.ok(at>=0);const duration=video.indexOf(Buffer.from([0x44,0x89]),at+4);assert.ok(duration>=0&&duration<at+80);
  if(video[duration+2]===0x84)video.writeFloatBE(1000,duration+3);else if(video[duration+2]===0x88)video.writeDoubleBE(1000,duration+3);else throw Error('Unexpected duration encoding');
  await page.locator('#file-input').setInputFiles({name:'resize.webm',mimeType:'video/webm',buffer:video});await page.locator('#loading').waitFor({state:'hidden'});await page.locator('.page-item').last().click();await page.locator('#stage').waitFor({state:'visible'});
  await page.locator('#video-seek').evaluate(el=>{el.value=.2;el.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>!document.querySelector('#video').seeking&&Math.abs(document.querySelector('#video').currentTime-.2)<.025);
  await select({x:.2,y:.2},{x:.5,y:.5});await save('Video resize time stays');const videoBefore=await saved();await edit();const videoRegion=await draft();await resize('ne',.04,-.03);await save();const videoAfter=await saved();const oldVideo=videoBefore.pages[3].comments[0],newVideo=videoAfter.pages[3].comments[0];
  assert.equal(oldVideo.time_seconds,.2);assert.equal(newVideo.time_seconds,oldVideo.time_seconds);assert.equal(newVideo.comment_id,oldVideo.comment_id);assert.equal(newVideo.comment,oldVideo.comment);close(newVideo.region,expected(videoRegion,'ne',.04,-.03),.004);assert.ok(await page.locator('#video').evaluate(v=>v.paused));assert.deepEqual(videoAfter.pages.slice(0,3),videoBefore.pages.slice(0,3));pass('saved video resize preserves its timestamp, text and ID while paused; unrelated image/PDF entries stay unchanged');
  await writeFile(output+'/video-export.json',JSON.stringify(videoAfter,null,2));
  await page.locator('.page-item').first().click();await page.locator('#stage').waitFor({state:'visible'});await edit();const noChange=await draft();await page.locator('#cancel-edit').click();assert.ok(await page.locator('#unsaved-dialog').isHidden());pass('opening an existing comment without changes still closes without a save prompt');
  await page.setViewportSize({width:390,height:844});await page.locator('#fit').click();await edit();await page.locator('.region-handle.se').scrollIntoViewIfNeeded();const mobileBefore=await draft();await resize('se',.06,.04);close(await draft(),expected(mobileBefore,'se',.06,.04),.015);await page.screenshot({path:output+'/mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await discard();pass('mobile layout keeps all four handles and supports resize without horizontal page overflow');
  const touchContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),touchPage=await touchContext.newPage();
  touchPage.on('pageerror',e=>errors.push(e.message));touchPage.on('request',r=>requests.push({url:r.url(),method:r.method(),body:r.postData()}));touchPage.on('dialog',d=>d.accept());
  await touchPage.goto('http://127.0.0.1:4173/');await touchPage.locator('#file-input').setInputFiles({name:'touch.png',mimeType:'image/png',buffer:image});await touchPage.locator('#loading').waitFor({state:'hidden'});await touchPage.locator('#stage').waitFor({state:'visible'});
  const cdp=await touchContext.newCDPSession(touchPage),touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:7}]});
  await touchPage.locator('#overlay').scrollIntoViewIfNeeded();let tb=await touchPage.locator('#overlay').boundingBox();await touch('touchStart',tb.x+tb.width*.2,tb.y+tb.height*.2);await touch('touchMove',tb.x+tb.width*.5,tb.y+tb.height*.5);await touch('touchEnd');await touchPage.locator('#comment-text').fill('Touch resize');await touchPage.locator('#editor button[type=submit]').click();await touchPage.locator('.comment-open').click();
  const touchRegion=()=>touchPage.locator('.region.active').evaluate(el=>Object.fromEntries(['left','top','width','height'].map((k,i)=>[['x','y','width','height'][i],parseFloat(el.style[k])/100])));
  const tr=await touchRegion();await touchPage.locator('.region-handle.se').scrollIntoViewIfNeeded();let hb=await touchPage.locator('.region-handle.se').boundingBox();tb=await touchPage.locator('#overlay').boundingBox();assert.equal(hb.width,24);let tx=hb.x+hb.width/2,ty=hb.y+hb.height/2;await touch('touchStart',tx,ty);await touch('touchMove',tx+tb.width*.1,ty+tb.height*.08);await touch('touchEnd');close(await touchRegion(),expected(tr,'se',.1,.08),.01);
  const tc=await touchRegion();await touchPage.locator('.region-handle.nw').scrollIntoViewIfNeeded();hb=await touchPage.locator('.region-handle.nw').boundingBox();tb=await touchPage.locator('#overlay').boundingBox();tx=hb.x+hb.width/2;ty=hb.y+hb.height/2;await touch('touchStart',tx,ty);await touch('touchMove',tx-tb.width*.05,ty-tb.height*.05);await touch('touchCancel');close(await touchRegion(),tc,.001);await touchPage.screenshot({path:output+'/touch-mobile.png',fullPage:true});await touchContext.close();pass('emulated touch pointer resizes using 24px corner targets; native touchCancel restores the previous draft');
  assert.deepEqual(errors,[]);const http=requests.filter(r=>/^https?:/.test(r.url));assert.ok(http.every(r=>r.method==='GET'&&!r.body&&new URL(r.url).origin==='http://127.0.0.1:4173'));pass('no browser runtime errors or external/upload requests');
  await writeFile(output+'/report.json',JSON.stringify({results,errors,requestCount:requests.length},null,2));await writeFile(output+'/network.json',JSON.stringify(requests,null,2));
} catch(error) {await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});await writeFile(output+'/failure.json',JSON.stringify({results,errors,error:error.stack},null,2));throw error;}
finally {await context.close();await browser.close();}
