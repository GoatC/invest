# 每夜價格排程 Nightly price job

第一階段第 4 步（PRD 第 11 節）：每晚自動把收盤價、臺灣銀行匯率和金價寫進你的 Supabase，App 用它們計算市值。第 5 步起，排程也會存下每一天的淨值快照；第 7 步起，每個快照另附當天的一週風險值。每次執行的結果記在 `job_runs` 資料表，App 的「資料狀態」頁看得到。

Phase 1, step 4: every night GitHub Actions loads daily closes, Bank of Taiwan exchange rates and the gold price into Supabase; since step 5 it also saves each day's NAV snapshot, since step 7 each snapshot's 1-week Value at Risk, and since step 9 it then checks the rules and drafts their proposals. Since Phase 2, step 1 it also loads the monthly S&P 500 CAPE, price and dividend yield since 1871 for the windfall planner (F3), from Robert Shiller's workbook with multpl.com as the fallback; since step 2 the S&P 500 and TAIEX total return daily closes and the US 3-month bill rate for the Regression Lab (N1), six years of every security's closes, and once a month each holding's β; since step 3 the US and Taiwan 10-year government bond yields and Damodaran's implied equity risk premium for the cost of equity (F11). Each run is recorded in `job_runs` and shown on the app's Data status page.

## 它怎麼運作 How it works

- **時間**：每晚台北時間約 22:23（GitHub 有時會晚幾分鐘才開始）。這時台股已收盤、臺銀已公布當天匯率，前一個美股交易日的收盤價與 AGGU 的淨值也都已公布。
- **在哪裡跑**：GitHub Actions，也就是 GitHub 提供的雲端電腦，公開 repo 免費。排程設定在 `.github/workflows/nightly.yml`，程式在 `scripts/nightly.ts`。
- **抓多久的資料**：每晚重新載入最近 3 年（`config` 表 `var` 的 `lookback_years`，風險值卡片要用）的每日收盤價。風險值的代理 ETF（各資產類別的基準 ETF，例如 VT、0050）會再往前多載入：從第一筆交易（或一年前，取較早者）往前 3 年起，讓過去每一天的風險值都有完整的 3 年週報酬。因為每次除息後，過去的「還原收盤價」會整段改變，整段重抓最簡單也最正確。第一次執行要下載 AGGU 的 25 MB 基金檔案取得歷史淨值，會比較久；之後每晚約 1–2 分鐘。
- **淨值快照**（第 5 步）：價格存好之後，排程會重算從第一筆交易到今天**每一天**的總市值與一般資金池各類別的權重，存進 `nav_snapshots` 表，供之後的功能使用。第 7 步起，每一天也附上當天的一週風險值（`var_95_1w`），風險值卡片的近 52 週走勢線就是取自這裡；風險值的資料讀取失敗時，快照照樣存入，風險值維持上一次的數值。每晚整段重算，所以修改過去的交易、或晚一天才到的美股收盤價，都會自動更正。績效頁不靠快照，開啟時直接由交易計算。快照存失敗時，價格照樣保存，資料狀態頁會另外標示。
- **檢查規則**（第 9 步）：快照存好之後，排程以剛載入的收盤價評估規則（R1、R2、F8 偏離、每月投入、年度檢查，第 11 步起加上美國遺產稅），觸發時在「提案」頁產生附下單清單的提案，也會關閉已逾期或不再成立的提案。這和提案頁的「立即檢查規則」按鈕是同一段程式。公開的執行紀錄只寫「Rules checked.」，不寫提案內容；規則檢查失敗時，價格與快照照樣保存，資料狀態頁會標示。
- **每月市場資料**（第二階段第 1 步）：同一個排程也載入大額資金分批（F3）用的三組每月資料：S&P 500 的 CAPE（決定分幾批）、每月平均價格與股息殖利率（回測用），從 1871 年起整段存入 `market_series` 表。主要來源是 Robert Shiller 教授網站上的 Excel 檔（`ie_data.xls`，下載連結每次更新都會變，所以每晚先讀網頁找連結），以 SheetJS（`xlsx` 套件）解析；連不上時改抓 multpl.com 的每月表格（數字同樣來自 Shiller 的資料）。Shiller 的資料每月更新一次、大約落後一個月，所以最新月份通常是上個月。ACWI（下跌加速的指標）是一般證券，和其他代號一樣每晚載入每日收盤價。
- **回歸分析的資料**（第二階段第 2 步）：同一個排程也載入標普 500（FinMind 的 ^GSPC，失敗時改用 FRED 的 SP500）與加權報酬指數（FinMind，失敗時以證交所每日指數報表補最新一天）的每日收盤，存入 `index_prices` 表；美國 3 個月國庫券月利率（FRED TB3MS）存入 `market_series`。每檔證券的收盤價也改為往前載入 6 年（回歸最長 5 年，加 1 年給滾動 β），所以第一次執行會比平常久一點。每月第一次執行時，再把每檔持股的 β 存入 `beta_results`，資料狀態頁會寫「已存入本月 N 筆 β」。
- **權益成本的資料**（第二階段第 3 步）：`config` 表有 `capm` 設定後，排程每晚載入最近 13 個月的三組每月資料，存入 `market_series`：美國 10 年期公債殖利率（FRED 的 DGS10，取每月最後一天；失敗時改用美國財政部的每日殖利率曲線）、台灣 10 年期公債殖利率（中央銀行開放資料 EG43M01 的「十年期政府公債次級市場利率」，每月平均，約落後兩個月），以及 Damodaran 教授每月初公布的美股隱含風險溢酬（`ERPbymonth.xlsx`）。後兩者沒有第二個免費來源，載入失敗時 App 使用「權益成本」頁的設定值，並在小卡上標示。
- **推播**（第 10 步）：排程最後一步送出新提案的推播；另有每小時執行的「Pushes 推播」排程負責每週檢視、安靜時段後補送與資料異常警示。設定見 [推播通知](web-push.md)；還沒設定 VAPID 金鑰時，這一步只會寫「Web Push is not set up yet」，不會讓排程失敗。
- **失敗時**：App 沿用最後一次成功載入的價格；連續 2 晚失敗（`rules` 表 `DATA_FAILURE` 的門檻）就在首頁與持倉頁顯示警示，並推播一次（第 10 步）。

