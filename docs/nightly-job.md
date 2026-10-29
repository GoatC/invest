# 每夜價格排程 Nightly price job

每晚自動把收盤價、匯率、金價、市場資料與財報寫進你的 Supabase，存下每一天的淨值快照與風險值，再檢查規則。每次執行的結果記在 `job_runs`，App 的「資料狀態」頁看得到。

Every night GitHub Actions loads closes, FX, gold, the monthly market series, index closes, yields and the single stocks' filings into Supabase, saves each day's NAV snapshot and VaR, re-values watched stocks after a new filing, reads the red-flag feeds and saves each company's weekly scan, then checks the rules. Each run is in `job_runs` and on the Data status page.

## 它怎麼運作 How it works

- **時間**：每晚台北時間約 22:23（台股已收盤、臺銀已公布匯率、前一個美股交易日與 AGGU 淨值已公布）。在 GitHub Actions 執行（`.github/workflows/nightly.yml`、`scripts/nightly.ts`），公開 repo 免費。
- **價格**：每晚整段重抓近 6 年的每日收盤價（除息會改變過去的還原收盤價，整段重抓最正確）；風險值的代理 ETF 再往前多抓，讓每一天都有 3 年週報酬。第一次要下載 AGGU 的 25 MB 基金檔，比較久；之後約 1–2 分鐘。
- **淨值快照與風險值**：重算第一筆交易到今天每一天的市值、類別權重與一週風險值，存進 `nav_snapshots`。修改過去的交易或晚到的收盤價都會自動更正。
- **每月與每日市場資料**：大額資金用的 CAPE、S&P 500 價格與殖利率（`market_series`）；回歸分析用的標普 500、加權報酬指數（`index_prices`）與美國 3 個月國庫券；權益成本用的美國與台灣 10 年期公債殖利率、Damodaran 風險溢酬。每月第一次執行另存持股 β。
- **財報**（第二階段第 4 步，F12）：持有或觀察中的個股與其同業，每晚載入近 7 年的季報（美股 SEC EDGAR、台股 FinMind），存入 `fundamentals`；觀察中的個股有新一季財報時自動重新估值，再檢查規則。**美股需要 `SEC_USER_AGENT` secret**（下面第 3 步），沒有時只略過美股財報。
- **紅旗指標**（第二階段第 5 步，N3）：持有或觀察中的個股，每晚讀取證交所的公司基本資料（產業、簽證會計師事務所、統一編號）與當天的重大訊息（財報重編、繼續經營疑慮、更換會計師）；每家公司每週一次另查美股的 SEC 8-K（4.01 更換會計師、4.02 財報重編）與 10-K 繼續經營全文搜尋，或台股的環境部裁罰（**需要 `MOENV_API_KEY` secret**，沒有時只略過台股環境裁罰），再存下該週的紅旗掃描。
- **成分股**（第二階段第 6 步，F14）：每月一次讀取持有基金的成分股（VT、VOO 來自 Vanguard，00692 來自富邦投信），以及 S&P 500 成分股的 GICS 產業（State Street Select Sector SPDR 持股檔）與台股產業別，存入 `fund_holdings`。不需要金鑰。
- **類股價格**（第二階段第 7 步，N7）：每晚讀取 11 檔 Select Sector SPDR 類股 ETF 與 20 個證交所類股指數約一年（400 天）的收盤價，存入 `index_prices`（ETF 代號，或 `TW_` 加指數代號）。來源是 FinMind；美股備援為 Alpha Vantage（有 `ALPHAVANTAGE_API_KEY` 時），台股備援為證交所 OpenAPI（只有最近一天）。
- **蒙地卡羅**（第三階段第 1 步，F5）：每月第一晚以剛載入的價格、複利計算機的計畫與資本市場假設重新模擬，把摘要存入 `simulation_runs`（儀表板只在更新當週顯示）。需要先在「複利計算機」儲存計畫、在「資產配置」輸入資本市場假設；條件不足時安靜略過。公開的執行紀錄只寫「本月已重新模擬」，不寫任何金額。
- **五因子**（第三階段第 6 步，N1）：每晚讀取 Kenneth French 資料庫的月因子（美國、已開發市場、新興市場三個 zip，各約 10 KB），存入 `market_series`（`ff5_` 開頭，保留 11 年）。來源是 mba.tuck.dartmouth.edu，不需要金鑰；暫時連不上時沿用已存的資料，隔天再試。
- **歷史年數**（第三階段第 4 步，F7）：價格載入的範圍取風險值、回歸分析區、蒙地卡羅與效率前緣中最長者（效率前緣預設十年，所以第一次執行會載入較多資料，之後只更新新的幾天）。
- **績效歸因**（第三階段第 5 步，N2）：每夜把尚未存入的完整月份（第一層依資產類別、第二層依產業）的 Brinson 效果存入 `attribution`；公開的執行紀錄只寫月數，不寫任何報酬。
- **規則與推播**：最後以剛載入的資料檢查規則、產生提案，並送出推播（[推播通知](web-push.md)）。
- **失敗時**：App 沿用最後一次成功的資料；連續 2 晚失敗（`DATA_FAILURE`）就顯示警示並推播一次。公開的執行紀錄只寫數量，不寫代號與提案內容。

