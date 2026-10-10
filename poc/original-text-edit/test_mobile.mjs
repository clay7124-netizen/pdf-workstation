import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser=await chromium.launch({
  channel:'chrome',
  headless:true,
  args:['--no-sandbox'],
});
const page=await browser.newPage({
  viewport:{width:390,height:844},
  deviceScaleFactor:2,
  isMobile:true,hasTouch:true,
  acceptDownloads:true,
});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(40000);
const note=s=>console.log('PASS '+s);
try {
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  await page.locator('#pdfFile').setInputFiles('poc/original-text-edit/results/sample_cjk.pdf');
  await page.waitForFunction(()=>document.getElementById('pageNumber')?.textContent?.includes('1 / 1'),null,{timeout:40000});
  await page.waitForFunction(()=>document.querySelectorAll('.hit').length>=3);
  assert.ok(await page.locator('#pageCanvas').evaluate(el=>el.width>0 && el.height>0));
  note('手機尺寸 PDF 顯示與原文字選取層');

  const hit=page.locator('.hit[aria-label*="設備狀態"]').first();
  await hit.click({force:true});
  assert.match(await page.locator('#original').inputValue(),/設備狀態：正常/);
  await page.locator('#original').fill('正常');
  await page.locator('#replacement').fill('異常');
  await page.locator('#check').click();
  await page.waitForFunction(()=>document.getElementById('status')?.textContent?.includes('可在保持現有內嵌字型'));
  assert.equal(await page.locator('#apply').isEnabled(),true);
  note('點選原文 → 修改文字 → 字型安全預檢');

  const download=page.waitForEvent('download');
  await page.locator('#apply').click();
  const pdf=await download;
  assert.equal(pdf.suggestedFilename(),'sample_cjk_edited.pdf');
  const bytes=await readFile(await pdf.path());
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  assert.ok(bytes.length>1000);
  assert.match(await page.locator('#status').innerText(),/原文件保持不變/);
  note('實際另存有效 PDF');

  await page.locator('#replacement').fill('風險');
  await page.locator('#check').click();
  await page.waitForFunction(()=>document.getElementById('status')?.textContent?.includes('原始 PDF 內嵌字型沒有'));
  assert.equal(await page.locator('#apply').isDisabled(),true);
  note('手機畫面缺字正確拒絕修改');

  const slider=page.locator('#scale');
  await slider.fill('180');
  await page.waitForFunction(()=>document.getElementById('zoomLabel')?.textContent==='180%');
  note('手機預覽滑桿縮放');

  assert.deepEqual(errors,[],'browser JS errors');
  console.log('ALL LOCAL MOBILE UI TESTS PASSED');
} finally {
  await browser.close();
}
