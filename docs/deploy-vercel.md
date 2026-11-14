# 部署到 Vercel Deploy to Vercel

讓 App 在網路上有一個固定網址，手機也能打開，加到主畫面後就像一個 App。第 10 步的推播需要這一步（PRD 第 9 節）。

Put the app online at a fixed address, so a phone can open it and add it to its home screen; Web Push in step 10 needs this.

## 先了解 Before you start

- **網址公開，資料不公開**：任何人都打得開登入頁，但只有你的帳號能登入，而且已經關閉註冊；資料庫的 row-level security 會擋掉其他人（`npm run check:supabase` 驗證的就是這件事）。網頁也設定成不讓搜尋引擎收錄。
- **Vercel 只放網頁程式**，資料仍然在 Supabase。本機的 `npm run dev` 照樣能用，兩邊連的是同一個資料庫。
- **Vercel 只需要兩個公開的值**：Supabase 網址和 publishable key。**secret key 絕對不要放到 Vercel**，網頁用不到它。
- **費用**：Vercel 的 Hobby 方案免費，供個人、非商業使用。
- **之後會自動更新**：每次合併 PR 到 `main`，Vercel 會自動重新部署（約 1–2 分鐘）。Claude 工作中的分支（`claude/` 開頭）不會部署，設定在 `vercel.json`。

The site is public but the data is not: only your account can sign in, and row-level security refuses everyone else. Vercel gets the two public values only, never the secret key.

## 1. 建立 Vercel 帳號 Create a Vercel account（只需一次）

1. 打開 <https://vercel.com/signup>。
2. 方案選 **Hobby**（個人使用），名稱填你自己的名字。
3. 選 **Continue with GitHub**，用你的 GitHub 帳號登入，並同意授權。

## 2. 匯入 repo 並部署 Import the repository and deploy

1. 在 Vercel 首頁按 **Add New… → Project**。
2. 在 **Import Git Repository** 清單找到 `GoatC/invest`，按 **Import**。清單裡沒有的話，按 **Adjust GitHub App Permissions**，允許 Vercel 讀取這個 repo，再回來。
3. **Project Name** 改成 `long-view-invest`。網址會是 `long-view-invest.vercel.app`；這個名字被用走時，換一個，例如加上你的名字。
4. **Framework Preset** 應該自動顯示 **Next.js**。Root Directory、Build Command 都不用改。
5. 展開 **Environment Variables**，新增兩個。值從 Mac 上的 `.env.local` 複製（在 `invest` 資料夾執行 `open -e .env.local` 打開）：

   | Key | Value | Type |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Config |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Config |

   Vercel 要你選 **Type** 時選 **Config**：名稱以 `NEXT_PUBLIC_` 開頭的值會放進網頁，本來就是公開的（publishable key 有資料庫的權限規則保護）。選 Secret 時 Vercel 會提醒你改成 Config。

   不要加 `SUPABASE_SECRET_KEY`、`FINMIND_TOKEN` 或其他金鑰：網頁用不到，放在這裡只會多一個外洩的地方。第 10 步的推播另外需要三個 VAPID 值，設定方式見 [推播通知](web-push.md)；「更新最新資料」按鈕需要的 `GITHUB_DISPATCH_TOKEN`（選用，只能啟動排程）見 [每夜排程第 6 步](nightly-job.md)。
6. 如果接著出現 **Optional Integrations**（例如 Supabase 旁邊有 **Add** 按鈕）：**不要按 Add**，直接按 **Deploy**。你已經有自己的 Supabase 專案；這個整合會另外建立或連接一個資料庫，並把 secret key 等金鑰自動放進 Vercel。
7. 按 **Deploy**，等 1–2 分鐘，出現恭喜畫面就完成了。

Import `GoatC/invest`, name the project `long-view-invest`, add the two `NEXT_PUBLIC_` values from `.env.local`, skip the optional Supabase integration, and deploy.

## 3. 把網址告訴 Supabase Tell Supabase the address

1. 按 **Continue to Dashboard**，在 **Domains** 看到網址，例如 `https://long-view-invest.vercel.app`。
2. 打開 Supabase 專案 → **Authentication → URL Configuration** → **Site URL** 改成這個網址 → **Save changes**。

App 用 email 和密碼登入，不改這個也能登入；改了之後，Supabase 寄出的信（例如重設密碼）會指向你的網站，而不是 `localhost`。

## 4. 用電腦試一次 Try it on the computer

