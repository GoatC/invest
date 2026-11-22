[PRD](../PRD.md) › Section 3, Module C

# Module C — Security Analysis 證券分析

**F11 CAPM cost of equity (single stocks) CAPM 個股權益成本**

```latex
E(R_i) = R_f + \beta_i \left( E(R_m) - R_f \right)
```

- R\_f 無風險利率: US 10-year Treasury (FRED series DGS10) for US assets; Taiwan 10-year government bond for Taiwan assets. 美國資產用美國 10 年期公債殖利率，台灣資產用台灣 10 年期公債殖利率。
- Equity risk premium 股票風險溢酬: user-set, default from Damodaran's published implied ERP (free, updated monthly). 由使用者設定，預設採 Damodaran 每月公布的隱含風險溢酬。
- β comes from N1. β 取自 N1。Used for individual stocks only, as the cost of equity in F12; asset-class returns come from the CMA in F6. 只用於個股，作為 F12 的權益資金成本；資產類別的預期報酬改用 F6 的資本市場假設。

**N1 Regression Lab 回歸分析區 (Beta + Fama–French, absorbs F13)**

- Input 輸入: any US or Taiwan stock or ETF ticker (e.g. AAPL, 2330.TW, VT). 任何美股、台股或 ETF 代號。
- Model 模型: excess-return OLS regression, run against two benchmarks side by side — S&P 500 and TAIEX. 超額報酬的最小平方法回歸，同時對 S&P 500 與台灣加權指數各做一組。

```latex
R_{i,t} - R_{f,t} = \alpha_i + \beta_i \left( R_{m,t} - R_{f,t} \right) + \varepsilon_{i,t}
```

- Controls 可切換參數: frequency daily / weekly / monthly; window 1 / 2 / 3 / 5 years; default weekly, 2 years. Currency: local by default, TWD toggle. Model: 1-factor (CAPM β) in Phase 2; Fama–French 5-factor mode added in Phase 3. 頻率（日／週／月）、期間（1／2／3／5 年），預設週報酬 2 年；幣別預設為當地幣別，可切換台幣；模型：第二階段提供單因子（CAPM β），第三階段加入 Fama–French 五因子模式。
- Time-zone fix 時差修正: Taiwan closes before New York opens, so daily Taiwan returns vs S&P 500 are out of sync. On daily frequency, add a one-day lagged market term and report the summed (Dimson) beta. 台股收盤早於美股開盤，日報酬不同步；日頻率時加入落後一期的市場報酬，回報加總後的 Dimson β。
- Outputs 輸出:
  - Scatter plot with regression line, one panel per benchmark 散佈圖與回歸線，每個基準一個面板
  - β, annualised α, R², standard error, 95% confidence interval β、年化 α、R²、標準誤、95% 信賴區間
  - Adjusted β (Blume) = 0.67 × raw β + 0.33 調整後 β
  - Rolling β line chart, 52-week window 52 週滾動 β 時間序列
  - Compare mode: up to 5 tickers on one rolling-β chart 比較模式：最多 5 檔同圖比較. 5-factor mode: loadings on market, size, value, profitability and investment with t-statistics, per holding and for the whole portfolio, from the free Kenneth French data library. 五因子模式：各持股與整體組合的因子係數與 t 值
- What-if: long or short, with leverage 假設情境：做多或做空，加上槓桿 (added 2026-11-05): β and α above are for one dollar held long. Pick a direction, a leverage from 1.0× to 10.0× in 0.1× steps, an amount of own money and an index move (−30% to +30%); for each benchmark the page shows the position's β and α on own money (both × s × L, s = +1 long, −1 short), what the move would do to own money (s × L × β × move, the market part only, α and noise left out), and the index amount whose β cancels it (β × exposure: short the index when positive, buy it when negative). The unexplained 1 − R² is leveraged too, and α is before borrowing cost, borrow fees and a short's dividends. Analysis only, nothing saved. 上方的 β 與 α 是做多一元的結果。選擇方向、槓桿（1.0 至 10.0 倍，以 0.1 倍為級距）、自有資金金額與指數變動（−30% 到 +30%）後，頁面對每個基準顯示：部位對自有資金的 β 與 α（皆乘以 s × L，做多 s = +1、做空 s = −1）、該指數變動對自有資金的影響（s × L × β × 變動，只計市場部分，不含 α 與雜訊），以及可抵銷其 β 的指數金額（β × 曝險：正值為放空指數、負值為買進指數）。未被解釋的 1 − R² 同樣被放大；α 未扣除融資利息、借券費與做空須支付的股利。僅供分析，不儲存。

```latex
\beta_{position} = s \cdot L \cdot \beta_i, \qquad \alpha_{position} = s \cdot L \cdot \alpha_i, \qquad s = \begin{cases} +1 & \text{long} \\ -1 & \text{short} \end{cases}
```

**F12 Valuation workbench + watchlist alerts 估值工作台與觀察清單警報**

- DCF (FCFF) 自由現金流折現:

```latex
FCFF = EBIT(1-t) + D\&A - CapEx - \Delta NWC
```

