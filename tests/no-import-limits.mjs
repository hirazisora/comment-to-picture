import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),dependency=n=>require(process.env.TEST_MODULES?process.env.TEST_MODULES+'/'+n:n);
const {chromium}=dependency('playwright'),{PNG}=dependency('pngjs'),{PDFDocument}=dependency('pdf-lib');
const crc=dependency('pngjs/lib/crc.js');
const MiB=1024*1024,out='test-results';await mkdir(out,{recursive:true});
const png=new PNG({width:160,height:90});png.data.fill(255);const image=PNG.sync.write(png);
// A real PNG with a valid, unused ancillary chunk: large file, small decoded dimensions.
const chunk=Buffer.alloc(56*MiB);chunk.writeUInt32BE(chunk.length-12);chunk.write('npAD',4);chunk.writeInt32BE(crc.crc32(chunk.subarray(4,-4)),chunk.length-4);
const largeImage=Buffer.concat([image.subarray(0,-12),chunk,image.subarray(-12)]);
await writeFile(out+'/large-valid.png',largeImage);
const pdf=await PDFDocument.create();for(let i=0;i<101;i++)pdf.addPage([160,90]);await writeFile(out+'/101-valid-pages.pdf',await pdf.save());
const largePdf=await PDFDocument.create();largePdf.addPage([160,90]);largePdf.context.register(largePdf.context.stream(new Uint8Array(52*MiB)));
await writeFile(out+'/large-valid.pdf',await largePdf.save({useObjectStreams:false}));
const smallVideo=await readFile(out+'/self-made.webm');
// EBML Void padding leaves the recorded video playable without generating long footage.
const padding=Buffer.alloc(56*MiB);padding[0]=0xec;padding.writeBigUInt64BE(0x0100000000000000n|BigInt(padding.length-9),1);
await writeFile(out+'/large-valid.webm',Buffer.concat([smallVideo,padding]));
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
const page=await context.newPage(),results=[],requests=[],errors=[];
page.on('request',r=>requests.push({url:r.url(),method:r.method(),body:r.postData()}));page.on('pageerror',e=>errors.push(e.message));
const pass=s=>{results.push(s);console.log('PASS '+s);};
const settle=async()=>page.locator('#loading').waitFor({state:'hidden',timeout:60000});
const count=async n=>assert.equal(await page.locator('.page-item').count(),n);
const picker=async files=>{await page.locator('#file-input').setInputFiles(files);await settle();};
const incoming=async(path,event='drop')=>{
  await page.locator('#test-fixture-input').setInputFiles(path);
  await page.evaluate(event=>{const data=new DataTransfer();for(const f of document.querySelector('#test-fixture-input').files)data.items.add(f);const e=event==='paste'?new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true});document.body.dispatchEvent(e);},event);await settle();
};
const copy=async()=>{await page.locator('#copy-json').click();await page.locator('#copy-success-dialog').waitFor({state:'visible'});const json=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));await page.locator('#close-copy-success').click();return json;};
const clear=async()=>{await page.locator('#clear-all').click();await page.locator('#confirm-delete').click();await page.waitForFunction(()=>!document.querySelector('#add-files').disabled&&!document.querySelector('.page-item'));};
try {
  await page.goto('http://127.0.0.1:4173/');
  assert.ok(!/50MB|150MB|100項目|6時間/.test(await page.locator('#empty-state').innerText()));
  await page.evaluate(()=>{
    const input=document.createElement('input');input.type='file';input.id='test-fixture-input';input.multiple=true;input.hidden=true;document.body.append(input);
    window.memoryReads=[];window.hashCalls=0;window.blobUrls=[];window.revokedUrls=[];
    const arrayBuffer=Blob.prototype.arrayBuffer,read=FileReader.prototype.readAsArrayBuffer,create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    Blob.prototype.arrayBuffer=function(){if(this instanceof File){window.memoryReads.push({method:'arrayBuffer',name:this.name,size:this.size});throw Error('App must not read entire File through arrayBuffer');}return arrayBuffer.call(this);};
    FileReader.prototype.readAsArrayBuffer=function(file){window.memoryReads.push({method:'FileReader',name:file.name,size:file.size});if(file.type!=='application/pdf')throw Error('Only PDF rendering needs a full byte read');return read.call(this,file);};
    crypto.subtle.digest=()=>{window.hashCalls++;throw Error('Duplicate hashing must be removed');};
    URL.createObjectURL=blob=>{const url=create(blob);if(blob instanceof File)window.blobUrls.push(url);return url;};URL.revokeObjectURL=url=>{window.revokedUrls.push(url);revoke(url);};
  });pass('removed limit text; whole-file reads and hash calls are instrumented');
  await picker(out+'/large-valid.png');await count(1);await page.locator('#stage').waitFor({state:'visible'});assert.equal(await page.locator('#canvas').evaluate(c=>c.width),160);
  await incoming(out+'/large-valid.png');await count(2);await incoming(out+'/large-valid.png','paste');await count(3);
  let json=await copy();assert.ok(json.files.every(f=>f.size_bytes>50*MiB));assert.ok(json.files.reduce((n,f)=>n+f.size_bytes,0)>150*MiB);assert.equal(new Set(json.files.map(f=>f.file_id)).size,3);
  assert.equal(await page.evaluate(()=>window.memoryReads.length),0);assert.equal(await page.evaluate(()=>window.hashCalls),0);
  pass('actual 56MiB PNG works through picker/drop/paste; identical imports total over 168MiB with distinct IDs and zero whole-file reads');
  await picker(out+'/large-valid.webm');await count(4);await page.locator('.page-item').last().click();await page.locator('#stage').waitFor({state:'visible'});await page.locator('#video-toggle').click();await page.waitForFunction(()=>document.querySelector('#video').currentTime>.1);await page.locator('#video-toggle').click();
  await incoming(out+'/large-valid.webm');await count(5);assert.equal(await page.evaluate(()=>window.memoryReads.length),0);pass('actual 56MiB WebM loads, plays, pauses and re-adds by drop without whole-file reads');
  await picker(out+'/large-valid.pdf');await count(6);await page.locator('.page-item').last().click();await page.locator('#stage').waitFor({state:'visible'});assert.ok(await page.locator('#canvas').evaluate(c=>c.width>0&&c.height>0));assert.equal((await copy()).pages.at(-1).original.width,160);
  await incoming(out+'/large-valid.pdf');await count(7);const reads=await page.evaluate(()=>window.memoryReads);assert.equal(reads.length,2);assert.ok(reads.every(r=>r.method==='FileReader'&&r.size>50*MiB));
  json=await copy();const total=json.files.reduce((n,f)=>n+f.size_bytes,0);assert.ok(total>380*MiB);pass('actual 52MiB PDF renders and re-adds by drop; only PDF parsing reads bytes; mixed collection exceeds 380MiB');
  const downloadPromise=page.waitForEvent('download');await page.locator('#download-json').click();const download=await downloadPromise;await download.saveAs(out+'/no-limits-export.json');assert.deepEqual(JSON.parse(await readFile(out+'/no-limits-export.json','utf8')),json);
  assert.ok(!/fingerprint|base64|blob:/.test(JSON.stringify(json)));pass('clipboard/download JSON agree for large repeated files without binary data or fingerprints');
  await clear();assert.ok(await page.evaluate(()=>window.blobUrls.every(url=>window.revokedUrls.includes(url))));pass('clear releases all large image/video source URLs');
  await picker(out+'/101-valid-pages.pdf');await count(101);await page.locator('.page-item').last().click();await page.locator('#stage').waitFor({state:'visible'});json=await copy();assert.equal(json.files[0].page_count,101);assert.equal(json.pages.at(-1).page_number,101);
  await incoming(out+'/101-valid-pages.pdf');await count(202);json=await copy();assert.equal(json.files.length,2);assert.notEqual(json.files[0].file_id,json.files[1].file_id);pass('101-page PDF renders its last page; identical PDF drop produces 202 pages without the old cap');
  await clear();
  await page.evaluate(bytes=>{const data=new DataTransfer();for(let i=0;i<105;i++)data.items.add(new File([new Uint8Array(bytes)],'same.png',{type:'image/png'}));document.body.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));},Array.from(image));await settle();await count(105);await page.locator('.page-item').last().click();await page.locator('#stage').waitFor({state:'visible'});json=await copy();assert.equal(json.files.length,105);assert.equal(new Set(json.files.map(f=>f.file_id)).size,105);pass('105 identical image files in one drop create 105 independent items and export successfully');
  await clear();
  await page.evaluate(bytes=>{const data=new DataTransfer();for(let i=0;i<105;i++)data.items.add(new File([new Uint8Array(bytes)],'same.webm',{type:'video/webm'}));document.body.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));},Array.from(smallVideo));await settle();await count(105);await page.locator('.page-item').last().click();await page.locator('#stage').waitFor({state:'visible'});json=await copy();assert.equal(json.files.length,105);assert.ok(json.files.every(f=>f.type==='video'));assert.equal(new Set(json.files.map(f=>f.file_id)).size,105);pass('105 identical videos in one drop create independent playable items without whole-file reads');
  await clear();
  await page.evaluate(()=>{
    window.originalPdfRead=FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer=function(file){window.pendingPdfReader=this;};
    const abort=FileReader.prototype.abort;window.originalPdfAbort=abort;
    FileReader.prototype.abort=function(){if(this===window.pendingPdfReader)this.dispatchEvent(new ProgressEvent('abort'));else abort.call(this);};
  });await page.locator('#file-input').setInputFiles(out+'/large-valid.pdf');await page.waitForFunction(()=>!!window.pendingPdfReader);await page.locator('#cancel-import').click();await settle();await count(0);
  pass('cancelling while PDF byte reading is pending retains a usable empty state');
  await page.clock.install();await page.evaluate(()=>{window.pendingPdfReader=null;});await page.locator('#file-input').setInputFiles(out+'/large-valid.pdf');await page.waitForFunction(()=>!!window.pendingPdfReader);await page.clock.fastForward(31000);await settle();await count(0);assert.match(await page.locator('#status').innerText(),/読み込み時間が上限/);
  await page.evaluate(()=>{FileReader.prototype.readAsArrayBuffer=window.originalPdfRead;FileReader.prototype.abort=window.originalPdfAbort;});pass('stalled PDF byte reading times out and aborts without leaving import controls busy');
  assert.equal(await page.evaluate(()=>window.hashCalls),0);assert.ok(await page.evaluate(()=>window.memoryReads.every(r=>r.method==='FileReader'&&r.name.endsWith('.pdf'))));
  const http=requests.filter(r=>/^https?:/.test(r.url));assert.ok(http.every(r=>r.method==='GET'&&!r.body&&new URL(r.url).origin==='http://127.0.0.1:4173'));assert.deepEqual(errors,[]);pass('all cases use local processing with no uploaded bodies, external requests or runtime errors');
  await writeFile(out+'/no-import-limits-report.json',JSON.stringify({checkedAt:new Date().toISOString(),results,fixtureSizes:{image:largeImage.length,video:smallVideo.length+padding.length,pdf:reads[0].size},mixedTotalBytes:total,hashCalls:0,readPolicy:'PDF FileReader only; File.arrayBuffer forbidden',maximumObservedItems:202,uploadedBodies:0,errors},null,2));await writeFile(out+'/no-import-limits-network.json',JSON.stringify(requests,null,2));
}finally{await context.close();await browser.close();}