### 資料來源 Sources

每種資料都有一個備援來源（PRD 第 9 節「免費資料中斷」）。

| 資料 Data | 主要來源 Primary | 備援 Fallback |
| --- | --- | --- |
| 台股、台股 ETF | FinMind 每日收盤價，加上除權息結果與股票分割（由收盤價判斷）算出還原收盤價 | 證交所 OpenAPI（只有最新一天） |
| 美股、美國 ETF | FinMind 美股價格（含還原收盤價） | Alpha Vantage，只補缺的日子（選填） |
| AGGU、CSPX、IB01、IGLN（倫敦） | iShares 官網的每日淨值（基金股數合併或分割會自動還原） | Alpha Vantage `<代號>.LON` 週線（選填） |
| VWRA 等其他倫敦 ETF | 尚無免費每日來源 | Alpha Vantage `<代號>.LON` 週線（選填） |
| 美元匯率 USD/TWD | 臺灣銀行牌告（經 FinMind），即期買入與賣出的中間值 | FRED（每週公布、晚幾天） |
| 黃金（台幣） | 國際金價（FinMind，每盎司美元）× 當天臺銀美元匯率 | 你在 App 手動輸入的估值 |
| S&P 500 CAPE、價格、股息殖利率（每月，第二階段） | Shiller 教授的 `ie_data.xls`（shillerdata.com） | multpl.com 的每月表格 |
| 標普 500 每日收盤（第二階段第 2 步） | FinMind（^GSPC） | FRED（SP500） |
| 加權報酬指數每日收盤 | FinMind（TaiwanStockTotalReturnIndex） | 證交所每日指數報表（只有最新一天） |
| 美國 3 個月國庫券（每月） | FRED（TB3MS） | 回歸分析的設定值 |
| 美國 10 年期公債殖利率（每月，第二階段第 3 步） | FRED（DGS10，月底） | 美國財政部每日殖利率曲線 |
| 台灣 10 年期公債殖利率（每月） | 中央銀行開放資料（EG43M01） | 權益成本的設定值 |
| 隱含股票風險溢酬（每月） | Damodaran Online（ERPbymonth.xlsx） | 權益成本的設定值 |
| 美股財報（每季，第二階段第 4 步） | SEC EDGAR company facts（10-K、10-Q） | 估值頁自行輸入的數字 |
| 台股財報與現金股利（每季） | FinMind 三大報表與除權息結果 | 估值頁自行輸入的數字 |

股票分割（例如 0050 在 2025 年 6 月 1 拆 4）不在 FinMind 的除權息資料裡，所以由收盤價判斷：台股單日漲跌最多 10%，某天收盤價突然變成前一天的 ½、⅓、¼ 等（上下 10% 以內），就是分割，之前的還原收盤價會依比例調整。風險值與績效都用還原收盤價，所以不會把分割誤算成大跌。

黃金每克台幣價格 = 每盎司台幣價格 ÷ 31.1035。臺銀的黃金牌價網頁會擋程式（第 1 步資料來源檢查），所以改用國際金價換算；銀行實際回收價通常略低一點。

## 設定步驟 Setup（只需一次，約 15 分鐘）

請在這個 PR 合併之後再做。

### 1. 更新資料庫 Update the database

依 [執行 App](running-the-app.md) 第 1 步執行 `git pull`、`npm install`、`npx supabase db push` 與 `npm run check:supabase`。

### 2. 複製 Supabase 的 secret key

排程要寫入價格，需要 Supabase 的 **secret key**。它可以略過 row-level security、讀寫所有資料，所以**只放在 GitHub 的 secret 設定**：不要貼進 `NEXT_PUBLIC_` 開頭的變數、Vercel、聊天訊息或任何會進 git 的檔案。

