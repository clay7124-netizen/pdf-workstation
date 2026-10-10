# PDF 工作台 v0.6｜手機優先、本機 PDF 工具

線上使用：https://clay7124-netizen.github.io/pdf-workstation/

## 已可試用並通過瀏覽器自動測試的功能
- 合併 PDF（來源檔逐頁預覽及放大）、分割 PDF、排序／刪除／旋轉頁面。
- JPG/PNG 轉 PDF，支援 EXIF 方向校正及手動旋轉。
- 在原 PDF 上新增文字、簽名和圖片，調整位置，儲存新 PDF（原文不會被覆蓋）。
- 新增文字可用思源黑體／思源宋體、上傳合法 TTF/OTF，自訂顏色、字號滑桿、格式刷（只適用自己新增的文字框）。
- PDF 編輯支援雙指縮放、滑桿縮放、取樣附近文字字號（**不保證完全沿用原始字型**）。
- **v0.6 新增 Office 基本轉檔**：DOCX、XLSX → 文字可選取的 PDF；手機可預覽 Word 段落及 Excel 工作表，無需上傳使用者文件。

## Office 轉檔的明確限制
Word 使用 Mammoth 解析語義結構；Excel 使用 ExcelJS 解析儲存格；PDF 由 pdf-lib 重新排版，因此與 Office 原生輸出有差異：
- Word：一般段落、標題、清單及簡單表格支援。圖片、複雜欄位、分頁、頁首頁尾及藝術字等不保證保留。
- Excel：工作表儲存格內容與基本格線表格；圖表、合併儲存格、列印版面、條件格式、樞紐分析、公式重新計算不保證保留。
- 目前最多 15 MB 文件、15 張工作表、18 欄、2400 列；仍須確認輸出的 PDF。
- 僅支援 .docx、.xlsx，不支援 .doc、.xls 或 PDF → Office。
- 含嵌入字型不支援的文字或符號時會報錯，不會默默替換。
- 不做雲端文件上傳；但 JavaScript 依賴和開源中文字型首次載入需要網路，**尚不支援離線**。

## 核心未完成
- **真正修改 PDF 原有文字、維持相同字型／字距、原文字格式刷**：仍在專業引擎驗證階段。不可用新增標註或白色覆蓋冒充原文編輯。
- PDF → Word、PDF → Excel、OCR、Office 版面百分之百還原、真正遮蔽敏感資料：尚未支援。
- 已簽章／加密 PDF 及 Safari iPhone 實機仍需擴充測試。

## 專案與部署
無後端純靜態 GitHub Pages：
- `index.html`：主介面和 PDF 處理
- `enhancements.js`、`typography-v04.js`、`zoom-v05.js`：預覽、字型、縮放
- `office-v06.js`：Office 本機轉 PDF
- `.github/workflows/pages.yml`：自動部署
- `.github/workflows/smoke.yml`：Playwright 模擬手機測試，包括真實 DOCX、XLSX → PDF

使用的開源依賴：pdf-lib、@pdf-lib/fontkit（MIT）；PDF.js（Apache-2.0）；Mammoth（BSD-2-Clause）；ExcelJS（MIT）；Noto Sans TC 與 Noto Serif TC（SIL OFL）。
