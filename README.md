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
| 10. Web Push and the weekly dashboard 推播與每週儀表板 | ✅ [setup 設定](docs/web-push.md) |
| 11. Fee and tax drag 費用與稅務拖累 | ✅ |

Phase 1 is built and its gate has passed; Phase 2 is under way, in the order of [PRD Section 11](docs/PRD.md#11-claude-code-handoff-交付-claude-code). 第一階段已完成並通過關卡；第二階段依 PRD 第 11 節的順序進行中。

| Phase 2 step 第二階段步驟 | State 狀態 |
| --- | --- |
| 1. F3 windfall tranche planner 大額資金分批部署 | ✅ |
| 2. N1 Regression Lab, single-factor β 回歸分析區（單因子 β） | ✅ |
| 3. F11 CAPM cost of equity CAPM 權益成本 | ✅ |
| 4. F12 valuation workbench and alerts 估值工作台與警報 | ✅ |
| 5. N3 red-flag indicator 紅旗指標 | ✅ |
| 6. F14 combined look-through 核心與衛星合併透視 | ✅ |
| 7. N7 sector heatmap tab: heatmap, treemap, bubble chart 產業熱圖分頁：熱力圖、板塊圖、泡泡圖 | ✅ |

Phase 3 adds Monte Carlo, the life timeline, the efficient frontier, stress tests, Brinson attribution and the Fama–French five factors. 第三階段加入蒙地卡羅、人生時間軸、效率前緣、壓力測試、Brinson 歸因與 Fama–French 五因子。

## What works today 目前的功能

- **Weekly dashboard 每週儀表板** (home): three lines (rules, largest drift, value and weekly change), open proposals to approve or dismiss, drift bars, VaR, allocation donut, windfall progress, the coming week, actual vs plan. 三行摘要、待處理提案、偏離、風險值、配置、大額資金、下週事件、實際對計畫。
- **Web Push 推播**: only when a decision is due (new proposal, weekly review, data failure), never a price move; quiet hours 23:00–08:00. 只在需要決定時推播；安靜時段暫停。
- **Holdings and entry 持倉與登錄**: both pools, R1 / R2 status with the trim needed, actual vs target weights, average cost, TWD value and gain; trade entry fills the currency and the trade date's Bank of Taiwan rate and warns on R1 / R2; broker CSV import (UTF-8 or Big5, ROC dates, mapping remembered per broker, dividends as cash flows, duplicates skipped); cash flows, gold in grams and TWD balances; every edit logged. 持倉、交易登錄、CSV 匯入、現金流與非上市資產，修改皆留紀錄。
- **Performance 績效**: TWR against the SAA benchmark, XIRR, and the TWD return split into local, currency and cross terms. 時間加權與資金加權報酬、匯率拆解。
- **Allocation 資產配置**: drift coloured by the 5/25 rule (satellite by R2), targets and capital market assumptions edited in the app, donuts by product type, listing country and active vs passive. 偏離、目標與資本市場假設、三種圓餅圖。
- **Value at Risk 風險值**: 95% 1-week (or 1-month) parametric VaR of the whole portfolio from three years of weekly TWD returns of each class's proxy, with a 52-week line and its distribution. 參數法風險值與走勢、分布。
- **Calculator 複利計算機**: monthly investing projected in nominal and today's TWD; once saved, the plan against the regular pool each month end. 複利預測與實際對照。
- **Rules and proposals 規則與提案**: R1, R2, F8's 5/25 drift, the monthly contribution, the January review, US estate tax, windfall tranches, and F12's buy zone, trim zone and valuation updates, evaluated nightly; each proposal explains itself and drafts orders with estimated fees (US shares in fractions); you approve, edit or dismiss, trade at your broker and record the fills (L2: the app never trades). 規則觸發時產生附下單清單的提案，由你決定並自行下單。
- **Costs and tax 費用與稅務**: yearly drag of the holdings, each fund's and 複委託 broker's 30-year cost, the US$60,000 estate-tax check, the minimum tax's overseas-income floor and the 2.11% NHI premium; every threshold is a dated setting. 費用拖累、券商比較與三項稅務檢查。
- **Windfall planner 大額資金分批** (F3): core classes only, 6 / 12 / 24 monthly tranches by the CAPE percentile, sooner when ACWI falls 15% / 25% / 35%; a backtest since 1900. 依 CAPE 分批、大跌加速、回測。
- **Regression Lab 回歸分析** (N1): β against the S&P 500 and TAIEX with its interval, Blume's adjustment, α, R², rolling β and a five-ticker comparison; Dimson β for daily returns across markets. β、滾動 β 與比較。
- **Cost of equity 權益成本** (F11): each single stock's R_f + β (ERP + CRP) in its market's currency. 個股 CAPM 權益成本。
- **Valuation workbench 估值工作台** (F12): a single stock valued a share, bear / base / bull, by DCF (FCFF at WACC), Gordon's dividend model and P/E, P/B and EV/EBITDA against peers and its own five years, from its SEC or FinMind filings; the margin of safety and the buy (≤ 75%) and trim (≥ 125%) zones, re-run after each filing. 三種模型的內在價值、安全邊際、買入與減碼區，新財報後重算。
- **Red flags 紅旗指標** (N3): a red / amber / green light per single stock from nine indicators (Beneish M, Altman Z or Z″, cash flow against earnings, auditor changes, going-concern opinions and restatements from SEC 8-Ks and TWSE announcements, Taiwan environmental penalties, the governance tier, your exclusion list), with the share of them data covers; scanned weekly, a holding's worse light prompts a review and a satellite stock turning red drafts its exit. Display only. 九項指標的紅黃綠燈與資料覆蓋率；每週掃描，持股燈號轉差時提醒檢視，衛星持股轉紅時準備出場清單；僅供參考。
- **Look-through 合併透視** (F14): every fund opened up with its issuer's holdings file (Vanguard, Fubon), so each company's exposure through all the funds and held directly is one line, as a treemap; country, GICS sector and currency splits, each pair of funds' overlap, and each fund's TER, tracking difference and domicile. 以發行商成分股展開各基金，合併計算各公司曝險（矩形樹狀圖）、國家、產業與幣別分布、基金重疊度與費用。
- **Sectors 產業熱圖** (N7): the 11 GICS sectors, priced by the Select Sector SPDR funds in the US and the TWSE industry indices in Taiwan, as a heatmap of returns over 1 week to 1 year (red up by default, or green up), a treemap of the portfolio's exposure through the look-through coloured by return with each sector's companies, and a bubble chart of 1-year return against volatility with the portfolio's own point. Display only. 以 GICS 11 個產業呈現美股 SPDR 類股 ETF 與證交所類股指數的報酬熱力圖、依穿透曝險繪製的板塊圖（可展開公司）與報酬對波動度的泡泡圖；僅供參考。
- **Nightly data 每夜資料**: GitHub Actions loads prices, FX, gold, the market series, indices, yields and filings, each with a fallback feed, saves each day's NAV and VaR, then checks the rules; the Data status page shows every run, and two missed nights raise an alert. 每夜載入資料、存淨值與風險值、檢查規則；連續兩晚失敗即警示。

![The weekly dashboard with demo data: this week's three lines, the open proposal, drift from the targets](docs/images/dashboard.png)

![Performance with demo data: TWR against the SAA benchmark, XIRR and the gain](docs/images/performance.png)

![Allocation with demo data: drift from the targets, coloured by the 5/25 rule](docs/images/allocation.png)

![Value at Risk with demo holdings: the 1-week figure, its 52-week line, and where it sits among three years of weekly returns](docs/images/risk.png)

![Proposals with demo data: the monthly contribution and a drift rebalance, each explained, with whole-share orders](docs/images/proposals.png)

![Costs and tax with demo data: what each 複委託 broker would cost over the plan, a US$35 minimum fee weighing on a NT$5,000 order](docs/images/costs.png)

![Windfall planner with demo data: CAPE's percentile sets 24 tranches, ACWI's fall from its high, and the backtest of lump sum vs the rule since 1900](docs/images/windfall.png)

![Regression Lab with demo data: VT against the S&P 500 and TAIEX side by side, β with its interval, and the rolling β](docs/images/regression.png)

![Cost of equity with demo data: each market's 10-year yield and Damodaran's ERP, every stock's β and cost of equity](docs/images/capm.png)

![Valuation workbench with demo filings: AAPL valued a share by DCF, the dividend model and multiples, against its price](docs/images/valuation.png)

![Red flags with demo data: each company's nine indicators by level, its light and the share covered](docs/images/red-flags.png)

![Look-through with demo holdings: each company's exposure through the funds and held directly, coloured by sector](docs/images/look-through.png)

![Sectors with demo closes: the heatmap of each sector's return by period, US and Taiwan side by side](docs/images/sectors.png)

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
3. [Turn on the nightly job](docs/nightly-job.md): three GitHub secrets (two more optional, one of them for US filings), then one run by hand. 再[啟用每夜排程](docs/nightly-job.md)：設定 3 個 GitHub secrets（另有 2 個選填，其一用於美股財報），再手動執行一次。
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
| `lib/models/` | Positions, valuation, trade-date FX, data health, the R1 / R2 rules, performance (TWR, XIRR, FX split, NAV snapshots), drift and allocation lenses, the capital market assumptions, the Value at Risk, the projection engine, the rules engine, costs and tax, the windfall planner, the regression, the cost of equity, and the filings' figures and the valuation models, as pure functions 持倉、估值、交易日匯率、資料狀態、R1／R2 規則、績效（TWR、XIRR、匯率拆解、淨值快照）、偏離與配置分法、資本市場假設、風險值、預測引擎、規則引擎、費用與稅務、大額資金分批、回歸分析、權益成本、財報數字與估值模型，皆為純函式 |
| `lib/csv/` | Statement reading, column mapping and the import plan 對帳單讀取、欄位對應與匯入計畫 |
| `supabase/migrations/` | Schema, row-level security, reference data and change logs 資料庫結構、權限、參考資料與變更紀錄 |
| `supabase/seed.sql` | Demo data for local use only 僅供本機使用的示範資料 |
| `scripts/` | The nightly job and its feeds, the data-source check and the outside-in Supabase check 每夜排程與資料來源程式、資料來源檢查與 Supabase 外部檢查 |
| `.github/workflows/` | The nightly schedule 每夜排程設定 |
| `docs/` | Product spec and runbooks 產品規格與操作說明 |

## Data and privacy 資料與隱私

This repository is public and holds no personal data: no holdings, windfall figures or keys. The screenshots and `supabase/seed.sql` use invented demo numbers. Real data lives only in the owner's Supabase project, behind row-level security. 本 repo 公開，不含任何個人資料：沒有持股、大額資金數字或金鑰。截圖與 `supabase/seed.sql` 都是虛構的示範數字；真實資料只存在擁有者的 Supabase 專案中，受 row-level security 保護。
