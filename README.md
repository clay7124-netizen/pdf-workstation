# PDF 工作台｜v0.2 手機測試版

以 iPhone Safari 為優先的本機 PDF 編輯網站，無需登入、無伺服器上傳。純靜態 HTML 與 JavaScript，使用 pdf-lib、PDF.js、@pdf-lib/fontkit（依賴從 CDN 載入，尚不支援離線）。

## 網址
https://clay7124-netizen.github.io/pdf-workstation/

## 測試功能（尚待 iPhone 實機驗證）
- PDF 合併與分割
- 頁面排序、刪除、旋轉
- JPG/PNG 轉 PDF
- 新增文字、圖片、簽名，於自己新增的文字框套用格式刷
- 儲存與分享匯出的 PDF

## 限制
- **不支援真正修改 PDF 原有文字**，亦不支援原文字型精確繼承、原始文字格式刷、Office 轉檔與 OCR。
- 新增中文可能需要從外部下載合法開源字型，並可能增加檔案大小；不保證與 PDF 原文字型相同。
- 來源 PDF 已旋轉時新增標註未經完整驗證。已加密或已簽章的 PDF 也未保證可用。
- iPhone Safari 端到端測試未完成。建議先使用不含個資的測試 PDF。

## GitHub Pages 設定
Settings → Pages → Build and deployment → Source = **GitHub Actions**。部署工作流程位於 `.github/workflows/pages.yml`，main 有提交時會觸發。若第一次部署失敗，先確認 Pages Source，然後到 Actions 重新執行。

第三方授權：pdf-lib / fontkit 為 MIT；PDF.js 為 Apache-2.0；Noto Sans TC 為 SIL OFL 1.1。