1. 打開 <https://supabase.com/dashboard>，進入你的專案，點左下 **Project Settings → API Keys**。
2. 找到 **Secret keys** 區塊。每個專案都有一把名為 `default` 的 key；建議另外新增一把只給排程用（新增按鈕，名稱填 `nightly_job`）。這個名稱只是 Supabase 裡的標籤，不會填到 GitHub。之後如果懷疑外洩，只要刪掉這一把，不影響其他東西。介面不同找不到新增按鈕時，用 `default` 那把也可以。
3. 按該把 key 旁的複製圖示（以 `sb_secret_` 開頭），下一步馬上貼上。

### 3. 把值存進 GitHub secrets

1. 打開 <https://github.com/GoatC/Invest>，點上方 **Settings** → 左側 **Secrets and variables → Actions** → **Secrets** 分頁 → **New repository secret**。
2. 一次新增一個。**Name** 填下表左欄的名稱，要完全照抄（大寫、底線）；**Secret** 貼上值，按 **Add secret**。第 2 步在 Supabase 取的 key 名稱不要填在這裡，而且 GitHub 不接受 `GITHUB_` 開頭的名稱。

| Name | 值 Value | 從哪裡拿 Where from |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | 和 `.env.local` 裡的 `NEXT_PUBLIC_SUPABASE_URL` 一樣 |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | 第 2 步複製的 |
| `FINMIND_TOKEN` | FinMind 的 token | `.env.local` 裡同名的那一行（第 1 步資料來源檢查用過） |
| `ALPHAVANTAGE_API_KEY` | Alpha Vantage 的 key | 選填：只在 FinMind 或 iShares 失敗時當備援 |
| `SEC_USER_AGENT` | 例如 `LongViewInvest hugo@example.com`（名稱加你的 email） | 美股財報（F12）與 8-K（N3）需要：SEC 要求程式註明聯絡 email，沒有就拒絕連線。只存在 GitHub secrets，不會出現在公開紀錄 |
| `MOENV_API_KEY` | 環境部資料開放平臺的 API key | 台股環境裁罰（N3）需要：`.env.local` 裡同名的那一行（第 1 步資料來源檢查用過），或到 <https://data.moenv.gov.tw/> 免費註冊會員後在「會員專區」取得 |

- 存進去之後 GitHub 不會再顯示內容（只能覆蓋），執行紀錄裡也會自動遮住。
- repo 是公開的，但 secrets 不公開：只有這個 repo 自己的排程用得到，別人 fork 你的 repo 也拿不到。

### 4. 手動執行一次 Run it once by hand

1. 在 GitHub repo 上方點 **Actions** 分頁。
2. 左側選 **Nightly prices 每夜價格** → 右邊 **Run workflow** → Branch 選 `main` → 按綠色的 **Run workflow**。
3. 等 2–5 分鐘（第一次最久）。綠色勾勾＝成功；紅色叉叉＝失敗，點進去看「Load prices, FX rates and gold」那一步的訊息，對照下面的問題排除。

公開 repo 的執行紀錄任何人都看得到，所以紀錄裡只寫數量（例如「載入 13 檔證券、3 組匯率」），不寫你追蹤哪些代號；明細只在 App 裡。

### 5. 在 App 確認 Check in the app

在 Mac 上執行 `npm run dev`，登入後：

- 上方選單 **資料狀態**：應該寫著「每夜價格排程最後一次於台北時間 … 執行，資料全部載入」，每檔證券都有收盤日與來源；有交易之後，「最近一次執行」下方會寫「已存入 … 至 … 每一天的淨值快照」。
- 打開 App 時，若排程還沒執行、最後一次只載入部分資料或已連續失敗，畫面上方會滑出一則提示，停留三秒後收起（可按 ✕ 提早關閉）。在 App 內換頁不會再出現，重新整理才會；完整狀態一律看資料狀態頁。
- **持倉**：市值下方顯示收盤日；實體黃金改以每夜金價計算，不再標 ＊。
- **新增交易**：選了美股代號後，匯率會自動帶入交易日當天的匯率，下方會寫出是哪一天的匯率。你自己輸入的匯率不會被覆蓋。

之後每晚自動執行，不需要再做任何事。

Run it once from the Actions tab, then check the Data status page: every security should show a recent close and its feed.

## 平常要注意的事 Things to know

