# 執行 App Running the app

這份說明接在 [Supabase 設定](supabase-setup.md) 之後：那 6 個步驟做完（`npm run check:supabase` 全部 ✅）就可以在自己的 Mac 上打開 App，登入、輸入交易、匯入券商對帳單。

This follows the Supabase setup. Once its six steps pass, the app runs on your Mac: sign in, record trades, import broker statements. To put it online and on your phone, see [Deploy to Vercel](deploy-vercel.md).

## 1. 取得最新程式並更新資料庫 Get the code, update the database

在 `invest` 資料夾執行：

```bash
git checkout main && git pull           # 合併前想先試用：改用 git checkout claude/peaceful-knuth-gzi48q && git pull
npm install
npx supabase db push
npm run check:supabase
```

- `git pull`：下載合併後的最新程式。
- `npm install`：安裝網頁需要的套件（Next.js、React、Supabase 用戶端），只裝在專案資料夾裡。
- `npx supabase db push`：會列出 **2 個新的 migration**，輸入 `Y` 套用：
  - `latest_quotes`：「每檔最新價格」與「每個幣別最新匯率」兩個檢視表（view），持倉頁用它們計算市值。
  - `fx_rate_check`：匯率打錯字的警示門檻（預設 20%），存在 `config` 表，之後可以自己改。
  - 之後的步驟若有新的 migration，PR 說明裡會寫出來。第 6 步新增 `allocation_settings`：在 `config` 表加入 `cma`（資本市場假設，一開始是空的）與 `drift_display`（偏離何時轉黃色）兩個設定。
  - 第 7 步新增 `value_at_risk`：一個檢視表 `weekly_prices`（每檔證券每週最後一筆收盤價，風險值卡片用它計算三年的週報酬），並在 `nav_snapshots` 的 `var_95_1w` 欄位加上說明。不會改動任何資料。
  - 第 8 步新增 `projection`：在 `config` 表加入一個設定，存放複利計算機儲存的計畫（一開始沒有計畫，只有通膨率 2%、每年調升 0%、30 年三個暫定值）。不會改動任何資料。
  - 第 9 步新增 `rules_engine`：替 `proposals`（提案）表加上「觸發狀態、計算依據、關閉原因、成交時間」四個欄位，並記錄每次提案變更。不會改動任何資料。
- `npm run check:supabase`：應該看到 **24 項全部 ✅**（比上次多了 2 個 view，陌生人同樣讀不到；第 4 步之後是 25 項，第 7 步之後是 26 項，多的是 `weekly_prices`）。如果出現「找不到資料表，請先執行 db push」，代表上一行還沒成功。

`db push` adds two views for the newest price and FX rate, and the FX typo-check setting; the check then shows 24 passes.

## 2. 啟動 App Start the app

```bash
npm run dev
```

看到 `Local: http://localhost:3000` 之後，用瀏覽器打開 <http://localhost:3000>，以 Supabase 設定第 4 步建立的 email 與密碼登入。

- App 只在你的 Mac 上執行；Terminal 視窗要保持開著。
- 關閉 App：在 Terminal 按 `Control` + `C`。
- 下次要用時，在 `invest` 資料夾再執行一次 `npm run dev` 即可（`npm install` 與 `db push` 只有程式更新後才需要）。

Run `npm run dev`, open http://localhost:3000 and sign in with your Supabase account. Stop it with Control-C.

## 3. 第一次使用 First use

持倉頁一開始是空的：示範資料只用在測試，不會送到你的專案。

- **新增交易**：輸入代號後，幣別與交易日當天的匯率會自動帶入（每夜排程啟用後；之前是最近一筆匯率）；對帳單上有券商成交匯率時，請改成那個匯率。市場與部位（核心／衛星）由證券自動帶入。
  - 找不到代號：按「找不到？新增證券」，填名稱、市場、產品類別與資產類別後儲存，會回到新增交易。
  - 儲存前會即時檢查 R1（單一個股超過一般資金池 5%）與 R2（衛星部位超過 25%）：違反時只提醒，不會阻擋。
  - 賣出數量超過當時持有數量會被拒絕，通常代表漏記了一筆買進。
