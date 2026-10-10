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
