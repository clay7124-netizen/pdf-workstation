# 私人 Cloud Run Beta 部署說明（需人工授權，預設不公開）

> **這不是現在已部署的網站。** 正式 GitHub Pages 保持不變。
>
> 適用：具有 Google Cloud Console／Billing 管理權限的人。僅用合成 PDF 先驗證。
> IAP 直接整合 Cloud Run 正式可用，且本身通常無額外費用；
> Cloud Run 有每月免費額度，但啟用帳單仍可能有費用。
> 台灣區域代碼：\`asia-east1\`（Tier 1）。避免預設建立資料庫、Persistent Disk、Load Balancer、VPC Connector。

## 0. 費用與帳單安全（操作前）

1. 新增一個專用 Google Cloud 專案，不使用已有的工作或公司專案。
2. 確認有可以啟用 Billing 的帳戶；**不需把信用卡、密碼、API key 提供給 ChatGPT**。
3. 先設定 Billing 預算通知（例：US$1、US$5）及如帳戶支援的「Cloud Run Budget spend caps」（預覽功能）；預算通知本身不是硬上限。
4. \`--min-instances=0 --max-instances=1 --concurrency=1\` 限制運算耗用；仍可能有圖片儲存、網路輸出及建置費用。

## 1. 容器打包（不會上傳使用者 PDF）

從本專案 Cloud Shell 或電腦 Git clone 專案的測試分支，切到
\`feature/cloud-private-original-editor\`，並建立專用 Artifact Registry repository。

\`\`\`bash
export PROJECT_ID="YOUR_GOOGLE_CLOUD_PROJECT_ID"
export REGION="asia-east1"
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iap.googleapis.com
gcloud artifacts repositories create pdf-workstation --repository-format=docker \
  --location="$REGION" --description="Private PDF editor research images"
gcloud builds submit . --config poc/original-text-edit/cloudbuild.private.yaml
\`\`\`

上面只建立**程式碼鏡像**，不進行可公開服務的部署。

## 2. IAP 限制登入

\`gcloud run deploy\` 使用 \`--iap --no-allow-unauthenticated\`，但初次設定 IAP（尤其個人、無 Google Cloud Organization 的專案）可能必須透過 Cloud Run Console 完成 OAuth 設定。請在 Cloud Run → Security 確認 **Require authentication → IAP**，只授權測試用 Google 帳號，並確認未開放 \`allUsers\`。

同源 IAP 保護前端和 PDF POST API，避免跨來源 CORS、第三方直接呼叫未驗證 API。

## 3. Cloud Run 服務參數（不可在設定前開放測試文件）

預計服務：\`pdf-original-private\`。
- 1 CPU / 1 GiB RAM（若實測不足再評估，勿直接升高）
- 請求逾時 60 秒、同時只處理 1 個請求、最低執行個體數 0、最高 1
- 不裝載永久磁碟、不建立資料庫
- 使用只有最低權限的獨立 Service Account（不能有管理 Storage、Gmail 或 Drive 的權限）
- Runtime 環境變數：
  - \`IAP_AUDIENCE=/projects/PROJECT_NUMBER/locations/asia-east1/services/pdf-original-private\`（PROJECT_NUMBER 是**數字**）
  - \`IAP_ALLOWED_EMAILS=\` 指定測試帳號，不用提交至 GitHub
  - \`APP_ORIGIN=https://\` 此服務真正的 Cloud Run HTTPS 網址（從 Deploy 回報取得後再設定）
- **缺任何必要設定，後端必須拒絕服務（503）**。

建置後可先部署在關閉存取的私有環境，再於 Cloud Run Console 完成 IAP、帳號 allowlist 與環境變數。後端直到設定完成，不會受理 PDF。

## 4. 雲端驗證與禁止公開條件

開始只能上傳 GitHub 測試程式產生的「合成、沒有隱私」PDF：

1. 未登入：被 IAP 攔截
2. 非 allowlist 帳號：被 IAP 攔截；偽造 JWT → 403
3. 未帶正確 \`X-PDF-Action\`：403；跨網站 Origin：403
4. 8 MB 大小、PDF 副檔名與檔頭、合法字型等：依政策拒絕或允許
5. 真正中文原文修改、缺字拒絕、原檔不覆蓋、PDF 可搜尋、逐頁視覺比對
6. 查看應用程式沒有輸出檔案／內容到 GCS、GitHub、Cloud Logging；仍可能有平台**中繼資料**
7. 壓力測試、惡意 PDF 模糊測試、依賴套件 CVE 掃描、容器端外連監控；**未通過則不開放任何真實客戶機密文件**

## 目前需使用者明確執行或授權的事項

- 是否願意開立**獨立的 Google Cloud 專案**並啟用 Billing（不能保證帳單為零）
- 選擇一個允許登入測試版的 Google 帳號
- Cloud Run／IAP 首次設定要由 Google Cloud 擁有者操作

目前沒有 Google Cloud 帳號存取憑證，本專案亦**沒有執行部署**。
