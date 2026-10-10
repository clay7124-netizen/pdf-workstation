# PDF 工作台｜私人雲端原文字編輯安全設計（僅供測試）

**狀態：尚未部署；不可處理真實醫療／客戶／公司機密檔案。**

## 目標架構
- 前端：私有 Cloud Run 同來源頁面，PDF.js 在使用者手機顯示預覽、觸控選字
- 身分保護：Cloud Run **直接啟用 IAP** + 指定使用者 allowlist；後端每次再次驗證 Google 簽署 \`X-Goog-IAP-JWT-Assertion\`（ES256、aud、iss、iat/exp、email）
- 運算：Python 3.12、pdf-edit-engine，必要時只修改既有 PDF 的內容文字指令
- 限制：8 MB PDF、12 頁、300 字輸入、同字數、唯一匹配、原字型有新字、無其他編輯區像素變動才輸出
- 同源操作：\`X-PDF-Action: 1\` 及 Origin 精確比對，不提供跨來源 CORS
- 原檔：永遠只讀；成功後下載新 PDF，不覆蓋原檔

## 每次請求的檔案生命週期
1. HTTPS 到 IAP，IAP 通過後才進入 Cloud Run。主機再次驗證簽署 JWT
2. 逐塊收取請求，總大小上限約 8 MB；multipart 解析後只接受 PDF
3. 程式將 PDF 寫入單次請求專屬的 \`/tmp/pdf-private-*\`，Cloud Run 容器的預設可寫磁碟為 **RAM-backed**（不是永久磁碟）
4. 單次短命子程序處理，不呼叫外部文件 API，限制 CPU 25 秒、記憶體位址空間、可輸出檔案上限；伺服器呼叫逾時 35 秒
5. 引擎進行 dry-run；修改後須確認文字、原字型、可搜尋、頁數、逐頁 PDFium 影像差異；無法符合即拒絕
6. HTTP 回覆前讀取輸出，\`TemporaryDirectory\` 正常離開即清理 input/output；不寫 GCS、Dropbox、Google Drive、資料庫或瀏覽歷史
7. 伺服器回覆 \`Cache-Control: no-store\`，關閉 Uvicorn access log；\`Content-Disposition\` 固定檔名，不把上傳檔名放入 URL 或應用 log

## 無法保證的事（明確列出）
- **雲端平台的基礎設施仍可能記錄請求時間、來源 IP、HTTP 狀態、流量和 IAP 帳號資訊**；「不保留檔案」不等於完全沒有中繼資料
- 正常完成與有捕獲的錯誤會清理暫存；**OOM、強制終止、主機當機後，不可保證有不可逆的即時安全抹除**。容器停止時 RAM-backed 檔案會消失
- 本地合成檔測試還**不足以證明外部惡意 PDF 安全**；第三方 PDF 解析器／原生函式庫仍可能有漏洞
- 目前工作子程序可透過容器網路介面發出連線；若解析器存在可遠端執行程式碼漏洞，仍有外洩風險。上真實機密文件前需加入嚴格網路 egress 控管與專業滲透測試
- IAP 實際簽署 JWT 驗證在 GitHub CI 使用 mock；需於私人 Cloud Run 部署後再做真正 IAP 驗證、未授權帳號拒絕及登出測試
- 無法支援掃描 PDF、受保護 PDF、數位簽章或確保每一種 PDF 字型都可保真
- Google Cloud 帳單需要啟用且可能有超額費用；即使設定預算警示，也**不是**絕對硬性成本上限

## 正式使用前仍需完成的安全門檻
- [x] 身分憑證簽章檢查＋帳號 allowlist（mock 策略測試）
- [x] 完整文件大小、來源與類型限制
- [x] 暫存清理、不可覆蓋原檔、不可偷偷換字型、異常拒絕
- [x] 合成繁中 PDF 原文修改與影像差異測試
- [ ] 真實 Google Cloud IAP 簽章驗證＋權限測試
- [ ] 封包攔截與外連限制；檢查 PDF/文字是否可能流向未批准的主機
- [ ] 依賴程式庫 CVE 掃描、容器鏡像掃描、濫用壓力測試
- [ ] 測試執行個體異常中斷的資料殘留處理
- [ ] 合規及敏感資料存取／保存政策審查
- [ ] 用使用者自行製作、無個資的 PDF 在 iPhone Safari 手動驗收

## 不會做的事情
- 不會讓 GitHub Actions 讀取真實客戶 PDF
- 不會將上傳的 PDF 放在 GitHub repository、Actions artifact 或 Logs
- 不會設定「允許未經驗證的存取」
- 不會偷偷打開公開轉換 API
- 不會宣稱使用不同字型也算保留原本格式
