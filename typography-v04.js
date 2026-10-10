/* PDF 工作台 v0.4｜免費字型選擇、格式刷引導、附近文字格式偵測
 * 修改原始 PDF 文字仍不支援；偵測僅供新文字格式參考，不會冒充字型完全一致。
 */
(() => {
  'use strict';
  const previousProperties = editorProperties;
  const previousAnnotations = renderAnnotations;
  const previousAdd = addText;
  const previousSetup = setupEditorUI;
  const previousDown = onAnnoDown;
  const SANS = 'NotoSansTC', SERIF = 'NotoSerifTC';
  const fontLabels = {
    NotoSansTC:'思源黑體（繁體中文）',
    NotoSerifTC:'思源宋體（繁體中文）',
    Helvetica:'Helvetica（僅英文）',
    Times:'Times（僅英文）',
    UploadedFont:'自選 TTF／OTF 字型'
  };
  const fontCss = {
    NotoSansTC:'"PdfNotoSansTC", "PingFang TC", sans-serif',
    NotoSerifTC:'"PdfNotoSerifTC", "Noto Serif TC", serif',
    Helvetica:'Arial, sans-serif',
    Times:'"Times New Roman", serif',
    UploadedFont:'"PdfUserFont", "PingFang TC", sans-serif'
  };
  const fontStyles = document.createElement('style');
  fontStyles.textContent = \`
  @font-face {
    font-family:"PdfNotoSansTC";
    src:url("https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Regular.otf") format("opentype");
    font-weight:400; font-display:swap;
  }
  @font-face {
    font-family:"PdfNotoSansTC";
    src:url("https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Bold.otf") format("opentype");
    font-weight:700; font-display:swap;
  }
  @font-face {
    font-family:"PdfNotoSerifTC";
    src:url("https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Serif/SubsetOTF/TC/NotoSerifTC-Regular.otf") format("opentype");
    font-weight:400; font-display:swap;
  }
  @font-face {
    font-family:"PdfNotoSerifTC";
    src:url("https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Serif/SubsetOTF/TC/NotoSerifTC-Bold.otf") format("opentype");
    font-weight:700; font-display:swap;
  }
  \`;
  document.head.append(fontStyles);

  const fontWarning = () =>
    '原 PDF 的字型不一定能完整提取或重新嵌入；此處採開源字型提供新增文字功能，' +
    '不能保證與既有文字完全一致。需要完全相同時，請提供原字型的合法 TTF／OTF 檔。';

  renderAnnotations = function styledAnnotations() {
    previousAnnotations();
    const root = document.querySelector('#annotationLayer');
    if (!root) return;
    for (const el of root.querySelectorAll('.annotation')) {
      const a = app.ann.find(v => v.id === el.dataset.id);
      if (!a || a.kind !== 'text') continue;
      el.style.fontFamily = fontCss[a.font] || fontCss[SANS];
      el.title = '點一下可修改文字；按住拖曳可移動位置';
    }
  };

  editorProperties = function styledProperties() {
    previousProperties();
    const a = selectedAnn();
    const select = document.querySelector('#txtFont');
    if (!a || a.kind !== 'text' || !select) return;
    const fontField = select.closest('.field');
    if (fontField?.querySelector('label')) fontField.querySelector('label').textContent = '字型（可輸出）';
    select.innerHTML = Object.entries(fontLabels).map(([id, name]) =>
      '<option value="' + id + '">' + name + '</option>').join('');
    select.value = fontLabels[a.font] ? a.font : SANS;
    if (!fontLabels[a.font]) {
      // Legacy v0.3 annotations may not have a valid font.
      a.font = SANS;
    }
    select.addEventListener('change', () => {
      const current = selectedAnn();
      if (current?.kind !== 'text') return;
      if (select.value === 'UploadedFont' && !app.uploadedFont) {
        notify('使用自選字型前，請先上傳有使用權的 TTF／OTF 字型');
      } else if (['Helvetica','Times'].includes(select.value) &&
                 /[^\u0000-\u00ff]/.test(current.text)) {
        notify('此英文字型不支援繁體中文。匯出前請改選中文字型。');
      }
      if (select.value === SANS || select.value === SERIF) {
        document.fonts.load((current.weight==='bold'?'700':'400') +
          ' ' + Math.max(8, current.size) + 'px ' +
          (select.value === SANS ? '"PdfNotoSansTC"' : '"PdfNotoSerifTC"'))
          .catch(() => {});
      }
      setTimeout(renderAnnotations,0);
    });

    const container = select.closest('.row.wrap')?.parentElement || document.querySelector('#properties');
    const note = document.createElement('p');
    note.className = 'small typography-notice';
    note.textContent = fontWarning();
    select.closest('.row.wrap')?.insertAdjacentElement('afterend', note);

    const sampleBtn = document.createElement('button');
    sampleBtn.id = 'sampleNeighborFont';
    sampleBtn.className = 'btn block';
    sampleBtn.textContent = '⌕ 參照附近原文的字號與字型';
    sampleBtn.addEventListener('click', () => void matchNeighbor(a.id, false));
    note.insertAdjacentElement('afterend', sampleBtn);

    const source = document.createElement('div');
    source.id = 'neighborStyleNote';
    source.className = 'small typography-source-note';
    source.setAttribute('aria-live','polite');
    source.textContent = a.neighborStyleMessage || '移動新增文字到目標位置後，可按「參照附近原文」重新分析。';
    sampleBtn.insertAdjacentElement('afterend', source);

    const brushText = document.createElement('div');
    brushText.className = 'small typography-brush-note';
    brushText.textContent = '格式刷：先選一個新增文字框 → 點上方「格式刷」→ 點另一個新增文字框。' +
      '只複製字型、大小、粗細與顏色，不複製文字內容。';
    container.appendChild(brushText);
  };

  function nearestFont(family) {
    const val = (family || '').toLowerCase().replace(/[\s_-]/g,'');
    // Exact family strings are hints, not proof that subset font data can be reused.
    if (val.includes('notoseriftc')) return SERIF;
    if (val.includes('notosanstc')) return SANS;
    if (val.includes('times') && !val.includes('chinese')) return 'Times';
    if (val.includes('helvetica')) return 'Helvetica';
    return null;
  }

  function normalizePageCoords(item, viewport) {
    const e = item.transform[4], f = item.transform[5], t = viewport.transform;
    return { x:t[0]*e+t[2]*f+t[4], y:t[1]*e+t[3]*f+t[5] };
  }

  async function matchNeighbor(annotationId, silent) {
    const a = app.ann.find(x => x.id === annotationId);
    if (!a || a.kind !== 'text' || !app.previewDoc) return;
    try {
      const page = await app.previewDoc.getPage(a.page + 1);
      const viewport = page.getViewport({ scale:1 });
      const tc = await page.getTextContent();
      const candidates = tc.items.filter(x => typeof x.str === 'string' && x.str.trim());
      let closest = null, best = Infinity;
      const targetX = a.x*viewport.width, targetY = a.y*viewport.height;
      for (const item of candidates) {
        const point = normalizePageCoords(item, viewport);
        const sz = Math.hypot(item.transform[0], item.transform[1]);
        if (!Number.isFinite(sz) || sz < 4 || sz > 100) continue;
        const dist = Math.hypot((point.x-targetX), (point.y-sz-targetY));
        if (dist < best) { best=dist; closest={item, size:sz}; }
      }
      const fresh=app.ann.find(x => x.id === annotationId);
      if (!fresh) return;
      if (!closest || best > Math.max(150, viewport.width*.38)) {
        fresh.neighborStyleMessage='附近沒有找到可辨識的 PDF 原文字。可自行調整字型與字號。';
        if (!silent) notify(fresh.neighborStyleMessage);
      } else {
        const family=tc.styles[closest.item.fontName]?.fontFamily || closest.item.fontName || '未知';
        const compatible=nearestFont(family);
        const pt=Math.min(72, Math.max(6, Math.round(closest.size*2)/2));
        // Only automatically change font when the original font belongs to a known
        // family. In other cases do not silently pretend that a fallback is identical.
        snapshot();
        fresh.size=pt;
        if (compatible) fresh.font=compatible;
        else if (!fontLabels[fresh.font]) fresh.font=SANS;
        if (!/^#[0-9a-f]{6}$/i.test(fresh.color)) fresh.color='#111827';
        fresh.neighborStyleMessage='附近原文字型：'+family+'，推估字號 '+pt+' pt。' +
          (compatible?'已選擇對應字型類別，但仍須核對是否與原檔完全相同。':
           '無法取得同款完整字型，因此只自動參考字號；目前字型保持原設定。') +
          ' 原始文字顏色無法從此分析結果精確讀取，請自行核對。';
        if (!silent) notify('已參考附近文字字號；原字型與顏色仍需確認');
        renderAnnotations();
        editorProperties();
      }
      const node=document.querySelector('#neighborStyleNote');
      if (node && app.selected === annotationId) node.textContent=fresh.neighborStyleMessage;
    } catch(e) {
      if (!silent) notify('無法分析附近文字：'+(e.message||'未知問題'));
    }
  }

  addText = function addWithNeighbor() {
    previousAdd(); // calls the existing editable text bottom sheet
    const a=selectedAnn();
    if (!a || a.kind !== 'text') return;
    a.font=SANS;
    a.color='#111827';
    renderAnnotations();
    editorProperties();
    const id=a.id;
    void matchNeighbor(id, true);
  };

  setupEditorUI = function informativeEditorSetup() {
    previousSetup();
    const toolbar=document.querySelector('#toolbar');
    if (!toolbar || document.querySelector('#formatBrushGuide')) return;
    const banner=document.createElement('div');
    banner.id='formatBrushGuide';
    banner.className='format-guide hidden';
    banner.innerHTML='<b>格式刷已啟用</b><span>點選另一個「新增的文字框」套用格式，不會改變內容。</span>' +
      '<button class="btn sm" type="button" id="cancelFormatBrush">取消</button>';
    toolbar.insertAdjacentElement('afterend',banner);
    document.querySelector('#cancelFormatBrush').onclick=()=>{
      app.formatMode=false;
      document.querySelector('[data-edit="paint"]')?.classList.remove('active');
      banner.classList.add('hidden');
      notify('已取消格式刷');
    };
    toolbar.addEventListener('click',e=>{
      if (e.target.closest('[data-edit="paint"]')) queueMicrotask(syncBrushGuide);
    });
  };
  function syncBrushGuide(){
    const banner=document.querySelector('#formatBrushGuide');
    banner?.classList.toggle('hidden',!app.formatMode);
    document.querySelector('[data-edit="paint"]')?.classList.toggle('active',!!app.formatMode);
  }
  onAnnoDown = function formatBrushFeedback(e) {
    previousDown(e);
    if (app.formatMode) setTimeout(syncBrushGuide,0);
    else syncBrushGuide();
  };

  const previousFontOnChange = document.querySelector('#userFont').onchange;
  document.querySelector('#userFont').onchange = async function fontUploaded(event) {
    await previousFontOnChange(event);
    if (!app.uploadedFont || !app.selected) return;
    const a=selectedAnn();
    if (a?.kind==='text') {
      snapshot();
      a.font='UploadedFont';
      renderAnnotations();
      editorProperties();
      notify('已為選取的文字框指定自選字型；請確認該字型包含所需字元。');
    }
  };
})();
