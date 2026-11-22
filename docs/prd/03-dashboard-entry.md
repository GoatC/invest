[PRD](../PRD.md) › Section 3, Module E

# Module E — Dashboard, Entry & Visuals 儀表板、登錄與視覺化

**N4 Value at Risk indicator 風險值指標（首頁）**

- Purpose 目的: a simple home-screen gauge of how much the portfolio could lose in a bad week — a display, not a risk-management page. 首頁上的簡易指標，顯示投資組合在不利的一週可能損失多少；僅供顯示，不是正式的風險管理頁面。
- Method 方法: parametric (variance–covariance) VaR, 95% confidence, 1-week horizon with a 1-month toggle. Every holding is mapped to its class proxy, so idiosyncratic risk is left out by design. 以變異數–共變異數法計算，95% 信賴水準、1 週期間（可切換 1 個月）；每檔持股對應所屬類別的代理指數，刻意不計個別風險。

```latex
VaR_{95\%} = 1.645 \cdot \sigma_p \cdot \sqrt{h} \cdot V, \qquad \sigma_p = \sqrt{w^{\top} \Sigma \, w}
```

- Σ: covariance of 3 years of weekly proxy returns, measured in TWD (FX included). 共變異數取代理指數過去 3 年的台幣週報酬（含匯率）。
- Display 顯示: "95% 1-week VaR: NT$X (Y% of portfolio)", a 52-week sparkline, and the line "In about 1 week in 20, losses could exceed this." 「每 20 週約有 1 週，損失可能超過此金額。」

| Class 類別 | Proxy 代理指標 |
| --- | --- |
| US / global equity 美股／全球大盤 | VT |
| Taiwan market-cap equity 台股市值型 | 0050 |
| Global bonds 全球債券 | BNDW |
| Real assets 實體資產 | GLDM (gold price 金價) |
| Strategic cash 戰略現金 | BIL |
| US stocks sleeve 美股個股 | VOO (S&P 500) |
| Taiwan stocks sleeve 台股個股 | 0050 |
| Tactical themes 戰術主題 | The theme ETF itself, else VT 主題 ETF 本身，否則用 VT |

**N5 Holdings entry page 持倉登錄頁**

