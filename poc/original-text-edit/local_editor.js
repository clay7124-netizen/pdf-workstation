
(()=>{"use strict";
const $=id=>document.getElementById(id);
let file=null,doc=null,page=1, rendering=0;
const worker='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
pdfjsLib.GlobalWorkerOptions.workerSrc=worker;
const status=(message,kind)=>{$("status").textContent=message;$("status").className=kind||"info"};
const invalidate=()=>{$("apply").disabled=true;$("status").className="info"};
$("original").addEventListener("input",invalidate);
$("replacement").addEventListener("input",invalidate);
$("pdfFile").addEventListener("change",async()=>{
 file=$("pdfFile").files?.[0];doc=null;page=1;invalidate();
 $("original").value="";$("replacement").value="";
 if(!file)return;
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  doc=await pdfjsLib.getDocument({data:bytes,isEvalSupported:false}).promise;
  await showPage();status("已載入，可選取要修改的原始文字。");
 }catch(e){status("無法讀取這份 PDF："+e.message,"info error");}
});
const showPage=async()=>{
 if(!doc)return;const current=++rendering;const p=await doc.getPage(page);
 const initial=p.getViewport({scale:1});
 const width=Math.max(220,Math.min(innerWidth-55,700))*Number($("scale").value)/100;
 const view=p.getViewport({scale:width/initial.width});
 const canvas=$("pageCanvas"),ctx=canvas.getContext("2d");
 canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
 canvas.style.width=canvas.width+"px";canvas.style.height=canvas.height+"px";
 const stage=$("stage");stage.style.width=canvas.width+"px";stage.style.height=canvas.height+"px";
 await p.render({canvasContext:ctx,viewport:view}).promise;
 if(current!==rendering)return;
 const overlay=$("textOverlay");overlay.replaceChildren();
 const tc=await p.getTextContent();
 for(const item of tc.items){
  if(!item.str?.trim())continue;
  const t=pdfjsLib.Util.transform(view.transform,item.transform);
  const h=Math.max(9,Math.hypot(t[2],t[3]));
  const b=document.createElement("button");b.className="hit";b.type="button";
  b.style.left=t[4]+"px";b.style.top=(t[5]-h)+"px";
  b.style.width=Math.max(9,item.width*view.scale)+"px";b.style.height=h+"px";
  b.setAttribute("aria-label","選取 PDF 文字："+item.str);
  b.onclick=()=>{overlay.querySelectorAll(".hit").forEach(n=>n.classList.remove("selected"));b.classList.add("selected");
   $("original").value=item.str;$("replacement").value=item.str;$("apply").disabled=true;
   $("replacement").focus();status("已選取原文："+item.str+"。請修改下方內容，然後進行格式檢查。")};
  overlay.append(b);
 }
 $("pageNumber").textContent=page+" / "+doc.numPages;
 $("previous").disabled=page===1;$("next").disabled=page===doc.numPages;
};
$("previous").onclick=()=>{if(page>1){page--;void showPage()}};
$("next").onclick=()=>{if(doc&&page<doc.numPages){page++;void showPage()}};
$("scale").addEventListener("input",()=>{$("zoomLabel").textContent=$("scale").value+"%";void showPage()});
async function submit(route){
 if(!file){status("請先選擇 PDF","info error");return}
 const form=new FormData();form.append("file",file);form.append("original",$("original").value);
 form.append("replacement",$("replacement").value);
 const response=await fetch(route,{method:"POST",body:form,cache:"no-store"});
 if(route==="/api/apply"&&response.ok){
  const blob=await response.blob();const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=file.name.replace(/\.pdf$/i,"")+"_edited.pdf";
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  status("已另存新 PDF。原文件保持不變；仍請核對修改後的版面。","info success");return;
 }
 const result=await response.json();status(result.message+(result.details?"\n"+JSON.stringify(result.details):""),result.allowed?"info success":"info error");
 $("apply").disabled=!result.allowed||route==="/api/apply";
}
$("check").onclick=async()=>{try{await submit("/api/preflight")}catch(e){status("本機服務錯誤："+e.message,"info error")}};
$("apply").onclick=async()=>{try{await submit("/api/apply")}catch(e){status("修改失敗："+e.message,"info error")}};
})();
