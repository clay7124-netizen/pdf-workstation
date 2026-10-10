# PDF 原始文字編輯 POC（獨立測試分支）

**最新開發優先順序：PDF 內原有文字修改 > 原字型／版面驗證 > 原文格式刷 > Office 轉檔。**

這不是加上一層文字，也不是白色遮蓋，目標是直接修改 PDF Content Stream 中原有文字的指令。原始需求是不改變字型、大小、顏色、字距與未修改的內容；做不到必須中止，不能輸出「看起來差不多」的版本。

候選開源引擎：[AryanBV/pdf-edit-engine](https://github.com/AryanBV/pdf-edit-engine)（MIT、Python 3.12+、pikepdf、fonttools、pdfminer.six）。能回報 `font_preserved`、`overflow_detected`、`degradations`，並支援 `dry_run`。

## 目前驗證範圍
- 使用合成 Latin、繁體中文 PDF，不測試使用者私密文件。
- 文字由「2024 → 2025」替換，確認文字可重新搜尋、原文不殘留。
- 檢查沒有字型替代、文字溢出、其他內容消失或負面 Degradation。
- 每次 GitHub Actions 產生 JSON 報告和 2 份合成編輯 PDF（若該案例可編輯）。
- **通過這兩件並不代表字型所有新字都能修改。** 未來需測試字型 subset 缺字、字數長短不同、粗斜體、全形中文、旋轉文字、簽章、掃描件、密碼保護文件和 PDF 內容精確比較。

## 架構門檻
Python 引擎**不能直接放在 GitHub Pages**：下一步若驗證成功，可考慮在有隱私保護的後端執行，或研究原生 WASM 移植。後端不得預設保存上傳文件，也不能將客戶文件傳入 GitHub Actions 或公共儲存庫。

MVP 原文編輯建議流程：點選原有文字 → 編輯 → 先 dry-run 檢查字型與位置 → 僅在全數符合「原字型一致」時允許輸出；格式刷後續才能支援原文。

## GitHub Actions 實測紀錄（第一輪）
- 英文／數字測試：**通過**。 `2024 → 2025` 的 PDF 原文替換成功，`font_preserved=true`、`overflow_detected=false`，沒有任何 `degradations`。
- 繁體中文測試：**未通過**。使用 Noto Sans TC、ReportLab 建立的合成 PDF，`pdfminer` 能讀到文字，但 `pdf-edit-engine.get_text()` 回傳空字串，所有 `find()` 查詢均為 0 筆。該內嵌字型是 `NotoSansTC-Thin` 子集，編碼被判為 `WinAnsi`。這是內容指令定位／字型解碼的阻礙，不能聲稱繁體中文可用。
- 本測試僅驗證可行性，**還沒有真正修改原文字的手機版 UI**。CI 在繁體中文未通過時應標成失敗，而不是綠燈。

## 第二輪驗證結果（2026-10-10）

已完成 **4 個合成 PDF 的真實原文替換及圖像差異驗證**，GitHub Actions 測試通過：

| 測試 | 結果 | 字型 | 非編輯區域像素差異 |
|---|---|---|---|
| 英文數字 `2024→2025` | PASS | 保留原字型 | 無 |
| ReportLab 單位元組／ToUnicode 中文 `2024年→2025年` | PASS（實驗性修正） | 保留原字型 | 無 |
| FPDF2 Identity-H 中文 `2024年→2025年` | PASS | 保留原字型 | 無 |
| FPDF2 Identity-H 中文 `正常→異常` | PASS | 保留原字型 | 無 |

圖像驗證用 PDFium 將修改前後渲染成 2× 影像，只允許目標字元的實際邊界附近出現像素差異，並驗證原文不殘留、修改後可搜尋、其他文字仍保留。這還不是所有 PDF 的通用保真保證。

**重要限制：** ReportLab 中文修正目前是原型內 monkey patch，將單位元組字型的 `/ToUnicode` 映射納入解碼，**未完成不可信 PDF 的資源限制、惡意字型測試或正式程式碼審查**；不可直接上線。尚未測試不同字數、原字型沒有新字形、旋轉、簽章、多欄、跨行或掃描 PDF。

**下一階段的實際待辦：**
1. 將 `/ToUnicode` 相容性修正實作在可維護、受大小限制的引擎模組，避免原型 monkey patch；加入不可信 PDF 安全測試。
2. 增加繁中缺字、不同字長、混合字型、帶表格及簽章案例，維持「無法一致即拒絕修改」規則。
3. 評估最低成本、安全且自動刪檔的 Python 執行環境。現有 GitHub Pages 為純靜態頁面，**不能直接執行 pikepdf**；不能把任何真實客戶 PDF 上傳到公開 GitHub Actions。
4. 才能接入 iPhone 的「選取原文 → 編輯 → 預先驗證 → 匯出」工具列；沒有確認原字型可用時禁止輸出。

## 第三輪：保守型原文編輯器與手機流程

**GitHub Actions 已通過** 10 項安全閘門、FastAPI 真正 PDF 原文編輯測試，以及模擬手機尺寸的 PDF.js 操作流程。點選 PDF 原文、改字、預檢、另存 PDF、缺字拒絕、縮放都通過測試。

- `strict_adapter.py`：相同字數、唯一匹配、字型原有字元、乾跑（dry-run）且無 degradation 才允許真正原文修改；原 PDF 一律不覆蓋。
- `visual_guard.py`：使用 PDFium 比對各頁修改前後影像。非目標區域有像素差異便拒絕輸出。這是保守檢查，**不保證目標文字內部所有字距都精確一致**。
- `local_server.py` + `local_editor.html` + `local_editor.js`：手機尺寸友善的本機測試介面；傳送 PDF 只到 127.0.0.1 同機 Python 程序，檔案只在暫存目錄處理。
- `test_local_api.py` 與 `test_mobile.mjs`：真實 PDF bytes API 測試、Chrome 模擬手機觸控及 PDF 匯出測試。

### 如何在電腦本機啟動研究介面（非 iPhone 獨立運行）

電腦安裝 Python 3.12+ 後從專案根目錄執行：

```bash
python -m pip install -r poc/original-text-edit/requirements.txt
python -m uvicorn local_server:app --app-dir poc/original-text-edit --host 127.0.0.1 --port 8765
```

同一台電腦打開 `http://127.0.0.1:8765/`。**請勿改成 0.0.0.0 對外開放，也不可拿公司機密文件上傳 GitHub Actions。** 這是尚未經過完整惡意 PDF 安全審查的開發原型。

### 距離正式 iPhone 網站還缺少什麼？

這個 Python 引擎不能在純 GitHub Pages 執行。要在 iPhone Safari 直接用，必須：
1. 找到真正可用且經資源／惡意檔測試的 WebAssembly 本機方案；或
2. 部署**安全的後端運算服務**並清楚告知使用者文件會離開手機，完成端到端隱私、安全與費用評估後再開啟。

目前兩者皆尚未完成；正式網站依舊維持既有的 PDF 合併、註記等功能。原字型新字缺字、不同字數、刪除原字與特殊排版仍被保守拒絕，不能稱為完整的 PDF 原文字編輯器。

### 開發風險

- `proof.py` 中的 simple-font ToUnicode 相容實驗補丁僅供合成 PDF 技術測試。**本機 API 未載入此補丁**，因此只處理開源引擎已原生支援、可通過字型及像素比對的 PDF。
- 假設文件為可選文字 PDF，非 OCR、非含保護密碼、非數位簽章的 PDF。
- 色彩、字體同一性由開源引擎及可見像素比較雙重檢查，但仍未達所有 PDF 的形式驗證。