- Purpose 目的: the one page where Hugo records every buy and sell; it feeds F8, F18, N2, N4 and N6. 記錄每筆買賣的唯一頁面，資料提供給 F8、F18、N2、N4、N6。
- Form fields 表單欄位: trade date, market (US / TW / UK), ticker with autocomplete, buy / sell, quantity, price, trade currency, fee, tax, FX rate (auto-filled, editable), sleeve (auto-filled from the security), pool (regular / windfall), direction (long / short) and leverage (added 2026-11-05). 交易日、市場、代號（自動完成）、買賣、數量、價格、交易幣別、手續費、稅、匯率（自動帶入可修改）、部位（依證券自動帶入）、資金池、多空方向與槓桿倍數（2026-11-05 加入）。
- Direction & leverage 多空方向與槓桿 (added 2026-11-05): long (buy to open, sell to close) or short (sell short to open with borrowed shares, buy to cover); leverage = exposure ÷ own money, 1.0× up to config `leverage.max` (5.0× to start; the database accepts up to 10.0×) in steps of 0.1×. Only qty × price ÷ leverage of an opening trade is own money (a long's fee and tax come out of it, a short's out of the sale's proceeds); the rest is borrowed. A position's own money now is margin + s × (qty × price − entry value), s = +1 long, −1 short, which for a long at 1× is just its market value, so every trade saved before stays exactly as it was (long, 1×). A short is kept apart from a long of the same ticker and pool, never netted; a cover larger than the short is refused like an oversized sell. Before saving, the form shows the own money, the exposure, what is borrowed and the move that would use the own money up (1 ÷ leverage), and for a short that its loss has no ceiling and that 複委託 usually cannot short. CSV imports carry no direction or leverage: every imported trade is a long at 1×. Recording only: the app never places a trade (L2). 做多（買進開倉、賣出平倉）或做空（以借來的股票放空賣出開倉、買進回補）；槓桿 = 曝險 ÷ 自有資金，自 1.0 倍到 config `leverage.max`（起始 5.0 倍；資料庫最多接受 10.0 倍），以 0.1 倍為級距。開倉交易只有數量 × 價格 ÷ 槓桿是自有資金（做多的手續費與稅由自有資金支付，做空的由賣出所得扣除），其餘為借入。部位目前的自有資金 = 保證金 + s ×（數量 × 現價 − 開倉金額），做多 s = +1、做空 s = −1；1 倍做多即為市值，因此既有交易完全不變（做多、1 倍）。同一代號與資金池的做空與做多分開記錄，不互相抵銷；回補數量超過放空數量時，與超賣一樣會被拒絕。儲存前，表單顯示自有資金、曝險、借入金額，以及會虧光自有資金的價格變動（1 ÷ 槓桿）；做空時另提醒虧損沒有上限，且複委託通常不能放空。CSV 匯入不含方向與槓桿：所有匯入交易皆為 1 倍做多。只做紀錄：App 不會下單（L2）。
- Non-listed assets 非上市資產: physical gold entered in grams and valued at the TWD gold price; high-yield savings and money-market funds entered as balances. 實體黃金以克數輸入、依台幣金價估值；高利活存與貨幣基金以餘額輸入。
- Checks on save 儲存檢查: warns, without blocking, when a trade would break R1 (one stock above 5%) or R2 (satellite above 25%). Since 2026-11-05 both read gross exposure over the regular pool's own money: a stock's long and short lines added as absolute values, so a 3× long of NT$10,000 counts as NT$30,000. The rules engine (Section 4) leaves short and leveraged lines out and proposes trades on plain longs only, so a proposal never opens or adds to a short by selling, and their margin is never money a rule may move. 若交易會違反 R1 或 R2，顯示警示但不阻擋。2026-11-05 起兩者皆以總曝險除以一般資金池的自有資金計算：同一檔股票的做多與做空部位取絕對值相加，因此 NT$10,000 的 3 倍做多以 NT$30,000 計。規則引擎（第 4 節）不納入做空與槓桿部位，只對 1 倍做多的部位提出提案，因此提案不會以賣出開啟或加碼空單，其保證金也不會被規則挪用。
- Bulk import 批次匯入: 複委託 statement CSV with a column-mapping step remembered per broker. 匯入複委託對帳單 CSV，欄位對應設定依券商記憶。
- Holdings view 持倉總覽: quantity, average cost, market value in TWD, unrealised gain, actual vs target weight; every entry can be edited or deleted, with an audit log. 數量、平均成本、台幣市值、未實現損益、實際與目標權重；每筆紀錄可修改或刪除，並留存稽核紀錄。
- Price & trades 走勢與買賣點 (added 2026-11-09): tapping a listed holding's name opens /holdings/chart/[ticker]: its figures as tiles, its daily closes over a range (1 week, 1 month, 3 months, 1 year, 5 years, all) read at a step (day, week, month, year: each period's last close), each buy (▲) and sell (▼) marked at its trade date and recorded price, and the average cost of the long shares held as a dashed line. Closes as quoted, from the nightly job; display only. 點選上市持股名稱即開啟 /holdings/chart/[代號]：以小卡顯示該檔數字，並以每夜載入的每日收盤價畫出走勢，可選區間（1 週、1 月、3 月、1 年、5 年、全部）與週期（日、週、月、年，取每期最後收盤價）；每筆買進（▲）與賣出（▼）標在成交日與登錄價格上，虛線為目前做多持股的平均成本。收盤價未還原；僅供顯示。
- Cash-flow book 現金流帳 (asked by Hugo on 2026-11-12; lib/models/cash-flows.ts, app/holdings/cash-book.tsx): a buy or a sell counts in the cash-flow book by itself, read from the trades, so a purchase is recorded once, on the holdings page. A buy (or a short opened) counts its own money, qty × price ÷ leverage plus a long's fee and tax, at the trade's FX rate; a sell (or a cover) counts what it frees after its fee and tax. Regular pool: net put in = bought − sold. Windfall pool: deployed = bought − sold, against what arrived, the rest still waiting. cash\_flows keeps only what no trade tells: the windfall arriving, dividends and withdrawals; the form no longer offers "contribution", and one typed in earlier stays listed but is not added (its buy already counts). The 現金流 tab shows, top to bottom: the dividends to confirm, the totals as tiles (net put in, dividends, windfall arrived and deployed), a row of parts (all, trades, dividends, windfall) and one book of three columns (date, entry, TWD), each line opening the trade or cash flow it came from. 買進與賣出由交易自動計入現金流帳，買進只需在持倉頁記一次。買進（或放空開倉）計入自有資金：數量 × 價格 ÷ 槓桿，做多另加手續費與稅，依交易當日匯率；賣出（或回補）計入扣除手續費與稅後釋出的金額。一般資金池：淨投入 = 買進 − 賣出。大額資金池：已投入 = 買進 − 賣出，對照入帳金額，其餘為等待中。cash\_flows 只登錄交易看不出來的：大額資金入帳、股利、提領；表單不再提供「投入資金」，先前手動登錄的仍會列出但不加總（買進已計入）。「現金流」分頁由上而下：待確認的配息、數字卡（淨投入、股利、大額資金入帳與已投入）、篩選列（全部、買賣、股利、大額資金），以及三欄的帳（日期、項目、台幣金額），每一列可點開它的交易或現金流。
- Dividend prompts 配息詢問 (asked by Hugo on 2026-11-12; lib/models/dividends.ts): each night the job looks up the cash dividends of every Taiwan and US security held (dividend\_events: ex-dividend date, cash a share, payment date where the feed tells). From the payment date the app asks whether to record it, as an alert tile on the 現金流 tab, as the in-app banner and as one push; without a payment date it asks `pay_lag_days` after the ex-dividend date (US 7, Taiwan 30), an estimate. Entitled shares = the long shares held at the close of the day before the ex-dividend date, one pool at a time, in that day's units. Estimate = shares × cash a share × (1 − `withholding` by the security's domicile, US 30%), in TWD at the newest rate; "record" opens the cash-flow form filled in, and Hugo types what the broker paid. A dividend cash flow of the same security and pool dated from the ex-dividend date to `match_days` (30) after the asking day answers it (so a CSV import does too); "skip" answers it for good; unanswered, it is asked for `lookback_days` (60). A security whose income is reinvested by itself (an accumulating class, or a broker's reinvestment; securities.dividends\_reinvested, set under 配息詢問設定 on the tab; AGGU to start) is never asked about. Dividends still ahead are listed, folded. Recording only: no rule reads it and nothing is proposed. 每夜排程查詢所有持有的台股與美股標的的現金配息（dividend\_events：除息日、每股配息、來源有提供時的發放日）。發放日起，App 以「現金流」分頁的警示小卡、App 內橫幅與一則推播詢問是否登錄；沒有發放日時，以除息日加 `pay_lag_days`（美股 7 天、台股 30 天）估計。可領股數 = 除息日前一天收盤時的做多股數，各資金池分開計算，以當天的股數單位為準。估計金額 = 股數 × 每股配息 ×（1 − 依註冊地的 `withholding`，美國 30%），以最新匯率換算台幣；「記一筆」開啟已填好的現金流表單，由 Hugo 改成券商實際入帳金額。同一標的、同一資金池，日期在除息日到詢問日後 `match_days`（30）天內的股利現金流即視為已登錄（CSV 匯入的也算）；「略過」則不再詢問；未回應者持續詢問 `lookback_days`（60）天。配息自動再投入的標的（累積型，或券商代為再投入；securities.dividends\_reinvested，在分頁的「配息詢問設定」切換；起始為 AGGU）不詢問。尚未到期的配息收合列出。僅做紀錄：不被任何規則讀取，也不提出交易。
- Short and leveraged lines 做空與槓桿部位 (added 2026-11-05): such a line shows its direction and leverage as badges, its value as own money and its exposure (negative for a short) under its weight; a warning appears when its own money falls to config `leverage.margin_call_share` (30% to start) of what was put in or below, display only, no rule or push. A class's weight is its net exposure (a short subtracts) over the pool's own money, so leverage shows as weight. The value at risk measures each proxy by the TWD that moves with it (a short against the long it hedges), and performance (F18) counts only own money as put in and returns the gain on it, so a 2× long's daily return is twice the price's. 此類部位以標籤顯示方向與槓桿，價值為自有資金，權重下方顯示曝險（做空為負）；自有資金降到投入的 config `leverage.margin_call_share`（起始 30%）以下時顯示警示，僅顯示，不觸發規則或推播。類別權重為淨曝險（做空為減項）除以資金池的自有資金，因此槓桿會反映在權重上。風險值以隨各代理指標變動的台幣金額衡量（做空抵銷其避險的做多），績效（F18）只把自有資金算作投入，並以其計算報酬，因此 2 倍做多的日報酬為價格變動的兩倍。

**N6 Allocation donuts 資產配置圓餅圖**

Three lenses, switched by tabs. Where a target exists, the outer ring shows actual and the inner ring target; tapping a slice lists its holdings. 三種分法以分頁切換；有目標比例時，外圈為實際、內圈為目標；點選區塊即列出其中的持股。

| Lens 分法 | Slices 區塊 | Source field 來源欄位 |
| --- | --- | --- |
| Product type 產品類別 | Equity ETF, bond ETF, gold (ETF + physical), cash & MMF, individual stocks, theme ETF 股票 ETF、債券 ETF、黃金（ETF 與實體）、現金與貨幣基金、個股、主題 ETF | securities.product\_type |
| Listing country 上市國家 | US, UK (London), Taiwan, not listed 美國、英國（倫敦）、台灣、非上市 | securities.listing\_country |
| Active vs passive 主動與被動 | Passive core vs active satellite, target 80 / 20 被動核心 vs 主動衛星，目標 80／20 | securities.sleeve |

Listing country is where a fund trades, not what it owns: VT trades in the US but holds the world. Economic exposure lives in F14. 上市國家是交易所所在地，不等於實際投資地區：VT 在美國上市，但投資全球；實際曝險請見 F14。

**Visual analysis catalogue 視覺化分析圖表**

Every analysis page opens with a chart and puts its table underneath; charts use Apache ECharts, which covers heatmaps, treemaps, waterfalls and fan charts in one library. 每個分析頁都先呈現圖表，表格放在下方；圖表採用 Apache ECharts，一套函式庫即可涵蓋熱力圖、矩形樹狀圖、瀑布圖與扇形圖。

| Page 頁面 | Chart 圖表 | X axis X 軸 | Y axis Y 軸 | What it shows 呈現重點 |
| --- | --- | --- | --- | --- |
| N4 VaR | Histogram + cutoff line 分布圖與門檻線 | Weekly return % 週報酬 | Frequency 次數 | Where the 95% VaR sits in the return distribution 風險值在報酬分布中的位置 |
| F7 MVO | Scatter + curves 散佈圖與曲線 | Volatility σ 波動度 | Expected return 預期報酬 | Frontier, CML, each class, current vs target 效率前緣、資本市場線、各類別、目前與目標組合 |
| F7 MVO | Stacked area 堆疊面積圖 | Volatility σ 波動度 | Weight % 權重 | How weights shift along the frontier 沿效率前緣的權重變化 |
| F7 MVO | Heatmap 熱力圖 | Asset class 類別 | Asset class 類別 | Correlation matrix 相關係數矩陣 |
| N2 Brinson | Waterfall 瀑布圖 | Effect 效果 | Return contribution 報酬貢獻 | Benchmark → allocation → selection → interaction → FX → portfolio 從基準到組合報酬 |
| N2 Brinson | Quadrant scatter 象限散佈圖 | Active weight 主動權重 | Class relative return 類別相對報酬 | Whether over- and underweights paid off 加減碼是否帶來報酬 |
| N2 Brinson | Cumulative lines 累積折線圖 | Month 月份 | Cumulative effect 累積效果 | Which effect drives results over time 哪個效果主導長期績效 |
| F5 Monte Carlo | Fan chart 扇形圖 | Year 年 | Value (TWD) 資產值 | 10th / 50th / 90th percentile bands 百分位區間 |
| F5 Monte Carlo | Histogram 分布圖 | Year-30 value 第 30 年資產 | Frequency 次數 | Spread of outcomes vs target 結果分布與目標 |
| N1 Regression Lab | Scatter + fit; rolling line; bars with 95% CI 散佈圖、滾動線、信賴區間長條 | Market excess return / date / factor | Stock excess return / β / loading | Sensitivity and how stable it is 敏感度與穩定性 |
| F10 Stress test | Underwater chart 回撤圖 | Month 月份 | Drawdown % 回撤 | Depth and recovery time 深度與回本時間 |
| F18 Performance | Line + stacked bar 折線與堆疊長條 | Date 日期 | Cumulative return; FX split 累積報酬、匯率拆解 | Portfolio vs benchmark; local vs currency return 組合與基準、當地與匯率報酬 |
| F14 Look-through | Treemap 矩形樹狀圖 | — | — | Single-company exposure across core + satellite 核心與衛星的單一公司曝險 |
| N7 Sectors | Heatmap 熱力圖 | Period 期間 | Sector 產業 | Which sectors move, over which horizon 哪些產業在動、在哪個期間 |
| N7 Sectors | Treemap 板塊圖 | — | — | Portfolio exposure per sector, coloured by return 各產業曝險，依報酬上色 |
| N7 Sectors | Bubble 泡泡圖 | 1-year return 一年報酬 | Volatility 波動度 | Return against risk, sized by exposure 報酬對風險，大小為曝險 |
