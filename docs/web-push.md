# 推播通知 Web Push

第一階段第 10 步：App 只在**需要你做決定**時推播到手機與 Mac，不推播價格波動：

- **新提案**：規則觸發時（例如 R1 減碼、每月投入），推播寫出是哪條規則、建議做什麼；點開直接到那份提案。
- **每週檢視**：預設每週日晚上 8 點（台北時間），三行摘要：規則狀態、最大偏離、市值與本週變化；點開是儀表板首頁。
- **資料異常**：每夜價格排程連續失敗 2 晚時通知一次。
- **安靜時段**：預設 23:00–08:00 不推播，期間產生的推播會在 08:00 後送出。

Phase 1, step 10: the app pushes a new proposal, the weekly review's three lines, or a data failure, never a price move; quiet hours hold pushes until they end. This page sets it up once.

## 它怎麼運作 How it works

- **誰送出推播**：GitHub Actions 上的兩個排程。每夜價格排程跑完後會馬上送出新提案的推播；另一個「Pushes 推播」排程**每小時第 7 分鐘**執行一次，負責每週檢視、安靜時段結束後補送，以及資料異常警示。兩者都是 `scripts/notify.ts`。
- **每則推播只送一次**：資料庫的 `notifications` 表同時是「待送清單」與「紀錄」。同一份提案、同一週、同一段連續失敗只會推播一次。App 的「推播」頁列出最近的推播。
- **加密**：推播內容以每台裝置自己的金鑰加密，只有那台裝置讀得到；並以 App 的 VAPID 金鑰簽名，讓 Apple、Google 的推播服務知道是這個 App 送的。
- **iPhone 的限制**：iPhone 和 iPad 只有在 App **加到主畫面**、並從主畫面圖示打開時，才能開啟推播（iOS 16.4 以上）。Safari 分頁裡不行。

## 設定步驟 Setup（只需一次，約 15 分鐘）

先完成這次 PR 說明裡的 `git pull`、`npm install` 與 `npx supabase db push`。

### 1. 產生 VAPID 金鑰 Make the VAPID keys

在 Mac 的「終端機」，進入 `invest` 資料夾，執行：

```bash
npm run vapid-keys
```

畫面會印出兩行（每次執行都會產生**新的**一組，請只執行一次）：

```text
VAPID_PUBLIC_KEY=B...（很長的一串）
VAPID_PRIVATE_KEY=...（較短的一串）
```

- `PUBLIC`（公開金鑰）不是秘密，手機會用它來訂閱推播。
- `PRIVATE`（私鑰）**必須保密**：只貼到下面三個地方，不要貼到聊天、email 或 repo 裡。
- 終端機視窗先不要關，接下來要複製這兩個值。

再準備一個聯絡信箱，格式是 `mailto:你的email`，例如 `mailto:you@example.com`。推播服務只有在出問題時才可能用到它，不會公開。下面稱為 **VAPID_SUBJECT**。

### 2. 放進 Vercel（讓 App 能開啟推播與送測試推播）

1. 打開 <https://vercel.com> → 你的專案 `long-view-invest` → **Settings → Environment Variables**。
2. 新增三個（Environments 三個都勾：Production、Preview、Development）：

   | Key | Value | 說明 |
   | --- | --- | --- |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | 第 1 步的 `VAPID_PUBLIC_KEY` 那一串 | 公開金鑰 |
   | `VAPID_PRIVATE_KEY` | 第 1 步的 `VAPID_PRIVATE_KEY` 那一串 | 私鑰：新增時打開 **Sensitive** |
   | `VAPID_SUBJECT` | `mailto:你的email` | 聯絡信箱 |

3. 到 **Deployments** → 最新一筆右邊的「⋯」→ **Redeploy**。公開金鑰是在部署時放進網頁裡的，所以一定要重新部署才會生效。

### 3. 放進 GitHub secrets（讓排程能送出推播）