- **失敗通知**：失敗的執行在 Actions 分頁會是紅色，GitHub 也可能寄 email 通知；但請以 App 為準：連續 2 晚失敗時，持倉頁會顯示警示（門檻在 `rules` 表 `DATA_FAILURE` 的 `failures`，可以自己改）。
- **60 天規則**：公開 repo 如果連續 60 天沒有任何新的 commit，GitHub 會自動暫停排程。這時 App 會顯示「已連續 N 晚未成功」；到 **Actions → Nightly prices 每夜價格** 按 **Enable workflow** 就會恢復。
- **Supabase 不會被暫停**：免費專案約 7 天沒有活動會被暫停；每晚的讀寫就是活動，所以只要排程在跑，專案就不會睡著。
- **費用**：GitHub Actions 對公開 repo 免費；FinMind 免費額度每小時 600 次，每晚大約用 20 次。
- **為什麼不用 Supabase Edge Function**：免費方案每次只有 2 秒 CPU、最長 150 秒，不夠用（PRD 第 6、9 節）。

## 問題排除 Troubleshooting

| 看到的訊息 Message | 原因與處理 Fix |
| --- | --- |
| `Missing SUPABASE_URL, …` | 第 3 步的 secret 漏了或名稱打錯，重新新增 |
| 新增 secret 時出現 `Secret names must not start with GITHUB_` | Name 欄填錯了：要填 `SUPABASE_SECRET_KEY` 這類表格裡的名稱，不是 Supabase 裡的 key 名稱 |
| `reading the database: Invalid API key` | `SUPABASE_SECRET_KEY` 貼錯：要 `sb_secret_` 開頭，不是 publishable key |
| `job_runs` 找不到資料表，或持倉頁寫「無法讀取每夜排程狀態」 | 第 1 步的 `npx supabase db push` 還沒執行 |
| `FinMind …: Your level is register …`、額度用完 | FinMind token 錯了，或這一小時的額度用完；隔天會自動重試 |
| `Rules: proposals: …`，或資料狀態頁寫「無法檢查規則」 | 第 9 步的 `npx supabase db push`（`rules_engine`）還沒執行；執行後到儀表板最下方的「提案」按「立即檢查規則」 |
| 資料狀態頁某一檔一直「尚未載入」 | 代號可能和 FinMind 用的不同（例如美股 ETF 已下市）；把資料狀態頁的錯誤訊息貼給 Claude |
| 資料狀態頁「每月市場資料」的來源是 multpl.com，或「主要來源失敗」列出 `us_cape: shiller …` | Shiller 的網站暫時連不上（測試時雲端主機的連線曾被重設），已自動改用備援，數值相近，不需處理 |
| 「大額資金」頁寫「尚未載入該月份的 CAPE」 | 排程還沒載入每月市場資料：`npx supabase db push` 之後手動執行一次排程（上面第 4 步） |
| `US filings: SEC_USER_AGENT is not set` | 第 3 步加上 `SEC_USER_AGENT`；台股財報不受影響 |
| `AAPL filings: sec: HTTP 403 …` | `SEC_USER_AGENT` 沒有 email，或格式不對：改成「名稱 空格 email」 |
| `red flags: MOENV_API_KEY is not set …`（警告） | 第 3 步加上 `MOENV_API_KEY`；其他紅旗指標不受影響 |
| `VT holdings: vanguard: …` 或 `00692 holdings: fubon: …` | 發行商網站暫時連不上或改版；合併透視沿用上次的成分股，隔天會再試。持續失敗請把錯誤訊息貼給 Claude |
| `red flags: TWSE …: HTTP …` | 證交所 OpenAPI 暫時連不上；隔天會自動再讀，重大訊息只會漏掉那一天（可到公開資訊觀測站查詢後在「紅旗指標」頁自行登錄） |
| `XLK: finmind: …` 或 `TW_ELECTRONIC: finmind returned no data` | FinMind 暫時沒有該類股的資料；產業熱圖沿用已存的收盤價，隔天會再試。若同一個台股指數一直沒有資料，可能是 FinMind 改了代號：先在「產業熱圖」頁的設定刪除那一行，再把錯誤訊息貼給 Claude |

## 在 Mac 上手動執行 Run it on your Mac (optional)

平常不需要，用上面第 4 步的按鈕即可。真的要在 Mac 上跑：在 `.env.local` 加上 `SUPABASE_SECRET_KEY=sb_secret_...`（`FINMIND_TOKEN` 已經在裡面），再執行 `npm run nightly`。`.env.local` 不會進 git，但用完可以把那一行刪掉。

`npm run nightly` runs the job with `.env.local`, which then needs `SUPABASE_SECRET_KEY`; locally it prints every ticker, while on GitHub Actions it prints counts only.
