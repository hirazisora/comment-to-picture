import test from 'node:test';import assert from 'node:assert/strict';
import {rectangle,validRegion,exportDocument} from '../src/model.mjs';
test('reverse drag, clamp, and zero-size validation',()=>{assert.deepEqual(rectangle({x:1.2,y:.8},{x:-.2,y:.2}),{x:0,y:.2,width:1,height:.6000000000000001});assert.equal(validRegion({x:.9,y:0,width:.2,height:.5}),false);assert.equal(validRegion({x:0,y:0,width:0,height:1}),false);assert.equal(validRegion({x:NaN,y:0,width:1,height:1}),false);});
test('JSON separates same-name files, preserves rotated PDF units, excludes binaries',()=>{const files=[{id:'a',name:'same.pdf',type:'pdf',size:10,pageCount:2,document:{secret:'binary'}}];const pages=[{id:'p',sourceId:'a',name:'same.pdf',number:2,width:600,height:800,unit:'pt',rotation:90,url:'blob:secret',comments:[{id:'c',region:{x:.123456789,y:.25,width:.5,height:.5},text:'見出しを修正'}]}];const output=exportDocument(files,pages);assert.equal(output.pages[0].original.rotation_degrees,90);assert.equal(output.pages[0].comments[0].region.x,.123457);assert.equal(output.pages[0].page_number,2);assert.equal(output.files[0].file_id,'a');assert.ok(!JSON.stringify(output).includes('secret'));assert.equal(output.coordinate_system.units,'normalized_0_to_1');});
test('instructions identify originals without site context and preserve user comment verbatim',()=>{
  const comment='ヘッダーの余白を減らす。\n  このコメント原文は変更しない。';
  const output=exportDocument([{id:'f',name:'dashboard.png',type:'image',size:10,pageCount:1}],[{id:'p',sourceId:'f',name:'dashboard.png',number:1,width:1897,height:905,unit:'px',rotation:0,comments:[{id:'c',region:{x:.8813,y:.182,width:.1,height:.2},text:comment}]}]);
  const guidance=output.instructions_for_ai;assert.ok(!guidance.includes('UI screenshot'));
  for(const phrase of ['user feedback comments with specified locations','separately attached images or PDF','file_name and page_number (1-based)','not an external retrieval ID','do not guess','comment verbatim','top-left','fractions from 0 to 1','original.width','original.height','original.unit','rotation_degrees','Original image data is not included in this JSON','original files manually','If no images or PDF are attached, ask the user to attach the images or PDF used for these comments'])assert.ok(guidance.includes(phrase),phrase);
  assert.ok(!guidance.includes('request to modify the tool'));assert.ok(!guidance.includes('No original image binary is embedded'));assert.equal(guidance.match(/manually/g).length,1);assert.ok(guidance.indexOf('Original image data')<guidance.indexOf('Match each pages entry'));assert.ok(guidance.endsWith('respect original.rotation_degrees for PDFs.'));
  assert.equal(output.pages[0].comments[0].comment,comment);
  assert.equal(output.pages[0].file_name,'dashboard.png');assert.equal(output.pages[0].page_number,1);
  assert.equal(output.pages[0].original.width*output.pages[0].comments[0].region.x,1671.8261);
});
test('deleting PDF pages keeps original page numbers and excludes empty sources',()=>{
  const output=exportDocument([{id:'pdf',name:'source.pdf',type:'pdf',size:10,pageCount:3},{id:'empty',name:'deleted.png',type:'image',size:20,pageCount:1}],[{id:'p2',sourceId:'pdf',name:'source.pdf',number:2,width:600,height:800,unit:'pt',rotation:0,comments:[]}]);
  assert.equal(output.files.length,1);assert.equal(output.files[0].page_count,3);assert.equal(output.files[0].included_page_count,1);assert.deepEqual(output.files[0].included_page_numbers,[2]);assert.equal(output.pages[0].page_number,2);
});
