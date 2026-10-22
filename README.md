# Long-View Invest 長期投資

A single-user web app that runs a 30-year core–satellite portfolio on written rules, is reviewed once a week, and pushes an alert only when a decision is due. It drafts orders; the owner places every trade by hand.

一個單人使用的網頁 App：依書面規則運行 30 年的核心／衛星投資組合，每週檢視一次，只有在需要做決定時才推播。App 產生建議清單，每筆交易都由使用者手動下單。

This app supports its owner's own decisions; it is not financial advice. 本 App 用於輔助使用者自己的決策，不構成投資建議。

![Holdings page with demo data: pool totals, R1 warnings and target weights](docs/images/holdings.png)

## The rules it runs 運行的規則

| Sleeve 部位 | Asset class 資產類別 | Target 目標 |
| --- | --- | --- |
| Core 核心 80% | US / global equity 美股／全球大盤 | 28% |
| | Taiwan market-cap equity 台股市值型 | 12% |
| | Global bonds 全球債券 | 22% |
| | Real assets 實體資產 | 10% |
| | Strategic cash 戰略現金 | 8% |
| Satellite 衛星 20% | US stocks 美股個股 | 10% |
| | Taiwan stocks 台股個股 | 5% |
| | Tactical themes 戰術主題 | 5% |

- **R1**: no single stock above 5% of the regular-contribution pool. 任何單一個股不超過一般投入資金池的 5%。
- **R2**: when the satellite rises above 25%, trim it back to 20%. 衛星部位超過 25% 時減碼回 20%。
- A windfall is tracked as its own pool and never counts toward R1 or R2. 大額資金獨立成一個資金池，不計入 R1 與 R2。

Every threshold lives in the database (`rules` and `config` tables), never in code, and every rule edit is logged. 所有門檻都存在資料庫（`rules` 與 `config` 表），不寫死在程式中，每次修改規則都留下紀錄。

## Status 進度

Built phase by phase from [the product spec](docs/PRD.md); a phase starts only after the previous one passes its gate. 依[產品規格書](docs/PRD.md)分階段建置，前一階段通過關卡後才開始下一階段。

| Phase 1 step 第一階段步驟 | State 狀態 |
| --- | --- |
| 1. Check every free data source 免費資料來源檢查 | ✅ [report 報告](reports/source-check/report.md) |
| 2. Database schema, row-level security, demo data 資料庫結構、權限、示範資料 | ✅ |
| 3. Holdings entry and broker CSV import 持倉登錄與券商 CSV 匯入 | ✅ |
| 4. Nightly prices and FX 每夜價格與匯率 | ✅ [setup 設定](docs/nightly-job.md) |
| 5. NAV snapshots and F18 performance 淨值快照與真實績效 | ✅ |
| 6. Targets and allocation donuts 目標權重與配置圓餅圖 | ✅ |
| 7. VaR card 風險值卡片 | ✅ |
| 8. Compounding calculator 複利計算機 | ✅ |
| 9. Rules engine: R1, R2, F8 drift, proposals 規則引擎與提案 | ✅ |
| 10. Web Push and the weekly dashboard 推播與每週儀表板 | next 下一步 |
| 11. Fee and tax drag 費用與稅務拖累 | planned 規劃中 |

Phases 2 and 3 add security analysis (CAPM, valuation, regression, red flags), the windfall planner, Monte Carlo, the efficient frontier, stress tests and Brinson attribution. 第二、三階段加入證券分析、大額資金分批、蒙地卡羅、效率前緣、壓力測試與 Brinson 歸因。

## What works today 目前的功能