- **黃金與現金**：按「新增非上市資產」。實體黃金以克數輸入；每夜排程啟用後，持倉頁會以每夜金價自動計算市值，表單裡的估值只在還沒有金價時使用。高利活存與貨幣基金以台幣餘額輸入。
- **現金流**：按「新增現金流」，記錄資金的進出。股利會計入績效頁的資金加權報酬（XIRR）；投入資金與提領只做紀錄，因為績效從資金買進持股（或登錄為存款等非上市資產）那天才開始計算。金額一律填正數，方向由類型決定：
  - **投入資金**：你投入的錢，例如每月定期定額扣款 NT$10,000。扣款買到的股數，另外照常記成交易。
  - **大額資金入帳**：大額資金進來的那一天，一律計入大額資金池。
  - **股利**：持股發放的現金股利，填扣除預扣稅後實際收到的金額；選代號後，幣別與當天匯率會自動帶入。
  - **提領**：從投資組合拿出去的錢。
  - 已記錄的現金流列在持倉頁最下方，可以修改或刪除，每次修改都留下紀錄。
- **匯入 CSV**：
  1. 從券商網站下載成交明細，存成 CSV。
  2. 在「匯入 CSV」頁填券商名稱、選擇檔案。Big5 編碼、檔案上方的標題列都會自動判斷。
  3. 檢查欄位對應與每一列的預覽：買進、賣出存成交易；**現金股利存成「股利」現金流**（金額取自「股利金額」欄位，通常是成交金額或 Amount 欄）；合計列等其他列會略過並說明原因。已經存在的交易與股利會標示「已存在」，不會重複匯入。
  4. 外幣交易如果檔案裡沒有匯率欄：「沒有匯率的列使用的匯率」留空，會帶入每一列交易日的匯率（匯率下方顯示是哪一天的）；也可以填一個匯率套用到整份檔案。
  5. 檔案裡有還沒新增的代號時，點「新增 XXX」（在新分頁開啟）新增後，回來按「重新檢查」。
  6. 按「匯入」。欄位對應會依券商名稱記住，下次選同一家券商就會自動套用。
- **修改與刪除**：持倉頁的交易紀錄、非上市資產、現金流都有「修改」連結；每次修改都留下紀錄，顯示在該筆資料頁面的最下方。
- **績效**：上方選單「績效」。上方可選資金池（兩個合計、一般、大額資金）與期間（開始至今、今年以來、近 1 年、近 3 年）。
  - **時間加權報酬（TWR）**：持股本身的表現，不受你何時投入資金影響，拿來和 SAA 基準（依目標權重組成的代表 ETF 組合）比較。
  - **資金加權報酬（XIRR）**：把你每筆買進、賣出與股利的時點都算進去，反映你自己的投入時點。
  - **損益**：期間內市值的變化，扣掉這段期間投入與取回的資金。
  - 一年以上的期間以年化表示；未滿一年則是期間報酬，避免把幾週的漲跌放大成年化數字。
  - **每月報酬**長條圖與**外幣持股匯率拆解**表，把台幣報酬拆成「當地幣別報酬＋匯率報酬＋交叉項」，看得出報酬有多少來自美元升貶。
  - 每張圖下方按「以表格顯示」可看到所有數值；最下方「計算方式」說明每個數字怎麼算。
  - 每夜排程還沒有收盤價的日子，以交易價格或手動估值計算，頁面會註明。
