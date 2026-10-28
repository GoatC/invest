# End-to-end check 端對端檢查

`npm run test:e2e` builds the app, runs it against a local stand-in for Supabase loaded with the
migrations and the demo seed, and walks through it in Chromium: the web app manifest, icons and
security headers, sign-in, the holdings view and its
R1 / R2 figures, adding, editing and deleting a trade, a refused oversized sell, gold and cash
balances, cash flows (a USD dividend, the windfall arriving, an edit and a delete), adding a
security, a Big5 broker-statement import (including a dividend row, an unknown ticker and a
second import of the same file), trade-date FX rates, the performance page (TWR against the SAA
benchmark, XIRR, the monthly and per-holding FX split, a chart tooltip, the windfall pool alone,
dark mode), the allocation page (drift coloured by the 5/25 rule, the three donut lenses with a
slice's holdings, targets that must add up to 100% and are logged, capital market assumptions),
the Value at Risk card and page (the 1-week figure and its share from the seed's three years of
weekly demo closes, the 1-month toggle at × √4.33, the histogram with its cutoff, TWD balances
without risk, the formula, dark mode), the compounding calculator (the PRD acceptance case on
screen, the target mix's return and the DCA amount as starting values, the start month filling in
the starting value, a saved plan against the demo month ends with the gap split, dark mode), the
rules engine (each rule's finding on the Rules page, the DCA day and
a threshold edit with its log, Check the rules now drafting R1, F8 and the monthly contribution
with their reasons and whole-share orders and nothing twice, editing the orders, approving,
recording the trade from the checklist, marking it filled, dismissing with a reason and the
cooldown that follows), Web Push (the service worker loading without a session, a test push to
a stand-in push service on local HTTPS read with the stand-in device's own keys, a device that left
removed, the push job sending the weekly review and the open proposal once each), the weekly
dashboard as home (its three lines and the Section 5 order, approving from it, dark mode), the
costs page (the yearly drag, each fund and broker over the plan with the demo figures, choosing a
broker so proposals estimate their fees, a fund's costs edited and checked, the Taiwan tax checks),
the US estate-tax rule (a windfall buy past US$60,000 drafts a suggestion with no orders, then is
undone), the windfall planner (CAPE's percentile from the seed's invented series since 1871 setting
24 tranches, ACWI's fall from its 52-week high, the backtest of lump sum vs the rule; the windfall
recorded as a cash flow and a TWD balance, the plan started from them, the tranche due drafted as a
proposal in the windfall pool with core classes only, its trade form in the windfall pool, the
tranche done once filled, the dashboard's plan line and coming week; then the plan, balance and
cash flow removed so the steps after it still see one proposal waiting), the Regression Lab (VT
against the S&P 500 and TAIEX from the demo closes: β with its standard error and interval,
Blume's β, α and R², the rolling line, the TWD toggle and monthly returns, five compared with their
intervals, the TWD risk-free rate saved and logged), the cost of equity (each market's 10-year yield,
Damodaran's ERP and Taiwan's premium from the seed, each demo stock's β worked out from its demo
closes and its cost of equity multiplied out, a typed ERP saved and logged), the data status page (the market series'
newest month included), a phone-width check of every page,
and sign-out. With a `FINMIND_TOKEN` in the environment it then removes the invented weekly
history, runs the real nightly job (`scripts/nightly.ts`, live feeds) against the stand-in
twice, the second time as on GitHub Actions, checks that the VaR proxies' live weekly closes hold
no split-sized jump, and checks what the app shows, the NAV snapshots, their VaR, the 52-week
line, the live monthly market series, the index closes, the holdings' monthly β, and the live 10-year yields and ERP behind the cost of equity included, and the rules checked after the refresh; `E2E_NIGHTLY=0` skips that part.

`npm run test:e2e` 會建置 App，連到載入資料庫遷移與示範資料的本機 Supabase 替身，並以 Chromium 實際操作一遍：App 安裝設定檔、圖示與安全標頭、登入、持倉總覽與 R1／R2 數字、新增／修改／刪除交易、拒絕超賣、黃金與現金餘額、現金流（美元股利、大額資金入帳、修改與刪除）、新增證券、Big5 券商對帳單匯入（含股利列、未知代號與重複匯入）、交易日匯率、績效頁（時間加權報酬與 SAA 基準、XIRR、每月與各持股的匯率拆解、圖表提示框、只看大額資金池、深色模式）、資產配置頁（依 5/25 規則上色的偏離、三種分法的圓餅圖與區塊持股、合計須為 100% 且留下紀錄的目標權重、資本市場假設）、風險值卡片與頁面（以示範資料三年週收盤價計算的一週風險值與比例、× √4.33 的一個月切換、含門檻線的分布圖、台幣餘額不計風險、公式、深色模式）、複利計算機（畫面上的 PRD 驗收案例、以目標配置報酬與定期定額金額為預設值、起始月份自動帶入起始金額、儲存計畫後與示範資料月底值對照並拆解差距、深色模式）、規則引擎（規則頁各規則的狀態、扣款日設定與門檻修改紀錄、立即檢查規則產生 R1、F8 與每月投入提案並寫明原因與整股下單清單且不重複、修改下單清單、核准、從執行清單登錄交易、標記成交、附理由略過與之後的冷卻期）、推播（不需登入即可載入的 service worker、送到本機 HTTPS 推播替身並以替身裝置金鑰解密的測試推播、移除已取消的裝置、推播排程每週檢視與待處理提案各只送一次）、每週儀表板首頁（三行摘要與第 5 節順序、從首頁核准、深色模式）、大額資金分批（以示範資料 1871 年起虛構的 CAPE 百分位決定分 24 批、ACWI 自 52 週高點的跌幅、一次投入與本規則的回測；以現金流與台幣餘額登錄大額資金後建立計畫，到期的分批產生大額資金池、只含核心類別的提案，交易表單自動選大額資金池，標記成交後該批變成已完成，儀表板顯示計畫進度與下週分批日；最後刪除計畫、餘額與現金流，讓之後的步驟仍是 1 份待處理提案）、回歸分析（以示範收盤價計算 VT 對標普 500 與加權指數的 β ± 標準誤、信賴區間、Blume β、α、R²、滾動線、台幣切換與月報酬、比較多檔的信賴區間、修改台幣無風險利率並留下紀錄）、權益成本（示範資料的各市場 10 年期殖利率、Damodaran 風險溢酬與台灣國家風險溢酬，由示範收盤價計算的個股 β 與代入數字的權益成本，自訂風險溢酬並留下紀錄）、資料狀態頁（含每月市場資料的最新月份），以及手機寬度檢查與登出。環境變數有 `FINMIND_TOKEN` 時，接著刪除虛構的週資料，以真實資料對替身執行兩次每夜排程（第二次模擬 GitHub Actions），檢查代理 ETF 的真實週收盤價沒有分割造成的跳動，並檢查 App 顯示的結果（含淨值快照、其風險值、近 52 週走勢線、真實的每月市場資料、指數收盤、每月持股 β，以及權益成本使用的真實 10 年期殖利率與風險溢酬）；設 `E2E_NIGHTLY=0` 可略過。

## What the stand-in is 替身的組成

Hosted Supabase is PostgreSQL behind an API gateway. The stand-in runs the same open-source parts
on the machine, without Docker:

| Part | Here |
| --- | --- |
| Database | PostgreSQL 16, with `stand-in/bootstrap.sql` creating the roles a Supabase project starts with |
| Auth | Supabase Auth (GoTrue) `v2.177.0`, the release binary |
| Data API | PostgREST `v12.2.3`, the release binary |
| Gateway | `stand-in/gateway.mjs`: routes `/auth/v1` and `/rest/v1`, and turns the publishable key into the anon role and the secret key into service_role |

Every run uses a fresh database, a new random JWT secret, publishable and secret key and owner
password, and deletes the database at the end. Nothing touches the hosted project. The database
also gets the seed's newest USD/TWD rate dated today, so the trade form's trade-date rate reads the
same whatever day the check runs.

每次執行都使用全新的資料庫與隨機產生的金鑰與密碼，結束時刪除資料庫；完全不會碰到雲端的 Supabase 專案。

## Where it runs 執行環境

Claude Code cloud sessions: Linux x86-64 as root, with PostgreSQL 16 (`/usr/lib/postgresql/16`),
`psql`, `iconv`, `openssl` (the stand-in push service's throwaway certificate) and Playwright's
Chromium (`/opt/pw-browsers`). It downloads the two release
binaries from GitHub on the first run. It is not meant for a Mac; Hugo does not need to run it.

此檢查供 Claude Code 雲端環境使用（Linux），Hugo 不需要在 Mac 上執行。

Screenshots of each screen and the service logs are kept in `/tmp/invest-e2e` (set `E2E_HOME` to
change it). The run leaves a `.next` build pointing at the stand-in; run `npm run build` again
before `npm start` against the real project.

Two optional outputs: `DOCS_SHOTS=dir` saves the README images into `dir`, and `TEXT_REPORT=file`
writes each page's visible text as JSON: the characters of prose (paragraphs, list items, hints and
banners outside tables, legends and tiles), of summary tiles, and the prose lines themselves, so a
change that adds sentences shows up. What sits folded behind ⓘ is not counted.

另有兩個選用輸出：`DOCS_SHOTS=資料夾` 會存下 README 用的截圖；`TEXT_REPORT=檔案` 會把每頁可見文字的字數（段落、提示與摘要小卡分開計算）與段落內容寫成 JSON，方便檢查文字量是否又變多。收在 ⓘ 內的說明不計入。
