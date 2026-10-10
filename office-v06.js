/* Office PDF basic v0.6: local DOCX/XLSX -> selectable text PDF.
   Mammoth (BSD-2-Clause), ExcelJS (MIT), pdf-lib (MIT). */
(() => {
  'use strict';
  const state={file:null,kind:null,blocks:[],sheets:[],warnings:[],busy:false};
  const libs={};
  const modal=document.createElement('div');
  modal.id='officeModal';modal.className='modal hidden';
  modal.innerHTML=[
    '<div class="modal-body office-modal-body" role="dialog" aria-label="Office 轉 PDF">',
    '<div class="row" style="justify-content:space-between"><h3>基本內容轉換（不保留格式）</h3><button class="btn sm" id="officeClose">✕ 關閉</button></div>',
    '<p class="small">此功能會重新編排文字與表格，原字型、字距、分頁與表格位置可能改變，絕對不適合需要維持原稿格式的文件。檔案僅在手機瀏覽器中處理。',
    '支援 .docx、.xlsx，不支援舊版 .doc、.xls。</p>',
    '<label class="office-file-label" for="officeInput">＋ 選擇 Word 或 Excel 文件</label>',
    '<input id="officeInput" type="file" accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">',
    '<p id="officeFileName" class="small">尚未選擇檔案</p>',
    '<p id="officeNotice" class="office-notice hidden" role="alert"></p>',
    '<div id="officePreview" class="office-preview hidden"><div class="row" style="justify-content:space-between"><b>轉檔前預覽</b><span class="small" id="officePreviewInfo"></span></div>',
    '<div id="officeSheets" class="hidden"><label for="officeSheetPick">選擇工作表</label><select class="control" id="officeSheetPick"></select></div>',
    '<div id="officePreviewContent" class="office-preview-content"></div></div>',
    '<p class="office-warning">這是基本內容轉換，並非 Office 原生版面引擎。Word 的圖片、頁首頁尾及特殊版面；Excel 的圖表、格式、合併儲存格、列印分頁及樞紐分析可能遺失或跑版。正式文件請使用 Office 或 LibreOffice 原生匯出。</p>',
    '<div class="row"><button class="btn" id="officeReset">清除</button><button class="btn primary grow" id="officeExport" disabled>轉換並匯出 PDF</button></div></div>'
  ].join('');
  document.body.append(modal);
  const $=selector=>document.querySelector(selector);
  const entry=$('#officeEntry');
  if(!entry)return;
  entry.addEventListener('click',()=>modal.classList.remove('hidden'));
  $('#officeClose').onclick=()=>modal.classList.add('hidden');
  $('#officeReset').onclick=reset;
  $('#officeInput').onchange=()=>void openOffice($('#officeInput').files?.[0]);
  $('#officeSheetPick').onchange=()=>previewSheet(Number($('#officeSheetPick').value));
  $('#officeExport').onclick=()=>void convertOffice();
  function alertUser(message,error=false){
    const el=$('#officeNotice');el.textContent=message;el.classList.toggle('hidden',!message);
    el.classList.toggle('office-error',error);
  }
  function busy(on,message){
    state.busy=on;
    $('#officeInput').disabled=on;$('#officeReset').disabled=on;
    $('#officeClose').disabled=on;
    $('#officeExport').disabled=on||(!state.blocks.length&&!state.sheets.length);
    if(on)alertUser(message||'正在處理檔案…');
  }
  function reset(){
    state.file=null;state.kind=null;state.blocks=[];state.sheets=[];state.warnings=[];
    $('#officeInput').value='';$('#officeFileName').textContent='尚未選擇檔案';
    $('#officePreview').classList.add('hidden');$('#officeSheets').classList.add('hidden');
    $('#officeExport').disabled=true;alertUser('');
  }
  function script(name,url,ready){
    if(ready())return Promise.resolve();
    if(!libs[name])libs[name]=new Promise((resolve,reject)=>{
      const el=document.createElement('script');el.src=url;el.async=true;
      el.onload=()=>ready()?resolve():reject(Error(name+' 未成功啟動'));
      el.onerror=()=>reject(Error(name+' 程式庫下載失敗，請確認網路'));
      document.head.append(el);
    }).catch(e=>{delete libs[name];throw e});
    return libs[name];
  }
  const nodeText=node=>node?.textContent?.replace(/\s+/g,' ').trim()||'';
  function docxBlocks(html){
    // Parse without executing user HTML; show only textContent, not raw HTML.
    const dom=new DOMParser().parseFromString(html,'text/html');
    const result=[];
    for(const el of dom.body.children){
      const tag=el.tagName.toLowerCase();
      if(tag==='table'){
        const rawRows=Array.from(el.querySelectorAll('tr'));
        // Mammoth loses Word table grid/fixed widths. Never silently truncate more
        // than 8 columns or flatten merged cells in official forms and contracts.
        // A complex form must be exported in Word or another full layout engine.
        const complex=rawRows.some(tr=>{
          const cells=Array.from(tr.children).filter(cell=>['TD','TH'].includes(cell.tagName));
          const spanTotal=cells.reduce((n,c)=>n+Math.max(1,Number(c.getAttribute('colspan'))||1),0);
          return spanTotal>8 || cells.some(c=>
            (Number(c.getAttribute('colspan'))||1)>1 || (Number(c.getAttribute('rowspan'))||1)>1);
        });
        if(complex)throw Error('這份 Word 含有跨欄／合併儲存格或超過 8 欄的複雜表格。'
          +'基本轉檔可能遺失欄位、邊框與頁面配置，已停止以避免產生不完整 PDF。'
          +'請用 Microsoft Word 原生匯出 PDF；本工具正在研究不破壞版面的轉換方式。');
        if(rawRows.length>300)throw Error('此 Word 表格超過 300 列。為避免內容遺失，請改用 Word 原生 PDF 匯出。');
        const rows=rawRows.map(tr=>Array.from(tr.children).filter(c=>['TD','TH'].includes(c.tagName)).map(nodeText));
        if(rows.length)result.push({kind:'table',rows});
      }else if(tag==='ul'||tag==='ol'){
        Array.from(el.querySelectorAll('li')).slice(0,500).forEach(li=>{
          const t=nodeText(li);if(t)result.push({kind:'text',size:11,text:'•  '+t});
        });
      }else{
        const t=nodeText(el);if(t)result.push({kind:'text',size:tag==='h1'?19:tag==='h2'?15:tag==='h3'?13:11,text:t});
      }
      if(result.length>=1600)break;
    }
    return result;
  }
  async function openOffice(file){
    reset();if(!file)return;
    const ext=file.name.split('.').pop().toLowerCase();
    if(!['docx','xlsx'].includes(ext)){alertUser('僅支援 .docx、.xlsx，不支援 .doc、.xls',true);return;}
    if(file.size>15*1024*1024){alertUser('檔案超過 15 MB，為避免手機記憶體不足，請先縮小檔案',true);return;}
    state.file=file;state.kind=ext;
    $('#officeFileName').textContent=file.name+' · '+Math.round(file.size/1024)+' KB';
    busy(true,'正在本機讀取 Office 文件，首次使用會下載免費解析引擎…');
    try{
      if(ext==='docx'){
        await script('Mammoth','https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
          ()=>!!window.mammoth?.convertToHtml);
        const data=await window.mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()});
        state.blocks=docxBlocks(data.value);
        if(!state.blocks.length)throw Error('文件沒有可以轉換的文字或表格');
        if(/<img[\s>]/i.test(data.value))state.warnings.push('Word 圖片尚未轉換');
        if(state.blocks.length>=1600)state.warnings.push('僅轉換前 1600 個段落／項目');
        previewDocx();
      }else{
        await script('ExcelJS','https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
          ()=>!!window.ExcelJS?.Workbook);
        const book=new window.ExcelJS.Workbook();
        await book.xlsx.load(await file.arrayBuffer());
        if(book.worksheets.length>15)throw Error('超過 15 張工作表，請分割檔案再轉換');
        let remaining=2400;
        state.sheets=book.worksheets.filter(s=>!['hidden','veryHidden'].includes(s.state)).map(sheet=>{
          const cols=Math.max(1,Math.min(18,sheet.actualColumnCount||1)),rows=[];
          if(sheet.actualColumnCount>18)state.warnings.push('工作表「'+sheet.name+'」最多保留前 18 欄');
          sheet.eachRow({includeEmpty:false},(row,number)=>{
            if(remaining<=0)return;
            const cells=[];
            for(let c=1;c<=cols;c++){
              const cell=row.getCell(c);
              let value=String(cell.text??'');
              if(cell.value?.formula && cell.value.result==null)value='[公式無快取值]';
              cells.push(value);
            }
            rows.push({number,cells});remaining--;
          });
          return {name:sheet.name,rows};
        }).filter(s=>s.rows.length);
        if(!state.sheets.length)throw Error('沒有可以轉換的工作表資料');
        if(remaining<=0)state.warnings.push('最多轉換前 2400 列');
        const picker=$('#officeSheetPick');picker.replaceChildren();
        state.sheets.forEach((s,i)=>picker.append(new Option(s.name,String(i))));
        $('#officeSheets').classList.remove('hidden');
        previewSheet(0);
      }
      $('#officePreview').classList.remove('hidden');
      alertUser((state.warnings.length?'提醒：'+state.warnings.join('；')+'。':'')+'請核對下方預覽，複雜版面可能與原檔不同。');
    }catch(e){
      state.blocks=[];state.sheets=[];$('#officePreview').classList.add('hidden');
      alertUser('讀取失敗：'+(e.message||'無法解析檔案'),true);
    }finally{busy(false);}
  }
  function line(parent,value,heading=false){
    const el=document.createElement('div');
    el.className=heading?'office-preview-head':'office-preview-line';
    el.textContent=value;parent.append(el);
  }
  function showTable(root,rows,max=12){
    const table=document.createElement('table');table.className='office-table';
    rows.slice(0,max).forEach(row=>{
      const tr=document.createElement('tr');
      row.slice(0,9).forEach(value=>{
        const td=document.createElement('td');td.textContent=String(value);tr.append(td);
      });table.append(tr);
    });root.append(table);
  }
  function previewDocx(){
    const root=$('#officePreviewContent');root.replaceChildren();
    $('#officePreviewInfo').textContent=state.blocks.length+' 個段落／表格';
    state.blocks.slice(0,18).forEach(b=>b.kind==='table'?showTable(root,b.rows,6):line(root,b.text,b.size>12));
    if(state.blocks.length>18)line(root,'…後續內容將繼續轉換');
  }
  function previewSheet(i){
    const sheet=state.sheets[i];if(!sheet)return;
    $('#officePreviewInfo').textContent=sheet.rows.length+' 列';
    const root=$('#officePreviewContent');root.replaceChildren();
    showTable(root,sheet.rows.slice(0,15).map(r=>[String(r.number),...r.cells]));
    if(sheet.rows.length>15)line(root,'…後續資料列將繼續轉換');
  }
  async function convertOffice(){
    if(!state.file||state.busy)return;
    busy(true,'正在產生 PDF，首次需要下載繁體中文字型…');
    try{
      if(!window.PDFLib||!window.fontkit)throw Error('PDF 引擎尚未載入');
      const doc=await window.PDFLib.PDFDocument.create();
      doc.registerFontkit(window.fontkit);
      const response=await fetch('https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Regular.otf');
      if(!response.ok)throw Error('無法下載繁體中文字型');
      const font=await doc.embedFont(await response.arrayBuffer(),{subset:false});
      const allowed=new Set(font.getCharacterSet());
      const clean=text=>{
        text=String(text).replace(/[\r\n\t]/g,' ').replace(/[\u0000-\u001f]/g,'');
        const bad=[...new Set([...text].filter(c=>!allowed.has(c.codePointAt(0))))];
        if(bad.length)throw Error('基本轉檔引擎缺少文件字元：'+bad.slice(0,6).join('')+'。請不要刪除原稿符號來湊合轉檔；若要保留原稿字型與格式，請使用 Office 原生匯出，或改試 LibreOffice 版面優先模式。');
        return text;
      };
      const color=window.PDFLib.rgb(.09,.18,.29),gray=window.PDFLib.rgb(.71,.76,.82);
      const A4=[595.28,841.89],L=[841.89,595.28];
      let page,y,pageCount=0;
      function begin(landscape=false){
        page=doc.addPage(landscape?L:A4);pageCount++;
        y=page.getHeight()-38;
      }
      function wrap(str,size,maxWidth){
        const lines=[];let part='';
        for(const ch of [...clean(str)]){
          if(part&&font.widthOfTextAtSize(part+ch,size)>maxWidth){lines.push(part);part=ch;}
          else part+=ch;
        }
        if(part)lines.push(part);
        return lines.length?lines:[''];
      }
      function write(str,size=11,landscape=false){
        const lines=wrap(str,size,page.getWidth()-72);
        for(const line of lines){
          if(y<size+46)begin(landscape);
          if(line)page.drawText(line,{x:36,y,size,font,color});
          y-=size*1.44;
        }
        y-=5;
      }
      function table(rows,colCount,landscape=false){
        const w=(page.getWidth()-72)/colCount,size=8.5;
        for(let r=0;r<rows.length;r++){
          const items=Array.from({length:colCount},(_,i)=>wrap(rows[r][i]??'',size,w-10).slice(0,3));
          const height=Math.max(22,...items.map(l=>l.length*12+7));
          if(y-height<45)begin(landscape);
          for(let c=0;c<colCount;c++){
            const x=36+c*w;
            page.drawRectangle({x,y:y-height,width:w,height,borderWidth:.5,borderColor:gray});
            items[c].forEach((str,idx)=>{if(str)page.drawText(str,{x:x+4,y:y-11-idx*12,size,font,color});});
          }
          y-=height;
        }
        y-=12;
      }
      if(state.kind==='docx'){
        begin(false);
        state.blocks.forEach(b=>{
          if(b.kind==='table'){
            const maxCols=Math.min(6,Math.max(1,...b.rows.map(r=>r.length)));
            table(b.rows,maxCols,false);
          }else write(b.text,b.size||11,false);
        });
      }else{
        for(const sh of state.sheets){
          const cols=Math.max(1,...sh.rows.map(r=>r.cells.length));
          for(let c=0;c<cols;c+=8){
            begin(true);
            write('工作表：'+sh.name+(cols>8?'　欄位 '+(c+1)+' 至 '+Math.min(cols,c+8):''),14,true);
            table(sh.rows.map(r=>r.cells.slice(c,c+8)),Math.min(8,cols-c),true);
          }
        }
      }
      const bytes=await doc.save();
      modal.classList.add('hidden');
      showResult(bytes,state.file.name.replace(/\.(docx|xlsx)$/i,'')+'_basic.pdf');
      alertUser('完成：共 '+pageCount+' 頁。文字可選取，但複雜 Office 格式不保證相同，請確認 PDF 再使用。');
    }catch(e){alertUser('PDF 產生失敗：'+(e.message||'未知錯誤'),true);}
    finally{busy(false);}
  }
})();
