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

   | Key | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |

   不要加 `SUPABASE_SECRET_KEY`、`FINMIND_TOKEN` 或其他金鑰：網頁用不到，放在這裡只會多一個外洩的地方。
6. 如果接著出現 **Optional Integrations**（例如 Supabase 旁邊有 **Add** 按鈕）：**不要按 Add**，直接按 **Deploy**。你已經有自己的 Supabase 專案；這個整合會另外建立或連接一個資料庫，並把 secret key 等金鑰自動放進 Vercel。
7. 按 **Deploy**，等 1–2 分鐘，出現恭喜畫面就完成了。

Import `GoatC/invest`, name the project `long-view-invest`, add the two `NEXT_PUBLIC_` values from `.env.local`, skip the optional Supabase integration, and deploy.

## 3. 把網址告訴 Supabase Tell Supabase the address

1. 按 **Continue to Dashboard**，在 **Domains** 看到網址，例如 `https://long-view-invest.vercel.app`。
2. 打開 Supabase 專案 → **Authentication → URL Configuration** → **Site URL** 改成這個網址 → **Save changes**。

App 用 email 和密碼登入，不改這個也能登入；改了之後，Supabase 寄出的信（例如重設密碼）會指向你的網站，而不是 `localhost`。

## 4. 用電腦試一次 Try it on the computer

打開網址 → 出現登入頁 → 用你的帳號登入 → 看得到持倉頁和「資料狀態」頁，就成功了。

## 5. 加到手機主畫面 Add it to your phone's home screen

- **iPhone**：請用 **Safari**。打開網址並登入 → 按下方的「分享」按鈕 → 選「加入主畫面」→ 名稱會是「長期投資」→ 按「加入」。之後從主畫面的圖示打開，就像一個 App，沒有網址列。
- **Android**：用 **Chrome** 打開網址並登入 → 右上角選單 → 「安裝應用程式」或「加到主畫面」。

On an iPhone, use Safari's Share → Add to Home Screen; on Android, Chrome's menu → Install app.

## 之後 Later updates

- 合併 PR 之後，網站會自動更新，你不用在 Vercel 做任何事。
- **PR 說明裡有資料庫變更時**（「`db push` 會列出 N 個新的 migration」），合併後馬上在 Mac 上執行：

  ```bash
  git checkout main && git pull
  npx supabase db push
  ```

  Vercel 不會幫你改資料庫。在你執行 `db push` 之前，網站可能會短暫顯示「無法從資料庫讀取」，執行後重新整理就好。

Merging to `main` redeploys the site by itself; when a PR changes the database, run `npx supabase db push` right after merging.

## 問題排除 Troubleshooting

| 看到的情況 | 原因與處理 |
| --- | --- |
| 網站顯示 `Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY…` | 第 2 步的環境變數漏了或名稱打錯。到 Vercel 專案 **Settings → Environment Variables** 補上，再到 **Deployments**，在最新一筆的「⋯」選單按 **Redeploy** |
| 本機登得進去，網站登不進去 | 兩個環境變數的值和 `.env.local` 不一樣，重新複製貼上後 Redeploy |
| 網站顯示「無法從資料庫讀取」 | 最新的資料庫變更還沒套用，在 Mac 上執行 `npx supabase db push` |
| 部署失敗（Deployment failed） | 點進那一筆部署看 **Build Logs**，把紅色的錯誤訊息貼給 Claude |
| iPhone 沒有「加入主畫面」 | 請改用 Safari 打開；LINE 等 App 內建的瀏覽器沒有這個選項 |
