import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const dependency=name=>require(process.env.TEST_MODULES?process.env.TEST_MODULES+'/'+name:name);
const {chromium}=dependency('playwright'),{PNG}=dependency('pngjs');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();
await mkdir('test-results',{recursive:true});
const base=process.env.TEST_URL||'http://127.0.0.1:4173/';
const baseline=process.env.TEST_BASELINE==='1';
const png=new PNG({width:1897,height:905});png.data.fill(255);
try {
  await page.goto(base);
  await page.locator('#file-input').setInputFiles({name:'regression.png',mimeType:'image/png',buffer:PNG.sync.write(png)});
  await page.locator('#stage').waitFor({state:'visible'});
  if(baseline) {
    await page.locator('#keyboard-region').click();
    await page.locator('#region-x').fill('88.13');await page.locator('#region-width').fill('10');
    await page.locator('#comment-text').fill('click save regression');
    await page.locator('#editor button[type=submit]').click();
    assert.ok(await page.locator('#editor').isVisible());
    assert.equal(await page.locator('.comment-card').count(),0);
    assert.equal(await page.locator('#region-x').evaluate(el=>el.validity.stepMismatch),true);
    await page.locator('#comment-text').press('Control+Enter');
    await page.locator('#editor').waitFor({state:'hidden'});
    assert.equal(await page.locator('.comment-card').count(),1);
    console.log('REPRODUCED: X=88.13 blocks click save (stepMismatch), Ctrl+Enter saves');
    await writeFile('test-results/save-baseline.json',JSON.stringify({reproduced:true,x:88.13,clickSaved:false,shortcutSaved:true,reason:'number input step=0.1 triggers native form stepMismatch'},null,2));
  } else {
    const box=await page.locator('#overlay').boundingBox();
    await page.mouse.move(box.x+box.width*.8813,box.y+box.height*.182);
    await page.mouse.down();await page.mouse.move(box.x+box.width*.975,box.y+box.height*.45);await page.mouse.up();
    assert.equal(await page.locator('#editor input[type=number]').count(),0);
    const clickText='  click save regression\n';await page.locator('#comment-text').fill(clickText);
    await page.locator('#editor button[type=submit]').click();await page.locator('#editor').waitFor({state:'hidden'});
    await page.locator('#copy-json').click();await page.locator('#copy-success-dialog').waitFor({state:'visible'});await page.locator('#close-copy-success').click();const first=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
    const before=first.pages[0].comments[0].region;
    assert.equal(first.pages[0].comments[0].comment,clickText);
    assert.ok(Math.abs(before.x-.8813)<.002);
    const shortcutText='  shortcut save regression\n';await page.locator('.comment-open').click();await page.locator('#comment-text').fill(shortcutText);
    await page.locator('#comment-text').press('Control+Enter');await page.locator('#editor').waitFor({state:'hidden'});
    await page.locator('#copy-json').click();await page.locator('#copy-success-dialog').waitFor({state:'visible'});await page.locator('#close-copy-success').click();const second=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
    assert.deepEqual(second.pages[0].comments[0].region,before);
    assert.equal(second.pages[0].comments[0].comment,shortcutText);
    await page.locator('.comment-open').click();await page.locator('#comment-text').fill('cancelled edit');await page.locator('#cancel-edit').click();await page.locator('#draft-discard').click();
    await page.locator('.comment-open').click();assert.equal(await page.locator('#comment-text').inputValue(),shortcutText);await page.locator('#cancel-edit').click();
    const blankBox=await page.locator('#overlay').boundingBox();await page.mouse.move(blankBox.x+blankBox.width*.05,blankBox.y+blankBox.height*.05);await page.mouse.down();await page.mouse.move(blankBox.x+blankBox.width*.15,blankBox.y+blankBox.height*.15);await page.mouse.up();await page.locator('#editor button[type=submit]').click();assert.ok(await page.locator('#editor').isVisible());assert.match(await page.locator('#editor-error').innerText(),/コメントを入力/);
    await page.locator('#comment-text').press('Control+Enter');assert.ok(await page.locator('#editor').isVisible());assert.match(await page.locator('#editor-error').innerText(),/コメントを入力/);
    console.log('PASS: fractional region saves by click and Ctrl+Enter; coordinates preserved through re-edit; cancel restores saved text; both paths validate blank comments');
    await writeFile('test-results/save-regression.json',JSON.stringify({passed:true,region:before,clickSaved:true,shortcutSaved:true,coordinatesPreserved:true,cancelRestoresSavedText:true,blankValidatedBothPaths:true,commentWhitespacePreserved:true},null,2));
  }
} finally {await context.close();await browser.close();}
