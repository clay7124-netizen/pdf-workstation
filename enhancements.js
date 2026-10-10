/* PDF 工作台 v0.3：手機文字編輯、PDF 合併預覽、圖片旋轉、原文字型檢查
 * 原文修改尚未實作，絕不以白框覆蓋假冒真正編輯。
 * 此檔案不會將使用者檔案或辨識結果上傳至伺服器。
 */
(() => {
  'use strict';
  const cache = new WeakMap();
  const mergePage = new WeakMap();
  const imgRotation = new WeakMap();
  let mergeRenderVersion = 0;
  let quickEdit = null;
  let zoomFile = null;
  let zoomPage = 1;
  let zoomRenderVersion = 0;
  const baseRowFile = rowFile;
  const baseRenderWork = renderWork;
  const baseEditorProperties = editorProperties;
  const baseAddText = addText;
  const baseConvertImages = convertImages;
  const baseOnAnnoDown = onAnnoDown;

  function initPdfWorker() {
    const { pdfjs } = engines();
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    return pdfjs;
  }

  function pdfFor(file) {
    if (!cache.has(file)) {
      const promise = (async () => {
        const pdfjs = initPdfWorker();
        return await pdfjs.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
          isEvalSupported: false,
        }).promise;
      })().catch(error => { cache.delete(file); throw error; });
      cache.set(file, promise);
    }
    return cache.get(file);
  }

  rowFile = function enhancedFileRow(file, i) {
    const base = baseRowFile(file, i);
    if (app.tool === 'merge') {
      return '<section class="file-preview-card">' + base +
        '<div class="merge-preview" data-index="' + i + '">' +
        '<button class="preview-cover" data-zoom="' + i + '" aria-label="放大預覽第 ' + (i + 1) + ' 份 PDF">' +
        '<canvas class="merge-preview-canvas"></canvas><span class="preview-hint">點選放大預覽</span></button>' +
        '<div class="preview-nav">' +
        '<button class="btn sm" data-mergenav="' + i + ',-1" aria-label="上一頁">‹</button>' +
        '<span class="merge-counter" aria-live="polite">正在讀取 PDF…</span>' +
        '<button class="btn sm" data-mergenav="' + i + ',1" aria-label="下一頁">›</button></div>' +
        '<p class="merge-preview-error small" hidden></p></div></section>';
    }
    if (app.tool === 'images') {
      return '<section class="file-preview-card">' + base +
        '<div class="image-preview" data-index="' + i + '">' +
        '<canvas class="image-preview-canvas"></canvas>' +
        '<div class="preview-nav"><button class="btn sm" data-imgrotate="' + i + ',-90">↶ 向左旋轉</button>' +
        '<span class="image-angle small">0°</span>' +
        '<button class="btn sm" data-imgrotate="' + i + ',90">向右旋轉 ↷</button></div>' +
        '<p class="small" style="text-align:center;margin:0">每張圖片的旋轉角度會套用到匯出 PDF</p>' +
        '</div></section>';
    }
    return base;
  };

  renderWork = function enhancedRenderWork() {
    baseRenderWork();
    if (!app.files.length) return;
    if (app.tool === 'merge') void setupMergePreviews();
    if (app.tool === 'images') void setupImagePreviews();
    if (app.tool === 'edit') addInspectorButton();
  };

  async function drawPdfCanvas(page, canvas, maxWidth, maxHeight, versionOk) {
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / unscaled.width, maxHeight / unscaled.height, 1.65);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * dpr });
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('瀏覽器無法建立預覽畫布');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    canvas.style.width = (viewport.width / dpr) + 'px';
    canvas.style.height = (viewport.height / dpr) + 'px';
    await page.render({ canvasContext: ctx, viewport }).promise;
    if (!versionOk()) return;
  }

  async function renderMergeCard(file, index, version) {
    const root = document.querySelector('.merge-preview[data-index="' + index + '"]');
    if (!root) return;
    const counter = root.querySelector('.merge-counter');
    const errorNode = root.querySelector('.merge-preview-error');
    try {
      const pdf = await pdfFor(file);
      if (version !== mergeRenderVersion || app.files[index] !== file || !root.isConnected) return;
      const total = pdf.numPages;
      const current = Math.max(1, Math.min(total, mergePage.get(file) || 1));
      mergePage.set(file, current);
      const buttons = root.querySelectorAll('[data-mergenav]');
      if (buttons[0]) buttons[0].disabled = current <= 1;
      if (buttons[1]) buttons[1].disabled = current >= total;
      counter.textContent = '第 ' + current + ' / ' + total + ' 頁';
      const page = await pdf.getPage(current);
      if (version !== mergeRenderVersion || !root.isConnected) return;
      await drawPdfCanvas(page, root.querySelector('canvas'), 270, 310, () =>
        version === mergeRenderVersion && app.files[index] === file && root.isConnected);
    } catch (error) {
      if (!root.isConnected) return;
      counter.textContent = '無法產生預覽';
      errorNode.hidden = false;
      errorNode.textContent = error.message || '檔案可能已損毀或受密碼保護';
    }
  }

  async function setupMergePreviews() {
    const version = ++mergeRenderVersion;
    for (const btn of document.querySelectorAll('[data-mergenav]')) {
      btn.addEventListener('click', () => {
        const [idx, delta] = btn.dataset.mergenav.split(',').map(Number);
        const file = app.files[idx];
        if (!file) return;
        const counter = document.querySelector('.merge-preview[data-index="' + idx + '"] .merge-counter');
        if (counter) counter.textContent = '正在切換頁面…';
        void pdfFor(file).then(pdf => {
          const next = Math.max(1, Math.min(pdf.numPages, (mergePage.get(file) || 1) + delta));
          mergePage.set(file, next);
          return renderMergeCard(file, idx, version);
        }).catch(error => notify(error.message));
      });
    }
    for (const btn of document.querySelectorAll('[data-zoom]')) {
      btn.addEventListener('click', () => {
        zoomFile = app.files[Number(btn.dataset.zoom)];
        zoomPage = mergePage.get(zoomFile) || 1;
        document.querySelector('#pdfZoomModal').classList.remove('hidden');
        void drawZoom();
      });
    }
    await Promise.all(app.files.map((file, idx) => renderMergeCard(file, idx, version)));
  }

  async function drawZoom() {
    const version = ++zoomRenderVersion;
    if (!zoomFile) return;
    const count = document.querySelector('#pdfZoomCounter');
    count.textContent = '正在預覽…';
    try {
      const pdf = await pdfFor(zoomFile);
      if (version !== zoomRenderVersion) return;
      zoomPage = Math.max(1, Math.min(pdf.numPages, zoomPage));
      count.textContent = '第 ' + zoomPage + ' / ' + pdf.numPages + ' 頁';
      document.querySelector('#zoomPrev').disabled = zoomPage === 1;
      document.querySelector('#zoomNext').disabled = zoomPage === pdf.numPages;
      const page = await pdf.getPage(zoomPage);
      if (version !== zoomRenderVersion) return;
      await drawPdfCanvas(page, document.querySelector('#pdfZoomCanvas'),
        Math.max(140, innerWidth - 32), Math.max(240, innerHeight - 210),
        () => version === zoomRenderVersion);
      mergePage.set(zoomFile, zoomPage);
    } catch (e) {
      count.textContent = '無法預覽：' + (e.message || '未知錯誤');
    }
  }

  async function decodeImage(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file); } catch { /* fallback to Image */ }
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('圖片無法讀取')); };
      image.src = url;
    });
  }

  function paintImageRotated(canvasOrContext, bitmap, angle, scale) {
    const ctx = canvasOrContext.getContext ? canvasOrContext.getContext('2d') : canvasOrContext;
    if (!ctx) throw new Error('無法建立圖片處理畫布');
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    const rad = angle * Math.PI / 180;
    const rotated = Math.abs(angle % 180) === 90;
    const outW = rotated ? h : w;
    const outH = rotated ? w : h;
    const canvas = ctx.canvas;
    canvas.width = Math.max(1, Math.round(outW));
    canvas.height = Math.max(1, Math.round(outH));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  async function drawImageCard(file, index, version) {
    const card = document.querySelector('.image-preview[data-index="' + index + '"]');
    if (!card) return;
    const angle = imgRotation.get(file) || 0;
    card.querySelector('.image-angle').textContent = angle + '°';
    try {
      const bitmap = await decodeImage(file);
      if (version !== mergeRenderVersion || app.files[index] !== file || !card.isConnected) {
        bitmap.close?.(); return;
      }
      const side = Math.max(bitmap.width, bitmap.height);
      const canvas = card.querySelector('canvas');
      paintImageRotated(canvas, bitmap, angle, Math.min(1, 250 / side));
      bitmap.close?.();
    } catch (e) {
      card.querySelector('.image-angle').textContent = '無法預覽圖片';
    }
  }

  async function setupImagePreviews() {
    const version = ++mergeRenderVersion;
    document.querySelectorAll('[data-imgrotate]').forEach(button => {
      button.addEventListener('click', () => {
        const [index, delta] = button.dataset.imgrotate.split(',').map(Number);
        const file = app.files[index];
        if (!file) return;
        const angle = ((imgRotation.get(file) || 0) + delta + 360) % 360;
        imgRotation.set(file, angle);
        void drawImageCard(file, index, version);
      });
    });
    await Promise.all(app.files.map((file, i) => drawImageCard(file, i, version)));
  }

  convertImages = async function convertRotatedImages(files) {
    const { PDFLib } = engines();
    const doc = await PDFLib.PDFDocument.create();
    for (const file of files) {
      const angle = imgRotation.get(file) || 0;
      // 未旋轉的圖片保留原始 JPEG/PNG 編碼，避免不必要的品質損失。
      let image;
      if (!angle) {
        const bytes = await file.arrayBuffer();
        image = (file.type === 'image/png' || /\.png$/i.test(file.name))
          ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      } else {
        const bitmap = await decodeImage(file);
        try {
          const w = bitmap.width, h = bitmap.height;
          const scale = Math.min(1, 3200 / Math.max(w, h));
          const canvas = document.createElement('canvas');
          paintImageRotated(canvas, bitmap, angle, scale);
          const mime = (file.type === 'image/png' || /\.png$/i.test(file.name))
            ? 'image/png' : 'image/jpeg';
          const blob = await new Promise((resolve, reject) =>
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('圖片旋轉失敗')), mime, .93));
          const bytes = await blob.arrayBuffer();
          image = mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          canvas.width = canvas.height = 0;
        } finally { bitmap.close?.(); }
      }
      const landscape = image.width > image.height;
      const paper = landscape ? [841.89, 595.28] : [595.28, 841.89];
      const margin = 24;
      const scale = Math.min((paper[0] - 2 * margin) / image.width,
                             (paper[1] - 2 * margin) / image.height);
      const drawW = image.width * scale, drawH = image.height * scale;
      doc.addPage(paper).drawImage(image, {
        x: (paper[0] - drawW) / 2, y: (paper[1] - drawH) / 2,
        width: drawW, height: drawH
      });
    }
    return await doc.save();
  };

  const modal = document.createElement('div');
  modal.id = 'quickTextModal';
  modal.className = 'modal text-modal hidden';
  modal.innerHTML = '<div class="modal-body"><h3 style="margin:0 0 8px">編輯新增的文字</h3>' +
    '<label class="small" for="quickTextArea">輸入文字，PDF 預覽會同步更新</label>' +
    '<textarea id="quickTextArea" class="control" rows="5" placeholder="在這裡輸入要新增的文字" ' +
    'style="margin:12px 0;line-height:1.5;resize:vertical"></textarea>' +
    '<div class="row"><button class="btn" id="quickTextCancel">取消</button>' +
    '<button class="btn primary right" id="quickTextDone">完成編輯</button></div></div>';
  document.body.append(modal);

  function quickEditor(annotation, fresh = false) {
    if (!annotation || annotation.kind !== 'text') return;
    const original = annotation.text;
    if (!fresh) snapshot();
    quickEdit = { id: annotation.id, original, fresh };
    modal.classList.remove('hidden');
    const area = document.querySelector('#quickTextArea');
    area.value = fresh ? '' : original;
    if (fresh) annotation.text = '';
    renderAnnotations();
    setTimeout(() => { area.focus(); if (!fresh) area.select(); }, 70);
  }

  document.querySelector('#quickTextArea').addEventListener('input', e => {
    if (!quickEdit) return;
    const ann = app.ann.find(a => a.id === quickEdit.id);
    if (ann) {
      ann.text = e.target.value;
      renderAnnotations();
    }
  });
  document.querySelector('#quickTextDone').addEventListener('click', () => {
    if (!quickEdit) return;
    const ann = app.ann.find(a => a.id === quickEdit.id);
    if (ann) ann.text = document.querySelector('#quickTextArea').value;
    if (ann && !ann.text.trim()) {
      notify('文字不可空白，請輸入文字或按取消');
      document.querySelector('#quickTextArea').focus();
      return;
    }
    quickEdit = null;
    modal.classList.add('hidden');
    editorProperties();
    renderAnnotations();
    notify('文字已更新');
  });
  document.querySelector('#quickTextCancel').addEventListener('click', () => {
    if (!quickEdit) return;
    if (quickEdit.fresh) {
      app.ann = app.ann.filter(a => a.id !== quickEdit.id);
      app.selected = null;
    } else {
      const ann = app.ann.find(a => a.id === quickEdit.id);
      if (ann) ann.text = quickEdit.original;
    }
    app.undo.pop(); // 新增與修改都只保留一筆快照
    app.redo = [];
    quickEdit = null;
    modal.classList.add('hidden');
    editorProperties();
    renderAnnotations();
  });

  addText = function addAndEditText() {
    baseAddText();
    const current = selectedAnn();
    quickEditor(current, true);
  };

  editorProperties = function liveTextProperties() {
    baseEditorProperties();
    const ann = selectedAnn();
    const area = document.querySelector('#txtBody');
    if (!area || ann?.kind !== 'text') return;
    // 舊版只監聽 change（失焦才更新），改成 input 同步顯示且支援注音組字。
    const live = area.cloneNode(true);
    area.replaceWith(live);
    let started = false;
    live.addEventListener('input', e => {
      if (!started) { snapshot(); started = true; }
      const current = selectedAnn();
      if (!current || current.id !== ann.id) return;
      current.text = e.target.value;
      renderAnnotations();
    });
    const editBtn = document.createElement('button');
    editBtn.className = 'btn primary block';
    editBtn.id = 'openQuickTextEditor';
    editBtn.style.marginBottom = '10px';
    editBtn.textContent = '✎ 修改這段文字';
    editBtn.addEventListener('click', () => {
      const current = selectedAnn();
      if (current?.kind === 'text') quickEditor(current);
    });
    document.querySelector('#properties').insertBefore(editBtn, live);
    const hint = document.createElement('p');
    hint.className = 'small';
    hint.textContent = '也可直接在下方輸入框改字；修改會即時顯示於 PDF 預覽。';
    live.insertAdjacentElement('afterend', hint);
  };

  onAnnoDown = function tapToEditText(event) {
    const el = event.currentTarget;
    const ann = app.ann.find(a => a.id === el.dataset.id);
    if (!ann || ann.kind !== 'text' || app.formatMode) {
      baseOnAnnoDown(event);
      return;
    }
    const x = event.clientX, y = event.clientY;
    const id = event.pointerId;
    const onUp = e => {
      el.removeEventListener('pointercancel', onCancel);
      if (e.pointerId !== id) return;
      if (Math.hypot(e.clientX - x, e.clientY - y) < 8) {
        const current = app.ann.find(a => a.id === ann.id);
        if (current) setTimeout(() => quickEditor(current), 0);
      }
    };
    const onCancel = () => el.removeEventListener('pointerup', onUp);
    el.addEventListener('pointerup', onUp, { once: true });
    el.addEventListener('pointercancel', onCancel, { once: true });
    baseOnAnnoDown(event);
  };

  const zoom = document.createElement('div');
  zoom.id = 'pdfZoomModal';
  zoom.className = 'modal hidden pdf-zoom';
  zoom.innerHTML = '<div class="modal-body" style="max-width:740px">' +
    '<div class="row" style="justify-content:space-between"><strong>PDF 內容預覽</strong>' +
    '<button class="btn" id="closePdfZoom">關閉 ✕</button></div>' +
    '<div class="zoom-scroll"><canvas id="pdfZoomCanvas"></canvas></div>' +
    '<div class="preview-nav"><button class="btn" id="zoomPrev">‹ 上一頁</button>' +
    '<span class="small" id="pdfZoomCounter">讀取中</span><button class="btn" id="zoomNext">下一頁 ›</button></div>' +
    '</div>';
  document.body.append(zoom);
  document.querySelector('#closePdfZoom').onclick = () => {
    zoom.classList.add('hidden'); zoomFile = null; zoomRenderVersion++;
  };
  document.querySelector('#zoomPrev').onclick = () => { if (zoomPage > 1) { zoomPage--; void drawZoom(); } };
  document.querySelector('#zoomNext').onclick = () => { zoomPage++; void drawZoom(); };

  function addInspectorButton() {
    if (document.querySelector('#inspectOriginalBtn')) return;
    const toolbar = document.querySelector('#toolbar');
    if (!toolbar) return;
    const button = document.createElement('button');
    button.className = 'btn';
    button.id = 'inspectOriginalBtn';
    button.textContent = '⌕ 分析原文字型';
    button.title = '唯讀分析，可檢視文字與可能的字型，不會修改原文';
    button.onclick = () => void inspectOriginalText();
    toolbar.append(button);
  }

  const inspector = document.createElement('div');
  inspector.id = 'originalInspector';
  inspector.className = 'modal hidden';
  inspector.innerHTML = '<div class="modal-body"><div class="row" style="justify-content:space-between">' +
    '<h3>原文字型檢查（唯讀）</h3><button class="btn" id="closeInspector">完成</button></div>' +
    '<p class="small">此功能僅分析當前 PDF 頁面可選取的文字與 PDF.js 判讀的字型。不能在這裡修改原始內容，字型名稱不保證可重新嵌入。</p>' +
    '<div id="inspectorResult" class="stack"></div></div>';
  document.body.append(inspector);
  document.querySelector('#closeInspector').onclick = () => inspector.classList.add('hidden');

  async function inspectOriginalText() {
    inspector.classList.remove('hidden');
    const result = document.querySelector('#inspectorResult');
    result.textContent = '正在讀取頁面文字與字型資訊…';
    try {
      const page = await app.previewDoc.getPage(app.pageNo + 1);
      const text = await page.getTextContent();
      const items = text.items.filter(item => item.str?.trim()).slice(0, 40);
      result.innerHTML = '';
      if (!items.length) {
        result.textContent = '此頁找不到可選取文字，可能是掃描影像或內容經特殊處理。';
        return;
      }
      const seen = new Set();
      for (const item of items) {
        const style = text.styles[item.fontName] || {};
        const name = style.fontFamily || item.fontName || '未知';
        if (seen.has(name)) continue;
        seen.add(name);
        const entry = document.createElement('div');
        entry.className = 'card';
        const title = document.createElement('b');
        title.textContent = name;
        const info = document.createElement('p');
        info.className = 'small';
        info.textContent = 'PDF 字型代碼：' + (item.fontName || '未知');
        const example = document.createElement('p');
        example.textContent = '範例：' + item.str.slice(0, 70);
        entry.append(title, info, example);
        result.append(entry);
      }
      const summary = document.createElement('p');
      summary.className = 'small';
      summary.textContent = '本頁分析到 ' + items.length + ' 個文字區塊（最多顯示前 40 個），' +
        seen.size + ' 種字型標記。僅供字型相容性研究使用。';
      result.prepend(summary);
    } catch (e) {
      result.textContent = '無法分析這一頁：' + (e.message || '未知錯誤');
    }
  }
})();