打開網址 → 出現登入頁 → 用你的帳號登入 → 看得到儀表板首頁和「資料狀態」頁，就成功了。

## 5. 加到手機主畫面 Add it to your phone's home screen

- **iPhone**：請用 **Safari**。打開網址並登入 → 按下方的「分享」按鈕 → 選「加入主畫面」→ 名稱會是「長期投資」→ 按「加入」。之後從主畫面的圖示打開，就像一個 App，沒有網址列。
- **Android**：用 **Chrome** 打開網址並登入 → 右上角選單 → 「安裝應用程式」或「加到主畫面」。

On an iPhone, use Safari's Share → Add to Home Screen; on Android, Chrome's menu → Install app.

**啟動圖（2026-11-13 起）**：iPhone 在「加入主畫面」的當下就把啟動圖（點圖示後第一眼看到的畫面，主色底加上 App 標誌）存起來。在這之前就加入主畫面的話，圖示打開時仍是空白畫面一閃而過，之後才出現含標誌的啟動畫面；想要從第一眼就有標誌，要把主畫面的圖示刪掉再加入一次。**刪除圖示會一併清掉登入狀態與推播設定**，重新加入後要再登入一次，並到「推播」頁重新按「開啟推播」（見 [推播通知](web-push.md)）。不重新加入也可以，其他功能不受影響。

An iPhone saves the launch image (the mark on the accent colour) on the day the app is added to the home screen. An icon added before 2026-11-13 opens on a blank screen for a moment; to get the launch image, delete the icon and add it again, which also signs you out and turns push off on that phone (sign in and turn push on again).

## 之後 Later updates

- 合併 PR 之後，網站會自動更新，你不用在 Vercel 做任何事。
- **PR 說明裡有資料庫變更時**（「`db push` 會列出 N 個新的 migration」），合併後馬上在 Mac 上執行：

  ```bash
  git checkout main && git pull
  npx supabase db push
  ```

  Vercel 不會幫你改資料庫。在你執行 `db push` 之前，網站可能會短暫顯示「無法從資料庫讀取」，執行後重新整理就好。

Merging to `main` redeploys the site by itself; when a PR changes the database, run `npx supabase db push` right after merging.

## 速度 Speed

- **伺服器在東京**：`vercel.json` 的 `"regions": ["hnd1"]` 讓 Vercel 在東京執行網頁程式，和 Supabase 專案（Northeast Asia (Tokyo)）在同一個地區。沒有這一行時 Vercel 預設在美國華盛頓執行，每一次讀資料庫都要橫越太平洋來回一趟（約 150 毫秒），一頁要讀好幾輪就慢了一兩秒。合併後下一次部署自動生效，不用在 Vercel 設定；Hobby 方案可以選一個地區。若你的 Supabase 不在東京，請告訴 Claude 改成最近的地區代號。
- **（選用）登入驗證不必連線**：Supabase → **Project Settings → JWT Keys**。若 **Current key** 寫的是 **Legacy JWT secret**，每次換頁伺服器都要問一次 Supabase Auth「這個登入還有效嗎」。按 **Migrate JWT secret**，再按 **Rotate keys** 讓新的 ECC (P-256) key 成為 current，之後驗證在伺服器本機完成、少一次連線。舊的登入在到期（約 1 小時）前仍有效，最多需要重新登入一次。已經是 ECC 或 RSA key 就不用做。

The app runs in Tokyo (`vercel.json` regions `hnd1`), next to the Supabase project, so each database round trip is a few milliseconds rather than a Pacific crossing. Optionally, switch Supabase to asymmetric JWT signing keys so each tap verifies the session locally.

## 問題排除 Troubleshooting

| 看到的情況 | 原因與處理 |
| --- | --- |
| 網站顯示 `Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY…` | 第 2 步的環境變數漏了或名稱打錯。到 Vercel 專案 **Settings → Environment Variables** 補上，再到 **Deployments**，在最新一筆的「⋯」選單按 **Redeploy** |
| 本機登得進去，網站登不進去 | 兩個環境變數的值和 `.env.local` 不一樣，重新複製貼上後 Redeploy |
| 網站顯示「無法從資料庫讀取」 | 最新的資料庫變更還沒套用，在 Mac 上執行 `npx supabase db push` |
| 部署失敗（Deployment failed） | 點進那一筆部署看 **Build Logs**，把紅色的錯誤訊息貼給 Claude |
| iPhone 沒有「加入主畫面」 | 請改用 Safari 打開；LINE 等 App 內建的瀏覽器沒有這個選項 |