1. 打開 <https://github.com/GoatC/Invest> → **Settings → Secrets and variables → Actions** → **New repository secret**。
2. 新增三個（和設定每夜排程時一樣的地方）：

   | Name | Secret |
   | --- | --- |
   | `VAPID_PUBLIC_KEY` | 第 1 步的公開金鑰 |
   | `VAPID_PRIVATE_KEY` | 第 1 步的私鑰 |
   | `VAPID_SUBJECT` | `mailto:你的email` |

### 4. 本機也要用的話：.env.local（選做）

想在 Mac 上用 `npm run dev` 試推播，就在 `invest` 資料夾執行 `open -e .env.local`，在檔案最後加上四行，然後存檔：

```text
NEXT_PUBLIC_VAPID_PUBLIC_KEY=（公開金鑰）
VAPID_PUBLIC_KEY=（公開金鑰）
VAPID_PRIVATE_KEY=（私鑰）
VAPID_SUBJECT=mailto:你的email
```

`.env.local` 不會進 git（已在 `.gitignore`）。

### 5. 在手機開啟推播 Turn it on on your phone

1. **iPhone**：如果還沒加到主畫面，先用 Safari 打開網址 → 「分享」→「加入主畫面」（見 [部署到 Vercel](deploy-vercel.md) 第 5 步）。之後一律**從主畫面的圖示**打開。
2. 打開 App → 首頁「本週」右上角的 **推播設定**。
3. 按 **在這台裝置開啟推播** → 系統問「允許通知嗎？」→ **允許**。
4. 下方「裝置」會出現這台手機。按 **傳送測試推播到所有裝置**，一分鐘內手機應該收到「Test 測試推播」。
5. Mac 也想收：用 Safari 或 Chrome 打開網址並登入，同樣按「在這台裝置開啟推播」。

### 6. 設定推播時間

在同一頁「推播時間」：

- **安靜時段**：預設 23:00 到 08:00。
- **每週檢視**：預設週日 20:00。規格書第 9 節列為待決問題，請選你方便的時間。

都是台北時間；推播排程每小時第 7 分鐘執行，所以 20:00 的每週檢視約在 20:07 送出。

### 7. 確認排程

GitHub 的 **Actions** 分頁會多一個 **Pushes 推播**，每小時自動執行。想立刻試一次：選它 → **Run workflow** → 綠色勾勾＝成功。紀錄只寫數量，例如「Web Push: 1 planned, 1 sent」，不會寫推播內容。

## 問題排除 Troubleshooting

| 看到的情況 | 原因與處理 |
| --- | --- |
| 推播頁寫「iPhone 或 iPad 需要先把 App 加入主畫面」 | 你是在 Safari 分頁打開的。改從主畫面的圖示打開 |
| 推播頁寫「VAPID 公開金鑰尚未設定」 | Vercel 少了 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`，或加了但還沒 Redeploy |
| 按測試後寫「App 還不能送出推播：缺少 …」 | Vercel 少了 `VAPID_PRIVATE_KEY` 或 `VAPID_SUBJECT`（要以 `mailto:` 開頭），補上後 Redeploy |
| 推播頁寫「通知已被封鎖」 | 之前按了「不允許」。iPhone：設定 → 通知 → 長期投資 → 允許通知；Mac Safari：設定 → 網站 → 通知 |
| Actions 的 Pushes 紀錄寫「Web Push is not set up yet: missing …」 | GitHub secrets 少了列出的那幾個（第 3 步） |
| 測試推播寫已送出，但手機沒收到 | 手機的「專注模式」或通知設定擋住了；或 App 在前景時有些手機不顯示。關掉 App 再試一次 |
| 換了一組 VAPID 金鑰 | 舊的訂閱會失效：每台裝置都要到推播頁重新按一次「開啟推播」 |
| 某台裝置不再收到推播 | 推播頁「裝置」那一列會寫出最近一次失敗的原因；推播服務回報裝置已取消時，App 會自動移除它，重新開啟即可 |