It runs at about 22:23 Taipei time, reloads the last three years of closes each night (dividend adjustments change past adjusted closes), then recomputes every day's NAV snapshot since the first trade and checks the rules (step 9), keeps the last good prices when a night fails, and flags two misses in a row.

### 資料來源 Sources

每種資料都有一個備援來源（PRD 第 9 節「免費資料中斷」）。

| 資料 Data | 主要來源 Primary | 備援 Fallback |
| --- | --- | --- |
| 台股、台股 ETF | FinMind 每日收盤價，加上除權息結果與股票分割（由收盤價判斷）算出還原收盤價 | 證交所 OpenAPI（只有最新一天） |
| 美股、美國 ETF | FinMind 美股價格（含還原收盤價） | Alpha Vantage，只補缺的日子（選填） |
| AGGU（倫敦） | iShares 官網的每日淨值 | Alpha Vantage AGGU.LON 週線（選填） |
| 美元匯率 USD/TWD | 臺灣銀行牌告（經 FinMind），即期買入與賣出的中間值 | FRED（每週公布、晚幾天） |
| 黃金（台幣） | 國際金價（FinMind，每盎司美元）× 當天臺銀美元匯率 | 你在 App 手動輸入的估值 |
| S&P 500 CAPE、價格、股息殖利率（每月，第二階段） | Shiller 教授的 `ie_data.xls`（shillerdata.com） | multpl.com 的每月表格 |
| 標普 500 每日收盤（第二階段第 2 步） | FinMind（^GSPC） | FRED（SP500） |
| 加權報酬指數每日收盤 | FinMind（TaiwanStockTotalReturnIndex） | 證交所每日指數報表（只有最新一天） |
| 美國 3 個月國庫券（每月） | FRED（TB3MS） | 回歸分析的設定值 |
| 美國 10 年期公債殖利率（每月，第二階段第 3 步） | FRED（DGS10，月底） | 美國財政部每日殖利率曲線 |
| 台灣 10 年期公債殖利率（每月） | 中央銀行開放資料（EG43M01） | 權益成本的設定值 |
| 隱含股票風險溢酬（每月） | Damodaran Online（ERPbymonth.xlsx） | 權益成本的設定值 |

股票分割（例如 0050 在 2025 年 6 月 1 拆 4）不在 FinMind 的除權息資料裡，所以由收盤價判斷：台股單日漲跌最多 10%，某天收盤價突然變成前一天的 ½、⅓、¼ 等（上下 10% 以內），就是分割，之前的還原收盤價會依比例調整。風險值與績效都用還原收盤價，所以不會把分割誤算成大跌。

黃金每克台幣價格 = 每盎司台幣價格 ÷ 31.1035。臺銀的黃金牌價網頁會擋程式（第 1 步資料來源檢查），所以改用國際金價換算；銀行實際回收價通常略低一點。

## 設定步驟 Setup（只需一次，約 15 分鐘）

請在這個 PR 合併之後再做。

### 1. 更新資料庫 Update the database

在 Mac 的 Terminal、`invest` 資料夾執行：

```bash
git checkout main && git pull
npm install
npx supabase db push
npm run check:supabase
```

