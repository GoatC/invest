# End-to-end check 端對端檢查

`npm run test:e2e` builds the app, runs it against a local stand-in for Supabase loaded with the
migrations and the demo seed, and walks through it in Chromium: the web app manifest, icons and
security headers, sign-in, the holdings view and its
R1 / R2 figures, the holdings at a glance (a card per holding with its closes, buys, moves and signals; the ranking, cost, map and signal views; the sub-tabs and the + on a phone), adding, editing and deleting a trade, a refused oversized sell, gold and cash
balances, the cash-flow book (the seed's buys and sell counted from the trades, its parts, a USD dividend, the windfall arriving with its tiles, an edit and a delete), dividend prompts (dividends saved as the nightly job would: the amount worked out, one recorded from its tile with the form filled in, one skipped, one ahead, a reinvesting holding not asked; the in-app banner leading there and closed with ✕; later, the push job asking once), adding a
security, a Big5 broker-statement import (including a dividend row, an unknown ticker and a
second import of the same file), trade-date FX rates, the performance page (TWR against the SAA
benchmark, XIRR, the monthly and per-holding FX split, a chart tooltip, the windfall pool alone,
dark mode; by holding, each holding's part of the return adding up to the TWR), the allocation page (each class as a bar against its target and 5/25 band with the TWD over or under, the three donut lenses with a
slice's holdings, targets that must add up to 100% and are logged, capital market assumptions, a satellite class left blank auto-scored from its holdings by CAPM with the lines left out named, yours winning once typed, the setting logged),
the Value at Risk card on the dashboard and its folded details (the 1-week figure and its share from the seed's three years of
weekly demo closes, the 1-month toggle at × √4.33, the histogram with its cutoff, TWD balances
without risk, the formula, dark mode), the compounding calculator (the PRD acceptance case on
screen, the target mix's return and the DCA amount as starting values, the start month filling in
the starting value, a saved plan against the demo month ends with the gap split, dark mode), the
rules engine (each rule's finding on the Rules page, the DCA day and
a threshold edit with its log, Check the rules now raising R1, F8 and the monthly contribution
as standing warnings with their reasons and whole-share orders and nothing twice, no approval
steps, a suggested sale recorded as any trade, dismissing and the cooldown that follows), Web Push (the service worker loading without a session, a test push to
a stand-in push service on local HTTPS read with the stand-in device's own keys, a device that left
removed, the push job sending the weekly review and the standing warning once each), the weekly
dashboard as home (its three lines and the Section 5 order, the warning still standing after another check, dark mode), the
costs page (the yearly drag, each fund and broker over the plan with the demo figures, choosing a
broker so warnings estimate their fees, a fund's costs edited and checked, the Taiwan tax checks),
the US estate-tax rule (a windfall buy past US$60,000 drafts a suggestion with no orders, then is
undone), the windfall planner (CAPE's percentile from the seed's invented series since 1871 setting
24 tranches, ACWI's fall from its 52-week high, the backtest of lump sum vs the rule; the windfall
recorded as a cash flow and a TWD balance, the plan started from them, the tranche due raised as a
warning in the windfall pool with core classes only, the
tranche done once dismissed, the dashboard's plan line and coming week; then the plan, balance and
cash flow removed so the steps after it still see one warning standing), the Regression Lab (VT
against the S&P 500 and TAIEX from the demo closes: β with its standard error and interval,
Blume's β, α and R², the rolling line, the TWD toggle and monthly returns, five compared with their
intervals, the TWD risk-free rate saved and logged), the cost of equity (each market's 10-year yield,
Damodaran's ERP and Taiwan's premium from the seed, each demo stock's β worked out from its demo
closes and its cost of equity multiplied out, a typed ERP saved and logged), the valuation workbench (the watchlist, AAPL valued by DCF, the
dividend model and multiples from the seed's demo filings with FCFF and WACC worked out, scenarios
out of order refused, the assumptions saved with the valuation and logged, the rules and the
dashboard's watchlist reading it), the red-flag indicator (each company's nine indicators as a heatmap
and a table with their coverage, AAPL's Beneish M worked out from the demo filings and its invented
auditor change, an entry for 2330 scanned at once and prompting a review, deleted and logged, an
excluded industry turning 2330 red, the light on the watchlists), the look-through (the seed's invented
holdings files opening VT and 00692, TSMC through both and held directly, the overlap of the two,
countries, sectors and each fund's file, TER and domicile, the sector map logged), the sector tab (the
heatmap of returns by period from the seed's invented closes, one market at a time, the treemap of
exposure with a sector's companies, the bubbles with the portfolio's point, the colour convention
and the index map logged), the volatility alert (the score's year from the seed's invented series, each component's calm and panic, no score from figures too old, a figure saved and logged, the seeded central bank meeting, an election typed in at its Taipei time and deleted, logged; a score crossing 8 raising the panic warning with its reasons, the two rules on the Rules page and its row in the alert record; a breaking-news alert listed with its outlets and headline, pushed once, its settings logged), the life timeline (the plan, the band and the actuals on one chart, the phases, later goals with their chance, the goals logged), the five-factor mode (its prompt before the job, the live factors and VT's loadings after it), the efficient frontier (the curve, the capital market line, the tangent portfolio and the current and target mixes, the weights, the correlations, the rate and bounds logged), the attribution (the effects by class adding up to the gap, the waterfall, the quadrant, the periods and level 2), the stress test (three historical scenarios on today's holdings, the deepest fall, the tiers fired, a shock of your own), the Monte Carlo page (the fan around the saved plan, the median and the
range in today's money and nominal, the chance of a goal, the goal and an expected windfall logged), the data status page (the market series'
newest month included), a phone-width check of every page, the navigation (the four pills and their sub-tabs, a security's row of tabs, the groups' lists, the
phone tab bar and its More sheet),
the glass tab bar on a phone (floating clear of the edges, its names on one line, the lens following a drag and opening the tab it is let go over, drawn in to its icons on scrolling down), the dashboard's poster as the top of a phone's screen with the banner under it, opening the app afresh (the opening screen with the mark, the pages one tap away fetched before it lifts and every page of the navigation after it, then a tab, a sub-tab and a page under More opening without a request, no opening screen on a reload),
the iOS shell stood in for (its mark on the page and its message handler: no web tab bar, the five tabs and the page's place reported, a native tab opening its page without a request, the More list as a full page, the + clear of the native bar, the login page reported as signed out; a page opened by path and an address off the site refused; the reminders of the next 14 days served and handed over as chosen, the push page's reminder choices with the shell's answer, a choice handed over at once and kept on the phone),
a push of the web app into the iOS app (the choice on the web push page, the mark of a tapped push taken out of the address),
and sign-out. The walk-through itself runs with the preloading off (`localStorage.preload = 'off'`), so each step meets a server that is not busy with twenty other pages. Unless `E2E_NIGHTLY=0`, it then runs the real volatility job (`scripts/volatility.ts`, live CBOE, TAIFEX and policy-index feeds) against the stand-in and checks the score it saved and the live FOMC and CPI dates on the page, then runs the news job (`scripts/news.ts`, live Google News) and checks its seven counts. With a `FINMIND_TOKEN` in the environment it then removes the invented weekly
history, runs the real nightly job (`scripts/nightly.ts`, live feeds) against the stand-in
twice, the second time as on GitHub Actions, checks that the VaR proxies' live weekly closes hold
no split-sized jump, and checks what the app shows, the NAV snapshots, their VaR, the 52-week
line, the live monthly market series, the index closes, the holdings' monthly β, the live 10-year yields and ERP behind the cost of equity, the live filings of AAPL (SEC) and 2330 (FinMind) with the watched stock valued again included, the red-flag scan of both stocks against live SEC, TWSE and Ministry of Environment feeds, VT's and 00692's live holdings files with their sectors, every sector fund's and TWSE industry index's live closes with a year of returns, and the rules checked after the refresh; `E2E_NIGHTLY=0` skips that part.

`npm run test:e2e` 會建置 App，連到載入資料庫遷移與示範資料的本機 Supabase 替身，並以 Chromium 實際操作一遍：App 安裝設定檔、圖示與安全標頭、登入、持倉總覽與 R1／R2 數字、新增／修改／刪除交易、拒絕超賣、黃金與現金餘額、現金流帳（由交易自動計入的買賣、篩選、美元股利、大額資金入帳與數字卡、修改與刪除）、配息詢問（估計金額、從小卡登錄、略過、即將配息、自動再投入不詢問、App 內橫幅與關閉、推播一次）、新增證券、Big5 券商對帳單匯入（含股利列、未知代號與重複匯入）、交易日匯率、績效頁（時間加權報酬與 SAA 基準、XIRR、每月與各持股的匯率拆解、圖表提示框、只看大額資金池、深色模式）、資產配置頁（依 5/25 規則上色的偏離、三種分法的圓餅圖與區塊持股、合計須為 100% 且留下紀錄的目標權重、資本市場假設、留白的衛星類別依持股以 CAPM 自動評分並列出未納入的持股、自行輸入即優先、設定留下紀錄）、儀表板的風險值卡片與收合的詳細內容（以示範資料三年週收盤價計算的一週風險值與比例、× √4.33 的一個月切換、含門檻線的分布圖、台幣餘額不計風險、公式、深色模式）、複利計算機（畫面上的 PRD 驗收案例、以目標配置報酬與定期定額金額為預設值、起始月份自動帶入起始金額、儲存計畫後與示範資料月底值對照並拆解差距、深色模式）、規則引擎（規則頁各規則的狀態、扣款日設定與門檻修改紀錄、立即檢查規則發出 R1、F8 與每月投入的常駐警示並寫明原因與整股建議下單且不重複、沒有核准步驟、依建議登錄一筆交易、忽略與之後的冷卻期）、推播（不需登入即可載入的 service worker、送到本機 HTTPS 推播替身並以替身裝置金鑰解密的測試推播、移除已取消的裝置、推播排程每週檢視與常駐警示各只送一次）、每週儀表板首頁（三行摘要與第 5 節順序、再次檢查後警示仍在、深色模式）、大額資金分批（以示範資料 1871 年起虛構的 CAPE 百分位決定分 24 批、ACWI 自 52 週高點的跌幅、一次投入與本規則的回測；以現金流與台幣餘額登錄大額資金後建立計畫，到期的分批發出大額資金池、只含核心類別的警示，忽略後該批變成已完成，儀表板顯示計畫進度與下週分批日；最後刪除計畫、餘額與現金流，讓之後的步驟仍是 1 則警示）、回歸分析（以示範收盤價計算 VT 對標普 500 與加權指數的 β ± 標準誤、信賴區間、Blume β、α、R²、滾動線、台幣切換與月報酬、比較多檔的信賴區間、修改台幣無風險利率並留下紀錄）、權益成本（示範資料的各市場 10 年期殖利率、Damodaran 風險溢酬與台灣國家風險溢酬，由示範收盤價計算的個股 β 與代入數字的權益成本，自訂風險溢酬並留下紀錄）、估值工作台（觀察清單、以示範財報對 AAPL 做 DCF、股利折現與倍數法估值並列出 FCFF 與 WACC 算式、拒絕順序錯誤的情境、儲存假設與估值並留下紀錄、規則與儀表板觀察清單讀取已存估值）、合併透視（以示範成分股展開 VT 與 00692、透過兩者與直接持有的台積電、兩檔重疊度、國家與產業分布、各基金的成分股檔案、費用與註冊地，產業對應的修改紀錄）、紅旗指標（各公司九項指標的熱圖與表格、覆蓋率、以示範財報計算的 Beneish M、2330 的自行登錄立即重新掃描並發出檢視警示、刪除並留紀錄、排除產業讓 2330 轉紅、觀察清單的燈號）、產業熱圖（以示範收盤價計算各期間報酬的熱力圖、只看單一市場、依曝險繪製的板塊圖與產業內的公司、標出投資組合位置的泡泡圖、配色與類股指數對應的修改紀錄）、波動警報（以示範資料計算的近一年分數、各成分的平靜與恐慌值、資料過舊時不計分、修改數值並留下紀錄、預載的央行會議、以台北時間輸入並刪除選舉且留下紀錄；分數穿越 8 時發出附理由的恐慌警示、規則頁的兩條規則與影子紀錄中的一列；前沿新聞警報列出家數與標題、只推播一次、設定留下紀錄）、資料狀態頁（含每月市場資料的最新月份）、手機寬度檢查、導覽（四顆主按鈕、群組清單、手機底部分頁列與「更多」）、手機的玻璃分頁列（浮在頁面上、名稱同一基線、鏡片跟著拖曳並開啟放開處的分頁、往下捲動時縮成圖示）、手機儀表板的全版面海報與海報下方的橫幅、重新開啟 App（含標誌的啟動畫面、預載導覽的每一頁、之後點分頁不再發出請求、重新整理不再顯示啟動畫面）、iOS 外殼的替身（不畫網頁分頁列、回報五個分頁與所在分頁、原生分頁不發請求即開頁、「更多」整頁顯示、「＋」不被原生分頁列蓋住、登入頁回報未登入、依路徑開頁並拒絕站外網址、未來 14 天的提醒依手機上的選擇交給外殼、推播頁的提醒開關與外殼的回覆）、從網頁推播跳進 App（網頁推播頁的勾選、點推播後網址的標記被移除）與登出。未設 `E2E_NIGHTLY=0` 時，接著以真實資料（CBOE、期交所、政策不確定性指數）對替身執行波動排程，並檢查頁面顯示它存下的分數與真實的聯準會、CPI 日期，再以真實 Google 新聞執行新聞排程並檢查七個主題的家數。環境變數有 `FINMIND_TOKEN` 時，接著刪除虛構的週資料，以真實資料對替身執行兩次每夜排程（第二次模擬 GitHub Actions），檢查代理 ETF 的真實週收盤價沒有分割造成的跳動，並檢查 App 顯示的結果（含淨值快照、其風險值、近 52 週走勢線、真實的每月市場資料、指數收盤、每月持股 β，權益成本使用的真實 10 年期殖利率與風險溢酬，AAPL（SEC）與 2330（FinMind）的真實財報與重新估值，兩檔個股以 SEC、證交所與環境部真實資料完成的紅旗掃描，VT 與 00692 的真實成分股與產業，以及各類股 ETF 與證交所類股指數的真實收盤與一年報酬）；設 `E2E_NIGHTLY=0` 可略過。

## Timing the tab switches 量測換頁速度

`E2E_DRIVER=bench.mjs npm run test:e2e` runs the same stand-in but, in place of the walk-through,
times the phone's tab switches: an iPhone-sized screen with the CPU slowed four times, tapping
持倉, 績效, 配置, 回歸 (from the More sheet) and 儀表板 round after round, each until its h1 shows
with no loading placeholder left (settled), until its h1 first shows (title) and until the first
sign the tap was taken (first change). Before the taps it times the opening: a signed-in phone loading the app afresh three times, until the opening screen shows and until it lifts with the pages one tap away fetched (`BENCH_PRELOAD=0` turns the preloading off, to compare). `BENCH_NET_MS` adds that many milliseconds to every request between the phone and the app, as a mobile network does. `GATEWAY_DELAY_MS` adds that many milliseconds to every
Supabase request (150 ≈ Vercel in Washington to a Tokyo project; 5 ≈ both in Tokyo),
`BENCH_COLD=1` reloads before each tap so none is answered from the router cache, `BENCH_ROUNDS`
sets the rounds (4) and `BENCH_REPORT=file` writes the times as JSON. `GATEWAY_LOG=1` prints each
Supabase request with its time in the gateway log, to see a page's queries in sequence.

以 `E2E_DRIVER=bench.mjs` 執行時改為量測手機換頁時間；`GATEWAY_DELAY_MS` 模擬每次資料庫連線的延遲。

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