- **資產配置**：上方選單「資產配置」。
  - **與目標權重的偏離**：各資產類別在一般資金池的實際權重減目標權重。核心類別依 5/25 規則上色：超過門檻（5 個百分點，或目標的四分之一，取較小者）為紅色 ✕「需再平衡」，超過一半為黃色 !「留意」，其餘為綠色 ✓。衛星類別由 R2 以整體衡量（表格最下面一列）。
  - **修改目標權重**：按「修改目標權重」。合計必須剛好 100% 才能儲存；每次修改都留下紀錄。衛星目標若不是 20%，記得同時修改 rules 表中 R2 的 `target_weight`。
  - **資本市場假設**：按「修改假設」，替每個核心類別填預期年報酬、年化波動度與來源（例如某機構的長期展望）。複利計算機以它們依目標權重算出的報酬為預設值；還沒決定的可以先留白。
  - **配置圓餅圖**：三個分頁切換產品類別、上市國家、主動與被動；點選區塊或表格列，下方列出其中的持股。預設顯示一般資金池，內圈是 80／20 目標；也可切換到兩個資金池合計或大額資金池。
- **風險值（VaR）**：持倉頁的「風險值（整個投資組合）」卡片，或上方選單「風險值」。
  - **它在說什麼**：「95% 一週風險值：NT$X（投資組合的 Y%）」的意思是：每 20 週大約有 1 週，整個投資組合（兩個資金池合計）的損失可能超過 NT$X。它只是提醒你風險有多大的指標，不是保證，也不是上限。
  - **一週／一個月**：卡片上方可以切換；一個月的數值 ＝ 一週 × √4.33（一個月約 4.33 週）。
  - **怎麼算的**：每檔持股以所屬資產類別的代理 ETF 衡量（VT、0050、BNDW、GLDM、BIL、VOO，就是「修改目標權重」裡的基準 ETF），用這些 ETF 過去三年、每週五到週五的台幣報酬（含匯率變動）算出彼此的波動與相關性。個股本身的風險刻意不計，所以集中持有的衛星個股看起來會比實際低。
  - **台幣存款不算風險**：活存、以餘額登錄的貨幣基金以台幣計價不會波動，計入市值但不增加風險值。
  - **近 52 週走勢線**：每夜排程每天存下當天的風險值，卡片下方的線每週取一點。剛開始只有幾點，會隨時間變長。
  - **「風險值」頁**：分布圖顯示今天的持股組合在過去三年每週的報酬，以及有幾週損失超過風險值（預期約每 20 週 1 週）；下面列出每檔代理 ETF 的權重、波動度與占風險值的比例，以及代入今天數值的公式。
  - 卡片寫「代理 ETF 的資料還不夠久」：代表每夜排程還沒載入三年的價格；啟用排程並執行一次後就會出現。信賴水準等數值存在 `config` 表的 `var`，可以在 Table Editor 修改。
- **提案與規則**：上方選單「提案」。
  - **先設定扣款日**：按「規則與門檻」，在最上方填每月定期定額的金額與**扣款日**（例如每月 6 日填 6），按「儲存」。沒填扣款日之前，「每月投入」規則不會觸發。
  - **提案從哪來**：每晚價格更新後，App 會檢查規則；也可以按「立即檢查規則」。規則觸發時會產生提案，例如「R1：2330 超過一般資金池 5%，賣出 1 股」、「每月投入：把 NT$10,000 買進最低於目標的兩個類別」。每份提案都寫出原因、數字與整股的下單清單（以最近收盤價估算）。
  - **你要做的事**：看過後按「核准」，或先按「修改下單清單」改股數（填 0 代表不做這筆），不同意就填理由按「略過」。核准後會出現執行清單：到券商下單後，按每一筆的「登錄交易」，交易表單會自動帶入代號、買賣與股數，把價格、手續費、匯率改成成交單上的數字再儲存（也可以改用匯入券商 CSV）。全部登錄後，按「標記為已成交」。
  - **不會一直吵**：同一條規則一週內最多提一次（除非觸發的狀態改變，例如換了一檔股票超標）；14 天沒處理的提案會自動關閉並重新檢查；略過的每月投入不會再提。
  - **App 從不下單**：所有交易都由你在券商完成（L2）。
  - **規則頁**：列出每條規則目前的狀態（觸發中、未觸發、冷卻中、等待扣款日、之後的步驟才會評估），並可以展開修改門檻、冷卻天數與啟用狀態；每次修改都留下紀錄。