- `npx supabase db push` 會列出 **2 個新的 migration**，輸入 `Y` 套用：
  - `job_runs`：記錄每晚排程結果的資料表。只有你看得到；只有排程能寫入。
  - `fx_trade_date_rates`：在 `config` 表的 `fx_rate_check` 加上 `max_age_days`（10 天）。之後新增交易與 CSV 匯入會預設帶入**交易日當天**的匯率；當天沒有（週末、假日）就往前找，最多 10 天。這個修改也會出現在 App 的修改紀錄裡。
- `npm run check:supabase`：應該看到 **25 項全部 ✅**（多了 `job_runs`，陌生人一樣讀不到）。

`db push` adds the `job_runs` table and the trade-date FX setting; the check then shows 25 passes.

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
- **持倉**：市值下方顯示收盤日；實體黃金改以每夜金價計算，不再標 ＊。
- **新增交易**：選了美股代號後，匯率會自動帶入交易日當天的匯率，下方會寫出是哪一天的匯率。你自己輸入的匯率不會被覆蓋。

之後每晚自動執行，不需要再做任何事。

Run it once from the Actions tab, then check the Data status page: every security should show a recent close and its feed.

## 平常要注意的事 Things to know

- **失敗通知**：失敗的執行在 Actions 分頁會是紅色，GitHub 也可能寄 email 通知；但請以 App 為準：連續 2 晚失敗時，持倉頁會顯示警示（門檻在 `rules` 表 `DATA_FAILURE` 的 `failures`，可以自己改）。
- **60 天規則**：公開 repo 如果連續 60 天沒有任何新的 commit，GitHub 會自動暫停排程。這時 App 會顯示「已連續 N 晚未成功」；到 **Actions → Nightly prices 每夜價格** 按 **Enable workflow** 就會恢復。
- **Supabase 不會被暫停**：免費專案約 7 天沒有活動會被暫停；每晚的讀寫就是活動，所以只要排程在跑，專案就不會睡著。
- **費用**：GitHub Actions 對公開 repo 免費；FinMind 免費額度每小時 600 次，每晚大約用 20 次。
- **為什麼不用 Supabase Edge Function**：PRD 原本規劃由 GitHub Actions 呼叫 Edge Function，但免費方案的 Edge Function 每次只能用 2 秒 CPU、最長 150 秒，不夠處理 3 年的價格和 AGGU 的 25 MB 檔案。改成直接在 GitHub Actions 執行，每次都有紀錄可查，也和測試用的是同一套程式。代價是 secret key 要存在 GitHub secrets（加密保存）。這個決定記在 PRD 第 6、9 節。

## 問題排除 Troubleshooting

| 看到的訊息 Message | 原因與處理 Fix |
| --- | --- |
| `Missing SUPABASE_URL, …` | 第 3 步的 secret 漏了或名稱打錯，重新新增 |
| 新增 secret 時出現 `Secret names must not start with GITHUB_` | Name 欄填錯了：要填 `SUPABASE_SECRET_KEY` 這類表格裡的名稱，不是 Supabase 裡的 key 名稱 |
| `reading the database: Invalid API key` | `SUPABASE_SECRET_KEY` 貼錯：要 `sb_secret_` 開頭，不是 publishable key |
| `job_runs` 找不到資料表，或持倉頁寫「無法讀取每夜排程狀態」 | 第 1 步的 `npx supabase db push` 還沒執行 |
| `FinMind …: Your level is register …`、額度用完 | FinMind token 錯了，或這一小時的額度用完；隔天會自動重試 |
| `Rules: proposals: …`，或資料狀態頁寫「無法檢查規則」 | 第 9 步的 `npx supabase db push`（`rules_engine`）還沒執行；執行後到提案頁按「立即檢查規則」 |
| 資料狀態頁某一檔一直「尚未載入」 | 代號可能和 FinMind 用的不同（例如美股 ETF 已下市）；把資料狀態頁的錯誤訊息貼給 Claude |
| 資料狀態頁「每月市場資料」的來源是 multpl.com，或「主要來源失敗」列出 `us_cape: shiller …` | Shiller 的網站暫時連不上（測試時雲端主機的連線曾被重設），已自動改用備援，數值相近，不需處理 |
| 「大額資金」頁寫「尚未載入該月份的 CAPE」 | 排程還沒載入每月市場資料：第二階段第 1 步的 `npx supabase db push` 之後，手動執行一次排程（上面第 4 步） |

## 在 Mac 上手動執行 Run it on your Mac (optional)

平常不需要，用上面第 4 步的按鈕即可。真的要在 Mac 上跑：在 `.env.local` 加上 `SUPABASE_SECRET_KEY=sb_secret_...`（`FINMIND_TOKEN` 已經在裡面），再執行 `npm run nightly`。`.env.local` 不會進 git，但用完可以把那一行刪掉。

`npm run nightly` runs the job with `.env.local`, which then needs `SUPABASE_SECRET_KEY`; locally it prints every ticker, while on GitHub Actions it prints counts only.