```latex
WACC = \frac{E}{V} R_e + \frac{D}{V} R_d (1-t), \qquad TV_n = \frac{FCFF_{n+1}}{WACC - g}
```

- Equity value = enterprise value − net debt; per-share value ÷ diluted shares. R\_e from F11. 股東權益價值＝企業價值－淨負債，再除以稀釋後股數；R\_e 取自 F11。
- Also: Gordon dividend discount model; relative multiples (P/E, P/B, EV/EBITDA) vs peers and the company's own 5-year range. 另含 Gordon 股利折現模型，以及相對同業與自身 5 年區間的本益比、股價淨值比、EV/EBITDA。
- Scenarios 情境: bear / base / bull inputs give an intrinsic-value range. 悲觀／基本／樂觀三組假設，產出內在價值區間。
- Margin of safety 安全邊際 = (intrinsic value − price) ÷ intrinsic value.
- Watchlist alert 觀察清單警報: push when price ≤ base intrinsic value × (1 − 25%), threshold editable. Trim alert: push when price ≥ base intrinsic value × 1.25, editable. 股價低於基本情境內在價值的 75% 時推播，門檻可調。減碼警報：股價高於基本情境內在價值的 125% 時推播，門檻可調。
- Auto re-run 自動重算: when a new 10-Q / 10-K (SEC EDGAR) or Taiwan quarterly report (FinMind / MOPS) appears. 新財報公布時自動重算。
- Forward P/E check 本益比診斷 (added 2026-11-04): on each stock's workbench, today's trailing P/E (price ÷ the last four quarters' EPS) against the forward P/E on the analysts' consensus, so a buy can be weighed on what the market expects. Next twelve months' EPS = w × FY1 + (1 − w) × FY2, w = days left in FY1 ÷ 365; forward P/E = price ÷ that EPS, with its range at the highest and lowest analyst's EPS; growth = NTM ÷ TTM − 1; PEG = forward P/E ÷ (growth × 100). Three signals score +1 / −1: the forward P/E against the own five-year median P/E (else the peers'), cheap at 15% below, rich at 15% above, with the price at that median; PEG cheap ≤ 1, rich ≥ 2 (falling EPS reads rich); the 30-day move of the consensus, up or down beyond 1%. The mean target price and the ratings are shown, not scored. A score of ±2 leans the verdict cheap or expensive; fewer than 3 analysts, or a consensus older than 45 days, keeps it neutral. Thresholds in config `pe_check`. Display only: no rule, no push; the buy and trim zones stay the alerts. Data: US stocks' consensus from Alpha Vantage (EARNINGS_ESTIMATES and OVERVIEW, free key, loaded weekly by the nightly job into `analyst_estimates`); Taiwan has no free consensus feed, so Hugo types it in on the workbench (logged). Free feeds give the consensus of all covering analysts, not a ranking of the best: the highest and lowest EPS stand for the most bullish and bearish. 每檔個股的估值工作台加入本益比診斷：目前本益比（股價 ÷ 近四季 EPS）對照以分析師共識計算的預估本益比，作為買入判斷的參考。未來 12 個月 EPS ＝ w × 第一年度 ＋（1 − w）× 第二年度，w ＝ 第一年度剩餘天數 ÷ 365；預估本益比 ＝ 股價 ÷ 該 EPS，並以最高與最低 EPS 列出區間；成長率 ＝ NTM ÷ TTM − 1；PEG ＝ 預估本益比 ÷（成長率 × 100）。三個訊號各記 +1／−1：預估本益比相對自身五年本益比中位數（無則用同業），低 15% 偏便宜、高 15% 偏貴，並列出以該中位數計算的股價；PEG ≤ 1 偏便宜、≥ 2 偏貴（EPS 下滑視為偏貴）；共識 30 天內上修或下修超過 1%。平均目標價與評等只顯示、不計分。合計 ±2 才有偏便宜或偏貴的傾向；分析師少於 3 位或預估超過 45 天時維持中性。門檻在 config `pe_check`。只做顯示，不設規則、不推播；買入／減碼區仍是警報依據。資料：美股共識由每夜排程每週自 Alpha Vantage 載入 `analyst_estimates`；台股沒有免費共識來源，由 Hugo 在工作台自行輸入（留下紀錄）。免費來源提供的是全體追蹤分析師的共識而非「頂尖分析師」排名，最高與最低 EPS 即代表最樂觀與最悲觀者。

**F14 Combined look-through 核心與衛星合併透視**

- Output 輸出: holding overlap between ETFs, combined core + satellite exposure to each single company (e.g. TSMC held through ETFs and directly), region / sector / currency exposure, TER, tracking difference, domicile. ETF 間持股重疊度、核心加衛星對單一公司的合併曝險（例如透過 ETF 與直接持有的台積電）、區域／產業／幣別曝險、總費用率、追蹤差異、註冊地。
- Domicile flag 註冊地標示: US-domiciled funds are tagged for the 30% dividend withholding and US estate-tax exposure (feeds F15). 美國註冊基金標示 30% 股息預扣稅與美國遺產稅風險（提供給 F15）。
- Data 資料: issuer holdings files (free CSV downloads). 發行商公開的持股檔案。

**N3 Red-flag indicator 紅旗指標 (ESG + financial)**

Each company gets a red / amber / green light plus the list of indicators that fired; display only, no blocking. 每家公司顯示紅／黃／綠燈與觸發的指標清單；只做顯示，不阻擋操作。

| Indicator 指標 | Flag rule 判定規則 | Free source 免費來源 |
| --- | --- | --- |
| Beneish M-Score 財報操縱 | M > −1.78 → red | Financial statements (EDGAR, FinMind) |
| Altman Z-Score 財務危機 | Z < 1.81 → red; 1.81–2.99 → amber (Z″ for non-manufacturers) | Financial statements |
| Auditor change 更換會計師 | Any change in last 3 years → amber | SEC 8-K Item 4.01; MOPS 重大訊息 |
| Going-concern opinion 繼續經營疑慮 | Present → red | Audit report |
| Restatement 財報重編 | Any in last 3 years → red | SEC 8-K Item 4.02; MOPS |
| Cash flow vs earnings 現金流與盈餘背離 | Operating cash flow < net income for 3 years → amber | Financial statements |
| Governance rating 公司治理評鑑 | Bottom 35% → amber (Taiwan only) | TWSE 公司治理評鑑 |
| Environmental penalties 環境裁罰 | Any in last 3 years → amber | EPA ECHO (US); 環境部裁罰資料 (TW) |
| Excluded business 排除產業 | On Hugo's exclusion list → red | User-defined 自訂清單 |

Limitation 限制: no free source gives full ESG scores, so ESG coverage is partial and the light shows a coverage % beside it. 沒有免費來源提供完整 ESG 評分，因此 ESG 覆蓋不完整，燈號旁會標示資料覆蓋率。

**N7 Sector heatmap 產業熱圖** (added in Phase 2 第二階段加入)

A tab of its own (the menu's "Sectors 產業熱圖"), next to the Regression Lab, that shows at a glance which sectors are moving and how much of the portfolio sits in each, in three charts switched by tabs like N6's lenses. Display only: no rule, no push (design principle 2: decisions, not prices). 獨立分頁（選單「產業熱圖」），以三張可切換的圖表一眼看出哪些產業在動、投資組合在各產業放了多少；只做顯示，不設規則、不推播（設計原則 2：推播決策而非價格）。

- Sectors 產業: the 11 GICS sectors. US sectors are priced by the Select Sector SPDR ETFs (XLK, XLF, XLV, XLY, XLP, XLE, XLI, XLB, XLU, XLRE, XLC); Taiwan's by the TWSE industry indices (半導體業、電子零組件業、金融保險業 …), each mapped to a GICS sector in config `sectors` (editable), so the two markets share one list and can also be shown apart. 以 GICS 11 個產業為準：美國產業以 Select Sector SPDR ETF 計價；台灣以證交所類股指數計價，並在 config `sectors` 中對應到 GICS 產業（可修改），兩個市場共用一份清單，也可分開檢視。
- Heatmap 熱力圖: rows are sectors, columns are periods (1 week, 1 month, 3 months, year to date, 1 year); each cell's colour is the return on a diverging scale, with the % written in the cell. The colour convention is a setting: Taiwan's red-up, green-down by default (紅漲綠跌), or the US's green-up. 列為產業、欄為期間（1 週、1 月、3 月、今年以來、1 年），格子顏色為報酬（雙向色階），格內寫出百分比；配色為設定值，預設台灣慣例紅漲綠跌，可改為美國慣例綠漲。
- Treemap 板塊圖: one tile per sector, its area the portfolio's exposure in TWD through F14's look-through (the ETFs' holdings plus the stocks held directly, both pools or one), its colour the chosen period's return; tapping a tile opens the companies inside it. 每個產業一個方塊，面積為依 F14 穿透計算的台幣曝險（ETF 成分股加直接持股，可選資金池），顏色為所選期間的報酬；點選方塊展開其中的公司。
- Bubble chart 泡泡圖: one bubble per sector, x = its 1-year return, y = its annualised volatility (weekly returns, 1 year), size = the portfolio's exposure, colour = market (US / Taiwan); the portfolio's own exposure-weighted point is marked. 每個產業一顆泡泡：X 軸為 1 年報酬、Y 軸為年化波動度（1 年週報酬）、大小為投資組合曝險、顏色為市場（美國／台灣），並標出投資組合依曝險加權的位置。
- Each chart has its table underneath, and a sector lists the holdings behind it (directly and through each ETF), as N6's slices do. 每張圖下方都有表格；點選產業即列出背後的持股（直接持有與透過各 ETF），與 N6 相同。
- Data 資料: the sector proxies' daily closes, loaded by the nightly job into index\_prices (step 2's table) with one fallback each; exposure from F14. 類股代理的每日收盤價由每夜排程載入 index\_prices（第 2 步的資料表），各有一個備援；曝險取自 F14。
