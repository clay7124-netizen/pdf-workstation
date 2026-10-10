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
/** Inject an EXIF Orientation tag into a landscape JPEG, as produced by iPhones.
 * The JPEG pixels remain 160×80; Orientation=6 means viewers should show them 80×160.
 */
function jpegWithOrientation(jpeg, orientation) {
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  const exif = Buffer.alloc(6+8+2+12+4);
  exif.write('Exif', 0, 'ascii');
  exif.write('II', 6, 'ascii');
  exif.writeUInt16LE(42, 8);
  exif.writeUInt32LE(8, 10);
  exif.writeUInt16LE(1, 14);
  exif.writeUInt16LE(0x0112, 16);
  exif.writeUInt16LE(3, 18);
  exif.writeUInt32LE(1, 20);
  exif.writeUInt16LE(orientation, 24);
  exif.writeUInt32LE(0, 28);
  const marker = Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]);
  return Buffer.concat([jpeg.subarray(0,2), marker, exif, jpeg.subarray(2)]);
}

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

  // A landscape JPEG where the orientation metadata tells iOS to display it portrait.
  // In the old implementation the preview was portrait but the exported PDF was landscape.
  const jpeg = await page.evaluate(() => {
    const c=document.createElement('canvas'); c.width=160; c.height=80;
    const ctx=c.getContext('2d'); ctx.fillStyle='#dd2626';ctx.fillRect(0,0,80,80);
    ctx.fillStyle='#2464d8';ctx.fillRect(80,0,80,80);
    return c.toDataURL('image/jpeg',0.98).split(',')[1];
  });
  const exifFile={name:'iphone-exif-orientation-6.jpg',mimeType:'image/jpeg',
    buffer:jpegWithOrientation(Buffer.from(jpeg,'base64'),6)};
  await page.locator('[data-tool="images"]').click();
  await page.locator('#toolInput').setInputFiles([exifFile]);
  await page.waitForFunction(() => {
    const c=document.querySelector('.image-preview-canvas');
    // <canvas> defaults to 300×150 before the async image has rendered.
    // Wait for the canvas to be painted before checking the orientation.
    return c && c.width>0 && c.height>0 && (c.width!==300 || c.height!==150);
  });
  const preview = await page.locator('.image-preview-canvas').evaluate(c=>({w:c.width,h:c.height}));
  assert.ok(preview.h>preview.w,'EXIF 6 JPG should display portrait in the preview');
  const pdf0 = await downloadResult(1);
  assert.ok(pdf0.getPage(0).getSize().height>pdf0.getPage(0).getSize().width,
    'EXIF 6 JPG without manual rotation should export portrait, matching preview');
  note('EXIF 6：預覽直式，0° 匯出保持直式');
  await page.locator('[data-imgrotate="0,90"]').click();
  await page.waitForFunction(()=>document.querySelector('.image-preview-canvas')?.width >
    document.querySelector('.image-preview-canvas')?.height);
  const pdf90 = await downloadResult(1);
  assert.ok(pdf90.getPage(0).getSize().width>pdf90.getPage(0).getSize().height,
    'EXIF 6 JPG with manual +90 rotation should export landscape, matching preview');
  note('EXIF 6：手動旋轉 90° 後預覽與匯出均為橫式');
  await page.locator('#backBtn').click();

  await page.locator('[data-tool="edit"]').click();
  await page.locator('#toolInput').setInputFiles(pdfFiles.slice(0,1));
  await page.locator('#pdfZoomToolbar').waitFor();
  const canvasBefore=await page.locator('#pageCanvas').evaluate(c=>c.width);
  await page.locator('#pdfZoomSlider').evaluate(el=>{
    el.value='200'; el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(previous=>document.querySelector('#pageCanvas')?.width>=previous*1.95,canvasBefore,{timeout:30000});
  assert.equal(await page.locator('#pdfZoomValue').innerText(),'200%');
  const pageSize=await page.locator('#pageWrap').evaluate(el=>el.getBoundingClientRect().width);
  assert.ok(pageSize>500,'zoom should enlarge actual PDF preview');
  await page.locator('#pdfZoomFit').click();
  await page.waitForFunction(previous=>document.querySelector('#pageCanvas')?.width<=previous*1.1,canvasBefore,{timeout:30000});
  assert.equal(await page.locator('#pdfZoomValue').innerText(),'100%');
  note('PDF 文件滑桿放大 200%、縮回 100% 且畫布同步更新');
  const pinchTest=await page.evaluate(async()=>{
    const viewer=document.querySelector('.viewer-box');
    const t=(id,x,y)=>new Touch({identifier:id,target:viewer,clientX:x,clientY:y,pageX:x,pageY:y,screenX:x,screenY:y});
    const p1=t(1,95,240),p2=t(2,175,240),q2=t(2,255,240);
    const emit=(kind,touches,changed)=>viewer.dispatchEvent(new TouchEvent(kind,{
      bubbles:true,cancelable:true,touches,targetTouches:touches,changedTouches:changed}));
    emit('touchstart',[p1,p2],[p1,p2]);
    emit('touchmove',[p1,q2],[q2]);
    emit('touchend',[],[p1,q2]);
    await new Promise(r=>setTimeout(r,300));
    return {zoom:app.zoom,label:document.querySelector('#pdfZoomValue')?.textContent};
  });
  assert.ok(pinchTest.zoom>1.3,'two finger pinch should zoom in');
  assert.match(pinchTest.label,/\d+%/);
  await page.locator('#pdfZoomFit').click();
  note('雙指放大手勢可控制文件縮放');
  await page.locator('[data-edit="text"]').click();
  await page.locator('#quickTextModal:not(.hidden)').waitFor();
  await page.locator('#quickTextArea').fill('Hello revised');
  await page.locator('#quickTextDone').click();
  await page.locator('.annotation').filter({hasText:'Hello revised'}).waitFor();
  await page.locator('#txtBody').fill('Updated by textarea');
  await page.locator('.annotation').filter({hasText:'Updated by textarea'}).waitFor();
  // Verify the font selector actually exposes Traditional Chinese presets.
  assert.equal(await page.locator('#txtFont option').count(),5);
  assert.equal(await page.locator('#txtFont').inputValue(),'NotoSansTC');
  await page.locator('#sampleNeighborFont').click();
  await page.waitForFunction(()=>document.querySelector('#neighborStyleNote')?.textContent?.includes('原文字型'));
  note('取樣附近原文字號與字型提示');
  await page.locator('#txtFont').selectOption('NotoSerifTC');
  await page.locator('#fontLivePreview').waitFor();
  assert.match(await page.locator('#fontLiveSample').getAttribute('style'),/PdfNotoSerifTC/);
  await page.locator('#txtBody').fill('思源宋體格式測試');
  assert.equal(await page.locator('#txtSize').getAttribute('type'),'range');
  await page.locator('#txtSize').evaluate(el=>{
    el.value='24';el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  assert.equal(await page.locator('#fontSizeOutput').innerText(),'24 pt');
  await page.locator('#fontSizePlus').click();
  assert.equal(await page.locator('#fontSizeOutput').innerText(),'25 pt');
  await page.locator('#fontSizeMinus').click();
  assert.equal(await page.locator('#fontSizeOutput').innerText(),'24 pt');
  await page.locator('#txtColor').fill('#1367a2');
  await page.locator('#txtColor').dispatchEvent('change');
  const firstStyle=await page.evaluate(()=>{
    const x=app.ann.find(a=>a.kind==='text');
    return {font:x.font,size:x.size,color:x.color,weight:x.weight};
  });
  assert.equal(firstStyle.font,'NotoSerifTC');
  await page.locator('[data-edit="text"]').click();
  await page.locator('#quickTextArea').fill('第二段新增文字');
  await page.locator('#quickTextDone').click();
  const n=await page.evaluate(()=>app.ann.filter(a=>a.kind==='text').length);
  assert.equal(n,2);
  // Make the first annotation the format source, then paint the second through its UI.
  await page.evaluate(()=>{
    app.selected=app.ann[0].id;
    editorProperties();
    renderAnnotations();
  });
  await page.locator('[data-edit="paint"]').click();
  await page.locator('#formatBrushGuide:not(.hidden)').waitFor();
  await page.locator('.annotation').last().dispatchEvent('pointerdown',{
    pointerId:1,pointerType:'mouse',clientX:100,clientY:100,bubbles:true
  });
  const secondStyle=await page.evaluate(()=>{
    const a=app.ann.filter(a=>a.kind==='text')[1];
    return {font:a.font,size:a.size,color:a.color,weight:a.weight};
  });
  assert.deepEqual(secondStyle,firstStyle);
  note('免費繁體中文字型切換、格式刷套用字號與顏色');
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
