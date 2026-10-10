/* PDF 工作台 v0.5：編輯頁面觸控縮放／滑桿縮放、字號滑桿、即時字型預覽 */
(() => {
  'use strict';
  const oldRenderWork = renderWork;
  const oldRenderEditorPage = renderEditorPage;
  const oldEditorProperties = editorProperties;
  let zoomTimer = null;
  let renderQueue = Promise.resolve();
  let drawingPinch = false;
  let pinchInfo = null;
  let touchInstalled = false;
  const MIN_ZOOM = 75, MAX_ZOOM = 300;
  const limit = (n, min, max) => Math.max(min, Math.min(max,n));

  // The base editor renderer uses editorScale for the page and annotations.
  // Queue expensive PDF.js paint operations to avoid two paints on the same canvas.
  renderEditorPage = function renderEditorPageSafely() {
    renderQueue = renderQueue.catch(() => {}).then(async () => {
      const viewer = document.querySelector('.viewer-box');
      if (app.tool !== 'edit' || !viewer || !app.previewDoc) return;
      const oldWidth = viewer.scrollWidth, oldHeight=viewer.scrollHeight;
      const anchorX = oldWidth ? (viewer.scrollLeft+viewer.clientWidth/2)/oldWidth : .5;
      const anchorY = oldHeight ? (viewer.scrollTop+viewer.clientHeight/2)/oldHeight : 0;
      await oldRenderEditorPage();
      const current = document.querySelector('.viewer-box');
      if (!current || app.tool !== 'edit') return;
      current.scrollLeft=Math.max(0, anchorX*current.scrollWidth-current.clientWidth/2);
      current.scrollTop=Math.max(0, anchorY*current.scrollHeight-current.clientHeight/2);
    });
    return renderQueue;
  };

  function setZoomLabel(percent) {
    const slider=document.querySelector('#pdfZoomSlider');
    const value=document.querySelector('#pdfZoomValue');
    if(slider) slider.value=String(percent);
    if(value) value.textContent=percent+'%';
  }
  function setZoom(percent, immediate=false) {
    const next=limit(Math.round(Number(percent)||100),MIN_ZOOM,MAX_ZOOM);
    app.zoom=next/100;
    setZoomLabel(next);
    clearTimeout(zoomTimer);
    if(immediate) { void renderEditorPage(); }
    else zoomTimer=setTimeout(()=>void renderEditorPage(),140);
  }

  function addZoomToolbar() {
    const viewer=document.querySelector('.viewer-box');
    if(!viewer || document.querySelector('#pdfZoomToolbar'))return;
    if(typeof app.zoom !== 'number') app.zoom=1;
    const bar=document.createElement('div');
    bar.id='pdfZoomToolbar';
    bar.className='pdf-zoom-toolbar';
    bar.innerHTML='<div class="zoom-caption"><strong>文件放大縮小</strong><span>雙指縮放，放大後可拖動頁面</span></div>'+
      '<div class="zoom-controls">'+
      '<button class="btn sm zoom-step" id="pdfZoomOut" title="縮小" aria-label="縮小 PDF">−</button>'+
      '<input id="pdfZoomSlider" type="range" min="75" max="300" step="5" value="100" aria-label="文件縮放比例">'+
      '<output id="pdfZoomValue" for="pdfZoomSlider">100%</output>'+
      '<button class="btn sm zoom-step" id="pdfZoomIn" title="放大" aria-label="放大 PDF">＋</button>'+
      '<button class="btn sm" id="pdfZoomFit">適合寬度</button></div>';
    viewer.parentNode.insertBefore(bar,viewer);
    bar.querySelector('#pdfZoomOut').onclick=()=>setZoom((app.zoom||1)*100-25,true);
    bar.querySelector('#pdfZoomIn').onclick=()=>setZoom((app.zoom||1)*100+25,true);
    bar.querySelector('#pdfZoomFit').onclick=()=>setZoom(100,true);
    bar.querySelector('#pdfZoomSlider').addEventListener('input',e=>setZoom(e.target.value));
    bar.querySelector('#pdfZoomSlider').addEventListener('change',e=>setZoom(e.target.value,true));
    setZoomLabel(Math.round(app.zoom*100));
    installPinch(viewer);
  }

  function touchDistance(touches) {
    const p=touches[0],q=touches[1];
    return Math.hypot(p.clientX-q.clientX,p.clientY-q.clientY);
  }

  function installPinch(viewer) {
    if(viewer.dataset.pinchReady==='yes') return;
    viewer.dataset.pinchReady='yes';
    // Only capture two-finger gestures. Single-finger scrolling is still native.
    viewer.addEventListener('touchstart',event=>{
      if(event.touches.length!==2) return;
      clearTimeout(zoomTimer);
      const distance=touchDistance(event.touches);
      if(distance<10)return;
      drawingPinch=true;
      pinchInfo={distance,initial:app.zoom||1,percent:Math.round((app.zoom||1)*100)};
      event.preventDefault();
    },{passive:false});
    viewer.addEventListener('touchmove',event=>{
      if(!drawingPinch||!pinchInfo||event.touches.length!==2)return;
      event.preventDefault();
      const ratio=touchDistance(event.touches)/pinchInfo.distance;
      const n=limit(Math.round(pinchInfo.initial*ratio*100),MIN_ZOOM,MAX_ZOOM);
      pinchInfo.percent=n;
      setZoomLabel(n);
      // Scale the page + annotations together while fingers move.
      // Final PDF.js render is done once fingers lift (not every gesture frame).
      const wrap=document.querySelector('#pageWrap');
      if(wrap){
        wrap.style.transformOrigin='top center';
        wrap.style.transform='scale('+(n/100/pinchInfo.initial)+')';
      }
    },{passive:false});
    const finish=()=>{
      if(!drawingPinch||!pinchInfo)return;
      const n=pinchInfo.percent;
      drawingPinch=false;
      pinchInfo=null;
      const wrap=document.querySelector('#pageWrap');
      if(wrap)wrap.style.transform='';
      setZoom(n,true);
    };
    viewer.addEventListener('touchend',event=>{
      if(drawingPinch&&event.touches.length<2)finish();
    },{passive:false});
    viewer.addEventListener('touchcancel',finish,{passive:false});
  }

  renderWork = function renderWorkWithZoom() {
    oldRenderWork();
    if(app.tool==='edit' && app.files?.length) addZoomToolbar();
  };

  // Typography controls: replace numeric input with a genuine touch-friendly range
  // slider, and provide a native font picker + live font sample.
  editorProperties = function editorPropertiesWithSlider() {
    oldEditorProperties();
    const a=selectedAnn();
    const sizeInput=document.querySelector('#txtSize');
    const picker=document.querySelector('#txtFont');
    if(!a||a.kind!=='text'||!sizeInput||!picker)return;
    const field=sizeInput.closest('.field');
    if(field){
      field.classList.add('font-size-field');
      field.style.flex='1 1 100%';
      const label=field.querySelector('label');
      if(label)label.textContent='文字大小（滑動調整）';
      const row=document.createElement('div');
      row.className='font-size-control';
      row.innerHTML='<button class="btn sm font-step" id="fontSizeMinus" type="button" aria-label="字體縮小">A−</button>'+
        '<input id="txtSize" class="font-size-range" type="range" min="6" max="96" step="1" value="'+limit(Number(a.size)||14,6,96)+'" aria-label="滑動調整字體大小">'+
        '<button class="btn sm font-step" id="fontSizePlus" type="button" aria-label="字體放大">A＋</button>'+
        '<output id="fontSizeOutput" for="txtSize">'+(Number(a.size)||14)+' pt</output>';
      sizeInput.replaceWith(row);
      const slider=row.querySelector('#txtSize');
      let didSnapshot=false, originalSize=Number(a.size)||14;
      const selectedId=a.id;
      function updateFontSize(value) {
        const target=app.ann.find(item=>item.id===selectedId);
        if(!target||target.kind!=='text')return;
        const n=limit(Number(value)||14,6,96);
        if(!didSnapshot&&n!==originalSize) { snapshot(); didSnapshot=true; }
        target.size=n;
        row.querySelector('#fontSizeOutput').textContent=n+' pt';
        slider.value=String(n);
        if(app.selected===selectedId) renderAnnotations();
      }
      slider.addEventListener('input',e=>updateFontSize(e.target.value));
      row.querySelector('#fontSizeMinus').onclick=()=>updateFontSize(Number(slider.value)-1);
      row.querySelector('#fontSizePlus').onclick=()=>updateFontSize(Number(slider.value)+1);
    }

    const fontField=picker.closest('.field');
    if(fontField){
      fontField.classList.add('font-picker-field');
      const preview=document.createElement('div');
      preview.id='fontLivePreview';
      preview.className='font-live-preview';
      preview.innerHTML='<span class="small">字體樣式預覽</span><strong id="fontLiveSample">中文字型 Aa 123</strong>';
      fontField.append(preview);
      function previewFont() {
        const p=document.querySelector('#fontLiveSample');
        const val=picker.value;
        const css={
          NotoSansTC:'"PdfNotoSansTC", "PingFang TC", sans-serif',
          NotoSerifTC:'"PdfNotoSerifTC", "Noto Serif TC", serif',
          Helvetica:'Arial, sans-serif',
          Times:'"Times New Roman", serif',
          UploadedFont:'"PdfUserFont", "PingFang TC", sans-serif',
        };
        if(!p)return;
        p.style.fontFamily=css[val]||css.NotoSansTC;
        p.style.fontWeight=selectedAnn()?.weight||'normal';
      }
      picker.addEventListener('change',previewFont);
      previewFont();
    }
  };

  // Reset zoom on new PDF selection to avoid an unexpectedly oversized document.
  const originalStartTool = startTool;
  startTool = async function startToolWithZoom(tool) {
    if(tool==='edit')app.zoom=1;
    clearTimeout(zoomTimer);
    return originalStartTool(tool);
  };
})();