- **Holdings 持倉總覽**: regular and windfall pools, R1 / R2 status with the trim each needs, actual vs target weight per asset class, and every position at weighted-average cost with its TWD value and unrealised gain. The R1 / R2 figures expand to show their formulas and inputs, and the other figures are defined under their tables. 一般與大額資金池、R1／R2 狀態與所需減碼金額、各資產類別的實際與目標權重、每檔持股的平均成本、台幣市值與未實現損益；R1／R2 的數字可展開查看公式與輸入值，其他數字的定義寫在表格下方。
- **Trade entry 交易登錄**: currency filled in from the security and the FX rate from the trade date's Bank of Taiwan rate, a live R1 / R2 preview that warns without blocking, and a refusal when a sell exceeds the holding. 依證券自動帶入幣別、依交易日帶入臺灣銀行匯率，即時預覽 R1／R2（只提醒不阻擋），賣出超過持有數量時拒絕儲存。
- **Broker CSV import 券商 CSV 匯入**: UTF-8 or Big5 files, title lines above the header, ROC (民國) dates, column mapping remembered per broker, each row's trade-date FX rate when the file has none, cash dividends saved as cash flows, and entries already saved are skipped. 支援 UTF-8 與 Big5、標題列在上方的檔案、民國日期；欄位對應依券商記住，檔案沒有匯率時帶入各列交易日的匯率，現金股利存為現金流，已存在的資料自動略過。
- **Performance 績效**: the time-weighted return against the SAA benchmark, the money-weighted return (XIRR), and each month's and each foreign holding's TWD return split into local-currency, currency and cross terms, for both pools or each alone, with a table under every chart. 時間加權報酬與 SAA 基準的比較、資金加權報酬（XIRR），以及每月與每檔外幣持股的台幣報酬拆解為當地幣別、匯率與交叉項；可看兩個資金池合計或分開看，每張圖下方都有表格。
- **Allocation 資產配置**: each asset class's drift from its SAA target, coloured by the 5/25 rebalancing rule with the satellite left to R2; the targets and the capital market assumptions (expected return, volatility, source) edited in the app; and donuts by product type, listing country and active vs passive, with the 80/20 target as an inner ring and each slice listing its holdings. 各資產類別相對 SAA 目標的偏離（依 5/25 再平衡規則上色，衛星交給 R2）；在 App 內修改目標權重與資本市場假設（預期報酬、波動度、來源）；以產品類別、上市國家、主動與被動三種分法的圓餅圖，內圈為 80／20 目標，點選區塊即列出持股。
- **Value at Risk 風險值**: how much the whole portfolio could lose in a bad week, as "95% 1-week VaR: NT$X (Y% of portfolio)" with a 1-month toggle and a 52-week line, on the holdings page and its own page. Parametric VaR from three years of weekly returns in TWD of each class's proxy ETF; the page shows where it sits among those weeks, what it is made of, and the formula with today's numbers. 整個投資組合在不利的一週可能損失多少：「95% 一週風險值：NT$X（投資組合的 Y%）」，可切換一個月，並附近 52 週走勢線，顯示在持倉頁與獨立頁面。以各類別代理 ETF 過去三年的台幣週報酬計算參數法風險值；頁面列出它在這些週報酬中的位置、組成，以及代入今天數值的公式。
- **Rules engine and proposals 規則引擎與提案**: after every nightly update, or on request, the written rules are evaluated: R1 single-stock cap, R2 satellite trigger, F8's 5/25 drift band, the monthly contribution and the January review. A rule that fires drafts a proposal with an order list in whole shares and says why, figures included; you approve, edit or dismiss it, trade at your broker, record the trades from its checklist and mark it filled (L2: the app never trades). Each rule fires at most once a week unless what it fired on changes, and every threshold and its edit history is on the Rules page. 每晚資料更新後（或手動）評估書面規則：R1 單一個股上限、R2 衛星觸發、F8 的 5/25 偏離門檻、每月投入與 1 月的年度檢查。規則觸發時產生附整股下單清單的提案，並寫明原因與數字；由你核准、修改或略過，到券商下單，再從執行清單登錄交易並標記成交（L2：App 從不下單）。除非觸發狀態改變，同一規則每週最多觸發一次；所有門檻與修改紀錄都在「規則」頁。
- **Compounding calculator 複利計算機**: where monthly investing could take the regular pool, worked out live as the inputs change: start month, starting value, monthly contribution with a yearly step-up, expected return (from the capital market assumptions' target mix) and inflation. It shows the value year by year in nominal TWD and in today's money, what was put in against what it grew, and, once a plan is saved, the regular pool against it at every month end with the gap split into money put in and growth. 一般投入資金池透過每月投入可能成長到多少，輸入即時計算：起始月份、起始金額、每月投入與每年調升比例、預期報酬（依資本市場假設的目標配置）與通膨率。顯示逐年的名目台幣與換算今天幣值的資產、累計投入與累計成長；儲存計畫後，每個月底把資金池與計畫對照，差距拆成投入金額與成長。
- **Cash flows 現金流**: contributions, the windfall arriving, dividends and withdrawals, each in its own currency at its day's rate; dividends count in the money-weighted return. 投入資金、大額資金入帳、股利與提領，各以原幣別加當日匯率記錄；股利計入資金加權報酬。
- **Non-listed assets 非上市資產**: physical gold in grams, valued nightly at the gold price in TWD, and savings and money-market balances in TWD. 實體黃金以克數記錄、每夜以台幣金價估值；活存與貨幣基金以台幣餘額記錄。
- **Nightly prices 每夜價格**: a GitHub Actions job loads daily closes (adjusted for dividends and splits), Bank of Taiwan exchange rates and the gold price, with one fallback feed each, then saves every day's NAV snapshot with its 1-week VaR; the Data status page shows every run and the newest close per security, and two missed nights in a row raise an alert. GitHub Actions 每夜載入每日收盤價（含除息與分割還原）、臺灣銀行匯率與金價，每種資料都有備援來源，再存入每一天的淨值快照與一週風險值；「資料狀態」頁列出每次執行與各證券最新收盤價，連續兩晚失敗即顯示警示。
- **Securities and edit history 證券與修改紀錄**: every entry can be edited or deleted, and the database logs each change, deleted entries included. 每筆資料都能修改或刪除，資料庫會記錄每次變更，包含已刪除的資料。

![Performance with demo data: TWR against the SAA benchmark, XIRR and the gain](docs/images/performance.png)

![Allocation with demo data: drift from the targets, coloured by the 5/25 rule](docs/images/allocation.png)

![Value at Risk with demo holdings: the 1-week figure, its 52-week line, and where it sits among three years of weekly returns](docs/images/risk.png)

![Proposals with demo data: the monthly contribution and a drift rebalance, each explained, with whole-share orders](docs/images/proposals.png)

![Compounding calculator with demo data: the PRD acceptance case, NT$10,000 a month at 6% for 30 years, year by year](docs/images/calculator.png)

![CSV import preview: every row explained, unknown tickers can be added on the spot](docs/images/import-preview.png)

![Data status after a nightly run: the newest close per security, its date and feed](docs/images/data-status.png)

## How it is built 技術架構

- **Next.js** (App Router, server actions) as an installable PWA on **Vercel**, with **Supabase** (Postgres, Auth, Data API) and **Apache ECharts** for charts. Nightly jobs run on **GitHub Actions** and write with a secret key kept in GitHub's encrypted secrets; alerts will use **Web Push**. Next.js 搭配 Supabase，圖表使用 Apache ECharts；每夜排程在 GitHub Actions 執行，以存放在 GitHub 加密 secrets 的金鑰寫入；推播使用 Web Push。
- **Single owner, enforced by the database**: row-level security on every table lets only the one owner account in; strangers holding the public key are refused, which `npm run check:supabase` verifies from outside. 由資料庫保證只有一位擁有者：每張表都開啟 row-level security；持有公開金鑰的陌生人一律被拒，可用 `npm run check:supabase` 從外部驗證。
- **Money in trade currency plus the day's FX rate, reported in TWD.** 金額以交易幣別加當日匯率儲存，以台幣呈現。
- **Free data only**, checked source by source in step 1. 只使用免費資料，第 1 步已逐一檢查。
- **Bilingual throughout**: every label, message and error is in English and Traditional Chinese. 所有標籤、訊息與錯誤都是中英雙語。
- **L2 automation**: the app proposes, a person decides and trades. It never holds broker credentials. 由 App 提案、人決定並下單；App 不保存券商帳密。

## Run it 執行方式

1. [Set up Supabase](docs/supabase-setup.md) once: create the project, apply the schema, create the owner account. 先[設定 Supabase](docs/supabase-setup.md)：建立專案、套用資料庫結構、建立擁有者帳號。
2. [Run the app](docs/running-the-app.md): `npm install`, then `npm run dev`. 再[執行 App](docs/running-the-app.md)。
3. [Turn on the nightly job](docs/nightly-job.md): four GitHub secrets, then one run by hand. 再[啟用每夜排程](docs/nightly-job.md)：設定 4 個 GitHub secrets，再手動執行一次。
4. [Deploy to Vercel](docs/deploy-vercel.md) and add it to the phone's home screen. 最後[部署到 Vercel](docs/deploy-vercel.md)，並加到手機主畫面。

## Tests 測試

| Command 指令 | What it checks 檢查內容 |
| --- | --- |
| `npm test` | Model, CSV and form unit tests with the spec's acceptance values, plus the whole schema and its row-level security rebuilt in an in-memory Postgres (PGlite) 單元測試（含規格書驗收值），以及在記憶體 Postgres 中重建整個資料庫並檢查權限 |
| `npm run typecheck` | TypeScript across the app, scripts and tests 型別檢查 |
| `npm run test:e2e` | The built app against a local Supabase stand-in, driven in Chromium, then the real nightly job against the same stand-in ([details](tests/e2e/README.md)) 以 Chromium 實際操作連到本機 Supabase 替身的 App，再對同一個替身執行真正的每夜排程 |

## Repository layout 專案結構

| Path 路徑 | Contents 內容 |
| --- | --- |
| `app/` | Pages and server actions 頁面與伺服器動作 |
| `lib/models/` | Positions, valuation, trade-date FX, data health, the R1 / R2 rules, performance (TWR, XIRR, FX split, NAV snapshots), drift and allocation lenses, the capital market assumptions, and the Value at Risk, as pure functions 持倉、估值、交易日匯率、資料狀態、R1／R2 規則、績效（TWR、XIRR、匯率拆解、淨值快照）、偏離與配置分法、資本市場假設、風險值，皆為純函式 |
| `lib/csv/` | Statement reading, column mapping and the import plan 對帳單讀取、欄位對應與匯入計畫 |
| `supabase/migrations/` | Schema, row-level security, reference data and change logs 資料庫結構、權限、參考資料與變更紀錄 |
| `supabase/seed.sql` | Demo data for local use only 僅供本機使用的示範資料 |
| `scripts/` | The nightly job and its feeds, the data-source check and the outside-in Supabase check 每夜排程與資料來源程式、資料來源檢查與 Supabase 外部檢查 |
| `.github/workflows/` | The nightly schedule 每夜排程設定 |
| `docs/` | Product spec and runbooks 產品規格與操作說明 |

## Data and privacy 資料與隱私

This repository is public and holds no personal data: no holdings, windfall figures or keys. The screenshots and `supabase/seed.sql` use invented demo numbers. Real data lives only in the owner's Supabase project, behind row-level security. 本 repo 公開，不含任何個人資料：沒有持股、大額資金數字或金鑰。截圖與 `supabase/seed.sql` 都是虛構的示範數字；真實資料只存在擁有者的 Supabase 專案中，受 row-level security 保護。