- **複利計算機**：上方選單「複利計算機」。
  - **輸入**：起始月份、起始金額（PV）、每月投入（PMT，預設為定期定額 NT$10,000）、每年調升比例（例如隨加薪多投入 3%）、預期年報酬（預設為「資本市場假設」依目標權重算出的報酬）、通膨率與年數。改任何一格，下面的數字與圖表立刻重算。
  - **結果**：幾年後的資產（名目台幣）、換算今天的幣值、累計投入、累計成長、實質年報酬，以及最後一個月要投入多少。長條圖每年一根：灰色是投入的錢，藍色是成長；橘色線是換算今天幣值的資產。
  - **起始月份與 PV**：改起始月份時，在你自己輸入 PV 之前，PV 會自動帶入一般資金池在前一個月底的市值；起始月份在未來時，帶入目前的市值。
  - **儲存為我的計畫**：把這組輸入存成計畫，之後每個月底，下方「實際與計畫對照」會比較一般資金池的實際市值與計畫，並把差距拆成「投入金額」（你實際投入的比計畫多或少）與「成長」（報酬比計畫好或差）。投入金額依交易計算：錢買進持股後才算投入，還在銀行等待扣款的錢不會被算成落後。
  - 計畫保存自己的數字：之後修改定期定額金額或資本市場假設，不會改變已儲存的計畫；想用新數字，就重新儲存一次。每次儲存都留下紀錄。
  - 這是以固定報酬計算的預測，不是預言；實際報酬每年起伏，第三階段的蒙地卡羅模擬會顯示可能的範圍。

Add trades by hand or import a broker CSV (the column mapping is remembered per broker, cash dividends become cash flows, and entries already saved are skipped). Record contributions, the windfall arriving, dividends and withdrawals as cash flows; dividends count in the performance page's money-weighted return, while contributions and withdrawals are records only, as money counts once it is invested. The Performance page shows the time-weighted return against the SAA benchmark, the money-weighted return (XIRR), the gain and the FX split, per pool and period. The Allocation page shows each class's drift from its target, coloured by the 5/25 rule, lets you edit the targets and the capital market assumptions, and slices the portfolio by product type, listing country and active vs passive. The Value at Risk card (holdings page and its own page) shows how much the whole portfolio could lose in a bad week, 1 week in 20, with a 1-month toggle and a 52-week line; TWD balances add value but no risk. Proposals: after each nightly update, or with Check the rules now, a rule that fires (R1, R2, F8 drift, the monthly contribution once its debit day is set on the Rules page, the January review) drafts a proposal with whole-share orders; approve, edit or dismiss it, record the trades from its checklist and mark it filled. The app never trades. The Calculator projects the regular pool year by year from a starting value, a monthly contribution with a yearly step-up, an expected return and inflation, in nominal TWD and today's money; save the inputs as your plan to compare the pool with it at every month end. R1 and R2 warn without blocking; a sell larger than the holding is refused. Every entry can be edited or deleted, with its history kept.

## 補充 Notes

- 標著 ＊ 的金額是估計值：每夜排程還沒載入的證券或幣別，暫以你最近一筆交易的價格與匯率估算；還沒有金價時，黃金以你最後輸入的估值計算。每夜排程的設定見 [每夜價格排程](nightly-job.md)。
- R1／R2 的門檻來自 `rules` 表，匯率警示門檻來自 `config` 表的 `fx_rate_check`；都能在 Supabase 的 Table Editor 修改，不需要改程式。第 9 步起，規則的門檻、冷卻天數與啟用狀態也可以在 App 的「規則」頁修改。
- 只有登入後的你看得到資料；畫面顯示「無法從資料庫讀取」時，多半是程式更新後還沒執行 `npx supabase db push`。
- 如果 `npm run dev` 顯示 Node.js 版本太舊，請到 <https://nodejs.org> 安裝 LTS 版本後重開 Terminal。

Figures marked * are estimates until the nightly price job ([setup](nightly-job.md)) has loaded their price. Thresholds live in the `rules` and `config` tables, never in code. A "could not read" page usually means `npx supabase db push` is still to be run.
