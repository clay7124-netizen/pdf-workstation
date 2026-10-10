import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {PDFDocument,StandardFonts} from 'pdf-lib';

async function sample(label, count) {
  const d=await PDFDocument.create();
  const font=await d.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=count;i++){
    const p=d.addPage([400,600]);
    p.drawText(label+' page '+i,{x:35,y:520,size:23,font});
  }
  return Buffer.from(await d.save());
}
const fixtureA=await sample('Example A',2);
const fixtureB=await sample('Example B',1);
const pdfFiles=[
  {name:'first.pdf',mimeType:'application/pdf',buffer:fixtureA},
  {name:'second.pdf',mimeType:'application/pdf',buffer:fixtureB},
];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,acceptDownloads:true});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error') console.log('Browser console:',m.text());});
page.setDefaultTimeout(25000);
function note(s){console.log('PASS '+s)}
async function downloadResult(expectedPages){
  await page.locator('#actionBtn').click();
  await page.locator('#resultModal:not(.hidden)').waitFor({timeout:30000});
  const download=page.waitForEvent('download');
  await page.locator('#downloadBtn').click();
  const file=await download;
  const bytes=await readFile(await file.path());
  const d=await PDFDocument.load(bytes);
  assert.equal(d.getPageCount(),expectedPages);
  await page.locator('#closeResult').click();
  return d;
}
try{
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'load',timeout:35000});
  await page.locator('text=PDF 工作台').first().waitFor();
  assert.equal(await page.locator('script[src^="enhancements.js"]').count(),1);
  note('首頁與 v0.3 插件載入');

  await page.locator('[data-tool="merge"]').click();
  await page.locator('#toolInput').setInputFiles(pdfFiles);
  await page.locator('.merge-preview-canvas').first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.merge-counter')].length===2 && [...document.querySelectorAll('.merge-counter')].every(c=>/第\s*\d+\s*\/\s*\d+\s*頁/.test(c.textContent)),null,{timeout:30000});
  assert.match(await page.locator('.merge-counter').first().innerText(),/1\s*\/\s*2/);
  await page.locator('[data-mergenav="0,1"]').click();
  await page.waitForFunction(()=>document.querySelector('.merge-counter')?.textContent?.includes('2 / 2'));
  await page.locator('[data-zoom="0"]').click();
  await page.locator('#pdfZoomModal:not(.hidden)').waitFor();
  await page.locator('#closePdfZoom').click();
  note('合併 PDF：預覽、逐頁切換、放大視窗');
  await downloadResult(3);
  note('合併輸出 3 頁有效 PDF');
  await page.locator('#backBtn').click();

  const png = await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=140;c.height=70;
    const x=c.getContext('2d');x.fillStyle='rgb(30,100,175)';x.fillRect(0,0,140,70);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('[data-tool="images"]').click();
  await page.locator('#toolInput').setInputFiles([{name:'wide.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')}]);
  await page.locator('[data-imgrotate="0,90"]').click();
  assert.equal(await page.locator('.image-angle').innerText(),'90°');
  const d=await downloadResult(1);
  assert.ok(d.getPage(0).getSize().height>d.getPage(0).getSize().width,'旋轉 90 度後應為直式頁面');
  note('圖片旋轉 90 度且輸出 PDF 確實變成直向');
  await page.locator('#backBtn').click();

  await page.locator('[data-tool="edit"]').click();
  await page.locator('#toolInput').setInputFiles(pdfFiles.slice(0,1));
  await page.locator('[data-edit="text"]').click();
  await page.locator('#quickTextModal:not(.hidden)').waitFor();
  await page.locator('#quickTextArea').fill('Hello revised');
  await page.locator('#quickTextDone').click();
  await page.locator('.annotation').filter({hasText:'Hello revised'}).waitFor();
  await page.locator('#txtBody').fill('Updated by textarea');
  await page.locator('.annotation').filter({hasText:'Updated by textarea'}).waitFor();
  await page.locator('#inspectOriginalBtn').click();
  await page.locator('#originalInspector:not(.hidden)').waitFor();
  await page.waitForFunction(()=>document.querySelector('#inspectorResult')?.textContent?.includes('範例：'));
  await page.locator('#closeInspector').click();
  note('新增文字視窗、即時修改、原文字型唯讀分析');
  await downloadResult(2);
  note('編輯 PDF 輸出有效 PDF');

  assert.deepEqual(errors,[],'Browser page errors');
  console.log('ALL SMOKE TESTS PASSED');
}finally{await browser.close();}
