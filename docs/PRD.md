# Long-View Investment App — PRD 長期投資 App 產品規格書

Oct 20, 2026 · @Goat · v1.0 · Ready for Claude Code 可交付 Claude Code

## 📌 Investment Principles 投資原則

80% passive core, 20% active satellite — and two rules keep the satellite from growing past its share. 80% 被動核心、20% 主動衛星，並以兩條規則防止衛星部位超出應有比例。

| Sleeve 部位 | Asset class 資產類別 | Target 目標 | Vehicles 工具 |
| --- | --- | --- | --- |
| 🛡️ Core 核心 80% | 📈 US / global equity 美股／全球大盤 | 28% | VOO / VT |
| 🛡️ Core 核心 80% | 📈 Taiwan market-cap equity 台股市值型 | 12% | 00692 / 009816 / 00922 |
| 🛡️ Core 核心 80% | 🏛️ Global bonds 全球債券 | 22% | BNDW / AGGU |
| 🛡️ Core 核心 80% | 🪙 Real assets 實體資產 | 10% | GLDM / physical gold 實體黃金 |
| 🛡️ Core 核心 80% | 💵 Strategic cash 戰略現金 | 8% | MMF / BIL / high-yield savings 高利活存 |
| 🎯 Satellite 衛星 20% | 🚀 US stocks 美股個股 | 10% | Market leaders, 2–3 names 龍頭公司 2–3 檔 |
| 🎯 Satellite 衛星 20% | 🏭 Taiwan stocks 台股個股 | 5% | Local edge or supply-chain leaders, 1–2 names 在地優勢／供應鏈龍頭 1–2 檔 |
| 🎯 Satellite 衛星 20% | ⚡ Tactical themes 戰術主題 | 5% | Theme ETFs or stocks 其他主題 ETF 或個股 |

Equity totals 40% in the core (28% + 12%) and 20% in the satellite. 核心股票合計 40%（28% ＋ 12%），衛星 20%。

**Rule 1 — Single-stock cap 單一個股上限:** no single stock above 5% of the portfolio, so the 20% satellite holds at most 4–5 names. 任何單一個股不超過投資組合的 5%，因此 20% 的衛星部位最多持有 4–5 檔。

**Rule 2 — 25% rebalancing trigger 25% 再平衡觸發:** when strong stock picks push the satellite above 25% of the portfolio, trim it mechanically back to 20%. 當主動選股表現極佳、使衛星部位漲到超過投資組合的 25% 時，機械式減碼回 20%。

Scope 適用範圍: these percentages apply to the regular-contribution pool; the windfall goes to core classes only (F3). 以上比例適用於一般投入資金池；大額資金只投入核心類別（見 F3）。

## 1. Overview & Principles 產品概述與設計原則

A single-user PWA that runs a 30-year core–satellite portfolio on written rules, is reviewed once a week, and pushes an alert only when a decision is due. 一個單人使用的 PWA：依書面規則運行 30 年的核心／衛星投資組合，每週檢視一次，只有在需要做決定時才推播。

**Users 使用者:** Hugo only. The app is also a learning project and a portfolio piece for graduate applications. 僅 Hugo 本人使用；同時是學習專案，也是研究所申請的作品集。

**Design principles 設計原則**

1. **SAA first 配置優先** — Core ETFs carry the portfolio; satellite stocks are capped and must pass valuation and red-flag checks. 核心 ETF 是投資組合的主體；衛星個股有比例上限，且必須通過估值與紅旗檢查。
2. **Decisions, not prices 推播決策而非價格** — No real-time price alerts; every push names a rule that fired and the action it proposes. 不推播即時股價；每則推播都要指出觸發的規則與建議的動作。
3. **Human in the loop (L2) 人在迴路中** — The app drafts order lists; Hugo confirms and places every trade manually at the broker. No broker API access. 由 App 產生建議下單清單，Hugo 確認後到券商手動下單；不串接券商 API。
4. **Explain every number 每個數字都可解釋** — Each model shows its formula, inputs and assumptions, in English and Chinese. 每個模型都以中英雙語顯示公式、輸入值與假設。
5. **Free data only 只用免費資料** — All phases run on free data sources; paid upgrades stay an open question. 所有階段都只使用免費資料；是否升級付費資料列為待決問題。

**Non-goals 非目標:** day trading, automatic order execution, multi-user or commercial use, real-time quote streaming. 不做當沖、不自動下單、不支援多人或商業使用、不提供即時報價串流。

## 2. User Context & Decisions 使用者情境與已定決策

Every parameter below is decided; the spec builds on them as fixed inputs. 下表所有參數都已確定，本規格書以它們作為固定輸入。

| Parameter 參數 | Decision 決策 |
| --- | --- |
| Monthly contribution 每月投入 | About NT$10,000, fully automatic DCA 約 NT$10,000，全自動定期定額 |
| Starting assets 起始資產 | Under NT$100,000 低於 NT$100,000 |
| Horizon 投資期間 | 30 years 30 年 |
| Base currency 基準幣別 | TWD; all returns reported in TWD 台幣，所有報酬以台幣計算 |
| Strategy 策略 | Core ETFs + satellite stocks; satellite set at 20% of the regular-contribution pool (see Investment Principles), traded and valued in earnest 核心 ETF ＋ 衛星個股，衛星部位占一般投入資金的 20%（見投資原則），認真估值並實際操作 |
| Rebalancing 再平衡 | Annual + drift threshold, new cash first 年度加偏離門檻，優先用新資金調整 |
| Windfall 大額資金 | About NT$5.5M expected within 10 years; core ETFs and bonds only; kept outside the satellite cap 約 NT$550 萬，預計 10 年內入帳，只投入核心 ETF 與債券，不計入衛星上限 |
| Windfall pace 分批節奏 | Length set dynamically by market valuation 依市場估值動態決定分批期間 |
| Windfall in a drawdown 分批中遇大跌 | Accelerate tranches in tiers 分級加速投入 |
| Review cadence 檢視頻率 | At least weekly; push summary opens the dashboard 每週至少一次；推播摘要點開即進入儀表板 |
| Automation level 自動化層級 | L2: app drafts orders, Hugo places them manually L2：App 產生建議清單，Hugo 手動下單 |
| Accounts 帳戶 | Taiwan brokerage now; foreign assets via 複委託 only, in principle 已有台股帳戶；海外資產原則上僅透過複委託 |
| Data budget 資料預算 | Free sources only 只用免費資料 |
| Build method 開發方式 | Built entirely through Claude Code 完全由 Claude Code 開發 |

The spec is written so Claude Code can implement each phase without further design decisions. 本規格書的寫法，讓 Claude Code 可以直接實作各階段，不需再補設計決策。

## 3. Feature Specs 功能規格

Nineteen features ship across three phases; IDs keep the numbering from the original 20-feature list, and N1–N6 are new. 共 19 個功能，分三個階段上線；編號沿用原本 20 項清單，N1–N6 為新增功能。

| ID | Feature 功能 | Module 模組 | Phase 階段 | Automation 自動化 |
| --- | --- | --- | --- | --- |
| F2 | Compounding & DCA calculator 複利與定期定額計算機 | A Planning | 1 | Weekly projection refresh 每週更新預測 |
| F6 | SAA builder + capital market assumptions SAA 配置建構器與資本市場假設 | B Allocation | 1 | Daily drift check 每日檢查偏離 |
| F8 | Rebalancing engine (core classes) 再平衡引擎（核心類別） | B Allocation | 1 | Drafts rebalance list (L2) 產生再平衡清單 |
| F15 | Fee & tax drag (+ US estate-tax check) 費用與稅務拖累（含美國遺產稅檢查） | D Cost | 1 | Check on every valuation 每次估值時檢查 |
| F18 | True performance (XIRR / TWR, FX split) 真實績效（含匯率拆解） | D Cost | 1 | Daily NAV snapshot 每日淨值快照 |
| N5 | Holdings entry page 持倉登錄頁 | E Dashboard | 1 | R1 / R2 check on save 儲存時檢查規則 |
| N4 | Value at Risk indicator (home) 風險值指標（首頁） | E Dashboard | 1 | Daily recompute 每日重算 |
| N6 | Allocation donuts, 3 lenses 資產配置圓餅圖（三種分法） | E Dashboard | 1 | Live from holdings 隨持倉即時更新 |
| F3 | Windfall tranche planner (core only) 大額資金分批部署（僅核心資產） | A Planning | 2 | Schedules, accelerates, drafts tranches (L2) 自動排程、加速、產生清單 |
| F11 | CAPM cost of equity (single stocks) CAPM 個股權益成本 | C Analysis | 2 | Monthly refresh 每月更新 |
| F12 | Valuation workbench + buy / trim alerts 估值工作台與買入／減碼警報 | C Analysis | 2 | Re-runs after each filing 財報公布後重算 |
| N1 | Regression Lab: Beta, then Fama–French 5-factor 回歸分析區 | C Analysis | 2 (5-factor: 3) | Monthly refresh for holdings 持股每月更新 |
| N3 | Red-flag indicator (ESG + financial) 紅旗指標 | C Analysis | 2 | Weekly scan 每週掃描 |
| F14 | Combined look-through (core + satellite) 核心與衛星合併透視 | C Analysis | 2 | Monthly holdings refresh 每月更新成分股 |
| F1 | 30-year life timeline (tab) 30 年人生財務時間軸（分頁） | A Planning | 3 | Weekly overlay of actuals 每週疊加實際值 |
| F5 | Monte Carlo simulation (shares F2 engine) 蒙地卡羅模擬（與 F2 共用引擎） | A Planning | 3 | Monthly re-run 每月重跑 |
| F7 | Efficient frontier & CML (reference only) 效率前緣與資本市場線（僅供參考） | B Allocation | 3 | On demand 手動執行 |
| F10 | Stress test & scenario replay 壓力測試與情境回放 | B Allocation | 3 | On demand 手動執行 |
| N2 | Brinson attribution (2 levels, FX split) Brinson 績效歸因 | D Cost | 3 | Monthly 每月 |

Three dropped features live on inside others: the US estate-tax check sits in F15, currency effects sit in F18 and N2, the IPS becomes the rules engine in Section 4, and F13 is merged into N1's Regression Lab. 三項刪除的功能併入其他功能：美國遺產稅檢查併入 F15，匯率效果併入 F18 與 N2，IPS 成為第 4 節的規則引擎；F13 併入 N1 回歸分析區。

### Module A — Planning 大局規劃

**F2 Compounding & DCA calculator 複利與定期定額計算機**

- Purpose 目的: project portfolio value in nominal and real TWD, with contributions that grow with salary. 以名目與實質台幣預估資產，投入金額可隨薪資成長。
- Logic 邏輯: monthly compounding, r = annual return ÷ 12; growing contributions with monthly step-up rate g.

```latex
FV = PV(1+r)^{n} + PMT \cdot \frac{(1+r)^{n} - (1+g)^{n}}{r - g}, \quad r \neq g
```

- Real return 實質報酬 = (1 + nominal) ÷ (1 + inflation) − 1.
- Inputs 輸入: PV, PMT (default NT$10,000), annual step-up %, expected return (from the capital market assumptions in F6), inflation, years.
- Output 輸出: value path by year, total contributed vs total growth, actual-vs-projected gap. F2 and F5 share one projection engine: F2 is its deterministic mode, F5 its stochastic mode. 逐年資產曲線、累計投入與累計成長、實際值與預測值的差距。F2 與 F5 共用同一個預測引擎：F2 為確定性模式，F5 為隨機模式。

**F3 Windfall tranche planner 大額資金分批部署**

- Purpose 目的: deploy about NT$5.5M into core ETFs and bonds only, in tranches whose pace follows market valuation; none of it goes to the satellite. 依市場估值決定節奏，將約 NT$550 萬分批投入核心 ETF 與債券，不投入衛星個股。
- Pace rule 節奏規則 (defaults, editable 預設值可調整): valuation gauge = S&P 500 Shiller CAPE percentile over its history (free proxy for global valuation).
  - Percentile below 30 → 6 monthly tranches 低於第 30 百分位 → 分 6 個月
  - 30–70 → 12 monthly tranches 第 30–70 百分位 → 分 12 個月
  - Above 70 → 24 monthly tranches 高於第 70 百分位 → 分 24 個月
- Acceleration rule 加速規則: if MSCI ACWI falls 15% or more from its 52-week high, the next tranche is pulled forward and merged into the current one (double tranche). 若 MSCI ACWI 自 52 週高點回落 15% 以上，下一批提前併入本批（雙倍投入）。
- Deeper tiers 加深級距: at a 25% or deeper drawdown, deploy 50% of the remaining balance; at 35% or deeper, deploy all of it. Each tier fires once per drawdown, then the normal pace resumes. 回落 25% 以上投入剩餘資金的 50%；35% 以上全數投入。每個級距在同一波下跌中只觸發一次，之後恢復原節奏。
- Undeployed cash 未投入資金: held in a TWD money-market or time deposit; shown as its own line in the dashboard. All windfall money is tagged pool = windfall, so it never counts toward the satellite cap. 存放於台幣貨幣市場基金或定存，在儀表板單獨顯示。所有大額資金標記為「大額資金池」，不計入衛星上限。
- Output 輸出: tranche calendar, each tranche split by core SAA weights (satellite excluded) into a draft order list (L2), backtest of lump sum vs this rule. 分批日曆、依核心 SAA 權重（不含衛星）拆成每批建議清單（L2）、與一次投入的回測比較。

**F5 Monte Carlo simulation 蒙地卡羅模擬**

- Logic 邏輯: 10,000 paths of monthly returns, bootstrapped from historical asset-class returns to keep fat tails; contributions and the F3 windfall included; runs on the F2 projection engine. 以歷史資產類別報酬做 10,000 條月報酬路徑的自助抽樣（保留肥尾），納入每月投入與 F3 大額資金。
- Output 輸出: 10th / 50th / 90th percentile value at years 10, 20, 30; probability of reaching a user-set target. 第 10／50／90 百分位在第 10、20、30 年的資產值，以及達成自訂目標的機率。

**F1 30-year life timeline 30 年人生財務時間軸**

- Purpose 目的: a timeline tab (the weekly dashboard is the home screen); shows phases (accumulation, windfall deployment, later goals) with F2 and F5 projections and actual values overlaid. 時間軸分頁（首頁為每週儀表板）：顯示各階段（累積期、大額資金部署期、後續目標），並疊加 F2、F5 的預測與實際值。

### Module B — Allocation 配置引擎

**F6 SAA builder SAA 配置建構器**

- Purpose 目的: hold the target weights for each asset class and the core / satellite split; the reference for F8, F18 and N2. 儲存各資產類別的目標權重與核心／衛星比例，作為 F8、F18、N2 的基準。
- Asset classes 資產類別 (editable 可編輯): US / global equity, Taiwan market-cap equity, global bonds, real assets (gold), strategic cash, plus three satellite sleeves (US stocks, Taiwan stocks, tactical themes); target weights in Investment Principles. 美股／全球大盤、台股市值型、全球債券、實體資產（黃金）、戰略現金，以及三個衛星部位（美股個股、台股個股、戰術主題）；目標權重見投資原則。
- Each class maps to one benchmark ETF or index for return measurement. Capital market assumptions (CMA): Hugo sets an expected return and volatility for each core class, with a source note; F2, F5 and F7 read from it. 每個類別對應一檔基準 ETF 或指數，用於計算報酬。資本市場假設（CMA）：由 Hugo 為每個核心類別設定預期報酬與波動度並註明來源，提供給 F2、F5、F7 使用。
- Satellite target 衛星目標: 20% of the regular-contribution pool (windfall excluded); above 25% the rules engine proposes a mechanical trim back to 20%. F8 never buys satellite stocks to fill the target; satellite buys come only from buy-zone alerts. 目標為一般投入資金池的 20%（不含大額資金）；超過 25% 時由規則引擎提出機械式減碼回 20%；F8 不會為補足目標而買進衛星個股，衛星買進只來自買入區警報。
- Output 輸出: current vs target weights, drift in percentage points, colour-coded. 目前權重與目標權重、偏離百分點，以顏色標示。

**F8 Rebalancing engine 再平衡引擎**

- Trigger 觸發 (5/25 rule): a core class drifts more than 5 percentage points absolute, or more than 25% relative to its target; plus a calendar check every January. 任一核心類別絕對偏離超過 5 個百分點，或相對偏離超過目標的 25%；另每年 1 月定期檢查。
- Cash-flow first 現金流優先: each monthly contribution is allocated to underweight core classes before any sale is proposed; up to 20% of it may go to the satellite instead while a buy-zone alert is open. To limit minimum-fee drag, each month's cash goes to at most the two most underweight classes. 每月新投入資金先補足權重不足的核心類別，再考慮賣出；有買入區警報時，最多 20% 可改投衛星個股；為降低最低手續費拖累，每月資金最多只投入權重最不足的兩個類別。
- Output 輸出: draft order list with ticker, side, amount in TWD and in trade currency, estimated fees (from F15). Hugo confirms, then trades manually. 建議下單清單（代號、買賣方向、台幣與交易幣別金額、預估費用），由 Hugo 確認後手動下單。

**F7 Efficient frontier & CML 效率前緣與資本市場線**

- Logic 邏輯: long-only mean–variance optimisation with weights summing to 1 and per-class min / max bounds; expected returns from the CMA in F6, covariance from 10 years of monthly returns. 只做多的均值–變異數最適化，權重總和為 1，各類別有上下限；預期報酬取自 F6 的資本市場假設，共變異數取 10 年月報酬。

```latex
Sharpe = \frac{E[R_p] - R_f}{\sigma_p}
```

- Output 輸出: frontier curve, capital market line, current and target portfolios plotted as points. Reference only: it never writes back to F6 targets. 效率前緣曲線、資本市場線，並標出目前與目標投資組合的位置。結果僅供參考，不會自動改寫 F6 的目標權重。

**F10 Stress test & scenario replay 壓力測試與情境回放**

- Scenarios 情境: 2008 global financial crisis, 2020 COVID crash, 2022 rate shock, plus a custom shock. 2008 金融海嘯、2020 新冠崩盤、2022 升息衝擊，另可自訂情境。
- Logic 邏輯: apply each scenario's asset-class returns (in TWD) to current weights. 將各情境的資產類別報酬（以台幣計）套用到目前權重。
- Output 輸出: maximum drawdown in % and NT$, months to recover, and which F3 acceleration tiers would have fired. 最大回撤（百分比與台幣金額）、回本所需月數，以及會觸發哪些 F3 加速級距。

### Module C — Security Analysis 證券分析

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

### Module D — Cost & Performance 成本與績效

**F15 Fee & tax drag 費用與稅務拖累（含美國遺產稅檢查）**

- Broker comparison 券商比較: 複委託 brokers compared with each other — commission, minimum fee, FX spread, custody fee, and whether London-listed (Irish-domiciled) ETFs are offered. 比較各家複委託券商的手續費、低消、匯差、保管費，以及是否提供倫敦掛牌（愛爾蘭註冊）ETF。
- Fund costs 基金成本: TER, tracking difference, dividend withholding (US-domiciled 30%; Irish-domiciled about 15% at fund level), accumulating vs distributing. 總費用率、追蹤差異、股息預扣稅（美國註冊 30%、愛爾蘭註冊約 15%）、累積型與配息型。
- Taiwan tax checks 台灣稅務檢查: overseas income against the minimum-tax threshold; supplementary NHI premium on Taiwan dividends. 海外所得是否達最低稅負制門檻、台股股息的二代健保補充保費。
- US estate-tax check 美國遺產稅檢查: push when US-situs assets exceed US$60,000; suggests Irish-domiciled equivalents. 美國資產超過 US$60,000 時推播，並建議改用愛爾蘭註冊的同類 ETF。
- Output 輸出: annual drag in % and NT$, and the 30-year cumulative cost of each choice. 每年拖累的百分比與台幣金額，以及各選項 30 年的累計成本。
- Tax thresholds are stored as editable config, never hard-coded, because rules change. 稅務門檻存為可編輯設定，不寫死在程式中，因為法規會變動。

**F18 True performance 真實績效**

- Money-weighted return 資金加權報酬 (XIRR): reflects Hugo's own timing of contributions. 反映 Hugo 自己的投入時點。
- Time-weighted return 時間加權報酬 (TWR): reflects the portfolio's return independent of cash flows; compared against the SAA benchmark. 排除現金流影響的組合報酬，與 SAA 基準比較。
- FX split 匯率拆解: each foreign holding's TWD return = local-currency return + currency return + cross term. 每檔外幣資產的台幣報酬＝當地幣別報酬＋匯率報酬＋交叉項。
- Daily NAV snapshot after the last market close. 每日最後一個市場收盤後記錄淨值快照。

**N2 Brinson attribution Brinson 績效歸因**

- Method 方法: Brinson–Fachler, benchmark = Hugo's SAA target weights. 採 Brinson–Fachler 法，基準為 Hugo 的 SAA 目標權重。

```latex
A_i = (w_{p,i} - w_{b,i})(R_{b,i} - R_b), \quad S_i = w_{b,i}(R_{p,i} - R_{b,i}), \quad I_i = (w_{p,i} - w_{b,i})(R_{p,i} - R_{b,i})
```

- Level 1 第一層 — asset classes 資產類別: did drift away from targets help or hurt (allocation), and did chosen ETFs beat each class benchmark (selection)? 偏離目標權重是加分還是扣分（配置效果）？所選 ETF 是否勝過各類別基準（選擇效果）？
- Level 2 第二層 — satellite sleeve by sector 衛星部位依產業: benchmark = sector weights of the core global-equity ETF, so the benchmark still comes from the SAA itself. 基準為核心全球股票 ETF 的產業權重，讓基準仍來自 SAA 本身。
- Currency effect 匯率效果: reported as a separate column at both levels. 兩層都另列匯率效果欄位。
- Multi-period linking 多期連結: Carino smoothing so monthly effects add up to the period total. 以 Carino 平滑法連結，使各月效果加總等於期間總效果。
- Output 輸出: waterfall chart from benchmark return to portfolio return; monthly auto-run, any date range on demand. 從基準報酬到組合報酬的瀑布圖；每月自動執行，也可指定任意期間。

### Module E — Dashboard, Entry & Visuals 儀表板、登錄與視覺化

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
- Form fields 表單欄位: trade date, market (US / TW / UK), ticker with autocomplete, buy / sell, quantity, price, trade currency, fee, tax, FX rate (auto-filled, editable), sleeve (auto-filled from the security), pool (regular / windfall). 交易日、市場、代號（自動完成）、買賣、數量、價格、交易幣別、手續費、稅、匯率（自動帶入可修改）、部位（依證券自動帶入）、資金池。
- Non-listed assets 非上市資產: physical gold entered in grams and valued at the TWD gold price; high-yield savings and money-market funds entered as balances. 實體黃金以克數輸入、依台幣金價估值；高利活存與貨幣基金以餘額輸入。
- Checks on save 儲存檢查: warns, without blocking, when a trade would break R1 (one stock above 5%) or R2 (satellite above 25%). 若交易會違反 R1 或 R2，顯示警示但不阻擋。
- Bulk import 批次匯入: 複委託 statement CSV with a column-mapping step remembered per broker. 匯入複委託對帳單 CSV，欄位對應設定依券商記憶。
- Holdings view 持倉總覽: quantity, average cost, market value in TWD, unrealised gain, actual vs target weight; every entry can be edited or deleted, with an audit log. 數量、平均成本、台幣市值、未實現損益、實際與目標權重；每筆紀錄可修改或刪除，並留存稽核紀錄。

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

## 4. Rules Engine, L2 Automation & Push 規則引擎、自動化與推播

Automation is conditional: the app evaluates written rules after every data refresh, drafts a proposal when one fires, and stops there until Hugo confirms. 自動化是有條件的：每次資料更新後，App 會評估書面規則；規則觸發時產生提案，之後停下等待 Hugo 確認。

**Rules engine 規則引擎** — the Investment Policy Statement in executable form. Each rule stores: id, plain-language description (EN / 中文), condition, threshold, action, cooldown, enabled flag. Every edit is logged with date and old / new value. The two Investment Principles rules load as R1 and R2. 規則引擎即可執行版本的投資政策聲明。每條規則記錄：編號、中英文說明、條件、門檻、動作、冷卻期、啟用狀態；每次修改都記錄日期與新舊數值。投資原則的兩條規則即為 R1 與 R2。

**L2 proposal flow 提案流程**

1. Scheduled job refreshes data, then evaluates all enabled rules. 排程工作更新資料後，評估所有啟用中的規則。
2. A fired rule creates a proposal with a draft order list. 觸發的規則產生一份附建議下單清單的提案。
3. Push notification sent to phone and Mac. 推播到手機與 Mac。
4. Hugo opens the proposal: approve, edit or dismiss (optional reason). Hugo 打開提案：核准、修改或略過（可附理由）。
5. Approved → an execution checklist (ticker, quantity, amount); Hugo trades at the broker. 核准後顯示執行清單，由 Hugo 到券商下單。
6. Hugo marks it filled with actual price and quantity, or imports the broker statement CSV; transactions update. Hugo 標記成交價量，或匯入券商對帳單 CSV，交易紀錄隨之更新。
7. Unactioned proposals expire after 14 days and are re-evaluated. 14 天內未處理的提案會失效並重新評估。

**Push rules 推播規則** (all thresholds editable 所有門檻皆可調整)

| Trigger 觸發事件 | Condition 條件 | Proposal 提案內容 | Source 來源 |
| --- | --- | --- | --- |
| Monthly contribution 每月投入 | Day after the DCA date 定期定額扣款隔日 | Confirm fill; allocate new cash to underweight classes 確認成交、新資金補足低配類別 | F8 |
| Drift rebalance 偏離再平衡 | 5/25 rule breached 違反 5/25 規則 | Draft rebalance list 再平衡清單 | F8 |
| Annual review 年度檢查 | First weekend of January 每年 1 月第一個週末 | Full rebalance check + rules review 完整再平衡與規則檢視 | F8 |
| Windfall tranche due 分批到期 | Tranche date reached 分批到期日 | Tranche order list 該批下單清單 | F3 |
| Windfall acceleration 分批加速 | ACWI drawdown ≥ 15% / 25% / 35% | Accelerated tranche order list 加速批次下單清單 | F3 |
| Buy zone 進入買入區 | Price ≤ intrinsic value × 0.75 | Watchlist entry + draft order, subject to R1 / R2 觀察清單與建議單（受 R1／R2 限制） | F12 |
| Valuation updated 估值更新 | New filing moves intrinsic value by more than 10% 新財報使內在價值變動超過 10% | Review prompt 提醒重新檢視 | F12 |
| Red flag worsens 紅旗惡化 | A holding moves green → amber or amber → red 持股燈號轉差 | Review prompt 提醒重新檢視 | N3 |
| R2 Satellite 25% trigger 衛星 25% 觸發 | Satellite above 25% of the regular-contribution pool 衛星超過一般投入資金池的 25% | Trim proposal 減碼提案 | Rules |
| US estate tax 美國遺產稅 | US-situs assets > US$60,000 | Swap to Irish-domiciled suggestion 改用愛爾蘭註冊建議 | F15 |
| Data failure 資料異常 | A daily job fails twice in a row 每日工作連續失敗兩次 | System alert 系統警示 | Pipeline |
| Trim zone 進入減碼區 | Price ≥ intrinsic value × 1.25 股價高於內在價值的 125% | Trim proposal 減碼提案 | F12 |
| R1 Single-stock cap 單一個股上限 | One stock above 5% of the regular-contribution pool 單一個股超過一般投入資金池的 5% | Trim proposal 減碼提案 | Rules |
| Red flag turns red 紅旗轉紅 | A satellite holding moves to red 衛星持股燈號轉紅 | Re-review prompt with exit option 重新檢視提示，附出場選項 | N3 |

**Noise controls 降噪設計:** quiet hours 23:00–08:00 Taipei; each rule fires at most once per 7 days unless its state changes; no price-movement alerts. 安靜時段為台北時間 23:00–08:00；同一規則 7 天內最多觸發一次（狀態改變時除外）；不推播價格波動。

## 5. Weekly Review 每週檢視

Once a week a three-line push summary opens a dashboard that leads with rule status, not profit and loss; this dashboard is the app's home screen. 每週一則三行推播摘要，點開後進入儀表板；儀表板先呈現規則狀態，而非損益；此儀表板即為 App 首頁。

**Schedule 時間:** Sunday 20:00 Taipei by default, editable (day and time not yet chosen). 預設週日晚上 8 點（台北時間），可調整（尚未指定）。

**Push text 推播內容 (max 3 lines 最多三行)**

1. Rules: all on track, or N proposals waiting 規則：全部正常，或有 N 份提案待處理
2. Allocation: largest drift in percentage points 配置：最大偏離百分點
3. Portfolio value and change since last week, in TWD 投資組合價值與週變化（台幣）

**Dashboard weekly view 儀表板週檢視** (top to bottom 由上而下)

1. Open proposals with approve / dismiss buttons 待處理提案（核准／略過）
2. SAA drift bars, colour-coded green / amber / red 以綠／黃／紅標示的 SAA 偏離長條
3. VaR card: 95% one-week Value at Risk in NT$ and % (N4) 風險值卡片：95% 一週風險值（台幣與百分比）
4. Allocation donut with three lens tabs (N6) 資產配置圓餅圖，三種分法分頁
5. Windfall progress: deployed vs remaining, on schedule or accelerated 大額資金進度：已投入與剩餘、依排程或加速中
6. Watchlist: distance to buy and trim zones, and red-flag light per company 觀察清單：距離買入區與減碼區的幅度，以及紅旗燈號
7. Coming week: DCA date, tranche dates, earnings dates of holdings 下週事件：扣款日、分批日、持股財報日
8. Actual vs projected path (F2) 實際與預測路徑對照

Monthly and quarterly outputs (N2 attribution, F5 re-run, N1 5-factor results) appear in the weekly view only in the week they update. 每月與每季產出（N2 歸因、F5 重跑、N1 五因子結果）只在更新當週出現在週檢視。

## 6. Architecture & Data Sources 系統架構與資料來源

The stack is a Next.js PWA on Vercel plus a Supabase backend, built entirely with Claude Code and running on free tiers. 技術架構為部署在 Vercel 的 Next.js PWA，加上 Supabase 後端；完全以 Claude Code 開發，使用免費方案運行。

&#91;embedded content: System architecture · 3 layers, 1 human checkpoint\]

Nightly jobs pull free data into Postgres; the rules engine turns fired rules into proposals, pushes them, and Hugo trades by hand. Fills come back through manual entry or a broker statement CSV. A GitHub Actions cron runs the nightly job itself and writes to Postgres with the Supabase secret key, kept in GitHub's encrypted secrets; its nightly reads and writes also keep the free project from auto-pausing. (Changed in Phase 1, step 4 from calling a Supabase Edge Function: on the free plan an Edge Function stops after 2 seconds of CPU time and 150 seconds in all, too little for three years of prices and AGGU's 25 MB fund file.) 每夜排程把免費資料寫入資料庫；規則引擎把觸發的規則變成提案並推播，由 Hugo 手動下單；成交資料再以手動輸入或券商對帳單 CSV 匯回。每夜排程直接在 GitHub Actions 執行，以存放在 GitHub 加密 secrets 中的 Supabase secret key 寫入資料庫；每晚的讀寫同時避免免費專案因閒置而自動暫停。（第一階段第 4 步起改變：原本規劃呼叫 Supabase Edge Function，但免費方案每次只有 2 秒 CPU、最長 150 秒，不足以處理三年價格與 AGGU 的 25 MB 基金檔案。）

| Data 資料 | Free source 免費來源 | Used by 使用者 |
| --- | --- | --- |
| Taiwan prices, financials, filings 台股價格、財報、重大訊息 | TWSE OpenAPI, FinMind, MOPS 公開資訊觀測站. Daily closes: FinMind, dividend-adjusted by the nightly job from its ex-dividend results; TWSE OpenAPI as backup 每日收盤價以 FinMind 為主（由每夜排程依除權息結果還原），證交所 OpenAPI 備援 | F12, N1, N3, F18 |
| US filings 美股財報與 8-K | SEC EDGAR | F12, N3 |
| US stock, ETF and index prices 美股、ETF 與指數價格 | FinMind US prices as primary (daily, with adjusted close); Alpha Vantage free key as backup (25 requests/day; fills missing days only). LSE-listed AGGU: iShares daily NAV, with Alpha Vantage AGGU.LON weekly as backup (step 4) 主要用 FinMind（每日、含還原收盤價），Alpha Vantage 備援；倫敦掛牌的 AGGU 用 iShares 每日淨值，Alpha Vantage 週線備援（第 4 步） | All |
| TWD/USD 台幣匯率 | Bank of Taiwan daily rates through FinMind, the middle of spot buy and sell; FRED (weekly) as backup 臺灣銀行每日牌告（經 FinMind，取即期買賣中間值），FRED 週資料備援 | F18, N2, N5 |
| US rates 美國利率 | FRED | F11 |
| Taiwan 10-year yield 台灣 10 年期公債殖利率 | Central Bank of the ROC 中央銀行 | F11 |
| US CAPE 週期調整本益比 | Robert Shiller's online data | F3 |
| Factor returns 因子報酬 | Kenneth French Data Library | N1 |
| Equity risk premium 股票風險溢酬 | Damodaran Online | F11 |
| Governance and penalties 公司治理與裁罰 | TWSE 公司治理評鑑, EPA ECHO, 環境部 | N3 |
| ETF holdings ETF 成分股 | Issuer CSV downloads 發行商公開檔案 | F14 |
| Gold price in TWD 台幣金價 | International gold price in USD per ounce (FinMind) × the Bank of Taiwan USD rate, as the bank's own gold page blocks scripts; the value entered by hand as fallback (step 4) 國際金價（FinMind，每盎司美元）× 臺灣銀行美元匯率（臺銀黃金牌價網頁會擋程式）；手動估值備援（第 4 步） | N5, N4, N6 |

Free tiers checked October 2026: Alpha Vantage allows 25 requests a day, Financial Modeling Prep 250 a day, FinMind 600 an hour with a token, and Supabase Free pauses a project after about 7 days of low activity. A once-a-night batch for about 20 tickers fits inside all of them. GitHub Actions is free for public repositories, but it turns a schedule off after 60 days without repository activity. 2026 年 10 月確認：Alpha Vantage 每日 25 次、Financial Modeling Prep 每日 250 次、FinMind 有金鑰時每小時 600 次；Supabase 免費專案約 7 天低活動即暫停。約 20 檔標的的每夜批次都在額度內。GitHub Actions 對公開 repo 免費，但 repo 連續 60 天沒有活動時會暫停排程。

## 7. Data Model 資料結構

Nineteen Postgres tables cover holdings, market data, rules and model outputs; all money is stored in trade currency with the FX rate of the day. 共 19 張 Postgres 資料表，涵蓋持股、市場資料、規則與模型產出；所有金額以交易幣別儲存，並記錄當日匯率。

| Table 資料表 | Key fields 主要欄位 | Used by 使用者 |
| --- | --- | --- |
| asset\_classes 資產類別 | id, name\_en, name\_zh, target\_weight, benchmark\_ticker, is\_satellite | F6, F8, N2 |
| securities 證券 | ticker, market (US/TW/UK), product\_type, listing\_country, sleeve, currency, domicile, asset\_class\_id | All |
| transactions 交易 | date, ticker, side, qty, price, fee, tax, fx\_rate, source (manual/CSV), pool (regular/windfall) | F18, N2 |
| cash\_flows 現金流 | date, amount\_twd, type (contribution/windfall/dividend), pool (regular/windfall) | F2, F18 |
| prices 價格 | ticker, date, close, adj\_close | All |
| fx\_rates 匯率 | date, pair, rate | F18, N2 |
| nav\_snapshots 淨值快照 | date, total\_twd, weights\_by\_class, var\_95\_1w | F1, F8, F18 |
| rules 規則 | id, desc\_en, desc\_zh, condition, threshold, action, cooldown\_days, enabled | Rules engine |
| rule\_changes 規則變更 | rule\_id, date, old\_value, new\_value | Rules engine |
| proposals 提案 | id, rule\_id, created\_at, status, orders, dismiss\_reason | Rules engine |
| windfall\_tranches 分批計畫 | plan\_id, due\_date, amount\_twd, status (scheduled/accelerated/done) | F3 |
| valuations 估值 | ticker, date, model, iv\_bear, iv\_base, iv\_bull, inputs | F12 |
| beta\_results Beta 結果 | ticker, benchmark, model (1F/5F), freq, window, beta, alpha, factor\_loadings, r2, std\_err, run\_date | N1, F11 |
| red\_flags 紅旗 | ticker, date, indicator, value, level, coverage\_pct | N3 |
| attribution 歸因 | period, level, segment, allocation, selection, interaction, fx | N2 |
| config 設定 | tax thresholds, push schedule, quiet hours, satellite cap, single-stock cap, CMA per asset class | F15, Section 4–5 |
| watchlist 觀察清單 | ticker, added\_on, buy\_threshold, trim\_threshold, active | F12, N3 |
| windfall\_plan 大額資金計畫 | total\_twd, received\_on, cape\_percentile, tranche\_count, tiers\_fired, current\_drawdown\_peak | F3 |
| manual\_assets 非上市資產 | name, asset\_class\_id, unit (grams/TWD), quantity, valuation\_method, last\_value\_twd | N5, N4, N6 |

A 20th table, push\_subscriptions (endpoint, keys, device name), is added in Phase 1 with the Web Push setup. 第 20 張資料表 push\_subscriptions（端點、金鑰、裝置名稱）會在第一階段建置 Web Push 時一併加入。

Two bookkeeping tables join them in Phase 1: audit\_log (table, row, old and new values, who and when) for N5's edit history (step 2), and job\_runs (job, start, finish, status, per-feed detail) for the nightly job's outcomes and the data-failure alert (step 4). 第一階段另有兩張紀錄用資料表：audit\_log（資料表、資料列、修改前後內容、修改者與時間），供 N5 的修改紀錄使用（第 2 步）；job\_runs（工作、開始與結束時間、狀態、各資料來源明細），記錄每夜排程結果並供資料異常警示使用（第 4 步）。

## 8. Roadmap 開發路線圖

Phase 1 comes first because every alert, proposal and weekly summary depends on the nightly data job and working push. 第一階段優先，因為所有警報、提案與週報都依賴每夜資料排程與可用的推播。

&#91;embedded content: Roadmap · 3 phases, 2 gates\]

Each gate must pass before the next phase starts; Phase 2 and 3 durations are set once Phase 1's actual pace is known. 每個關卡通過後才進入下一階段；第二、三階段的時程，待第一階段實際進度確定後再訂。

## 9. Risks, Limitations & Open Questions 風險、限制與待決問題

The largest design risk is windfall acceleration, which may commit most of the cash before a drawdown bottoms. 最大的設計風險是大額資金加速投入：可能在跌勢見底前就投入大部分資金。

| Risk 風險 | Why it matters 影響 | Mitigation 對策 |
| --- | --- | --- |
| Acceleration risk 加速投入風險 | Markets can keep falling after a tier fires, leaving little cash for the bottom 觸發後市場可能續跌，谷底時剩餘資金不多 | Tiers spaced 10 points apart; F3 backtest compares acceleration with a fixed pace 級距間隔 10 個百分點；F3 回測比較加速與固定節奏 |
| Free data breaks 免費資料中斷 | Rate limits and unofficial endpoints can change without notice 流量限制與非官方介面可能隨時變動 | Nightly batch with cache; failure push after two misses; one fallback source per data type 夜間批次加快取、連續失敗兩次即推播、每類資料備援一個來源 |
| Partial ESG coverage ESG 覆蓋不完整 | No free full ESG scores 沒有免費的完整 ESG 評分 | Show coverage % beside each light 燈號旁顯示覆蓋率 |
| Model risk 模型風險 | CAPM, DCF and mean–variance outputs are only as good as their inputs CAPM、DCF、均值–變異數的結果取決於輸入品質 | Show inputs beside every output; weight bounds in F7; scenario ranges in F12 每個輸出旁顯示輸入、F7 設權重上下限、F12 用情境區間 |
| Tax rules change 稅法變動 | Thresholds in F15 may go stale F15 的門檻可能過時 | Stored as config with a "last verified" date 存為設定並標示最後確認日期 |
| iPhone push 手機推播 | Web Push on iOS works only after Add to Home Screen iOS 需先加入主畫面才能收推播 | Install step in the setup checklist 列入安裝檢查清單 |
| Data privacy 資料隱私 | Holdings and windfall data are sensitive 持股與大額資金資料屬敏感資訊 | Single-user login, row-level security, no broker credentials stored 單人登入、資料列層級權限、不儲存券商帳密 |
| Supabase auto-pause 免費專案暫停 | A Free project with little activity for 7 days is paused 免費專案 7 天低活動會被暫停 | The nightly GitHub Actions job reads and writes the database every night; data-failure alert if it stops 每夜由 GitHub Actions 排程讀寫資料庫；中斷即警示 |
| Schedule switched off 排程被暫停 | GitHub turns off the schedule of a public repo after 60 days without activity GitHub 會暫停 60 天無活動的公開 repo 排程 | Missed nights count toward the data-failure alert; re-enable in the Actions tab 未執行的夜晚計入資料異常警示；於 Actions 分頁重新啟用 |
| Minimum fees 最低手續費 | NT$10,000 split across 8 sleeves means very small 複委託 orders 每月 1 萬分到 8 個部位，單筆複委託金額過小 | F8 sends each month's cash to at most 2 classes; F15 compares minimum fees 每月最多投入 2 個類別；F15 比較低消 |
| Phase 1 scope 第一階段範圍 | 11 items is heavy for 2–4 weeks 2–4 週內完成 11 項偏重 | Strict build order in Section 11; the gate decides, not the calendar 依第 11 節順序建置，以關卡而非日期為準 |

This app supports Hugo's own decisions; it is not financial advice. 本 App 用於輔助 Hugo 自己的決策，不構成投資建議。

**Open questions 待決問題**

- [x] Satellite cap: 20% target, trim above 25%, regular-contribution pool, windfall excluded (decided) 衛星部位上限：一般投入資金池的 20%，超過 25% 減碼，大額資金不計入（已決定）
- [ ] SAA target weights decided (Investment Principles); CMA per asset class still open, to be entered on the Allocation page (step 6) 目標權重已定（見投資原則），各類別資本市場假設待定，可在「資產配置」頁輸入（第 6 步）
- [ ] Confirm F3 acceleration tiers: 15% / 25% / 35% 確認 F3 加速級距
- [ ] Confirm valuation trim threshold: 1.25 × intrinsic value (single-stock cap now 5%, Investment Principles) 確認估值減碼門檻：內在價值 125%（單一個股上限已定為 5%）
- [ ] Weekly review day and time 每週檢視的星期與時間
- [x] 複委託 only, in principle (decided); pick the broker after F15 comparison 原則上僅使用複委託，依 F15 比較結果選定券商
- [ ] N3 exclusion list (industries to avoid) N3 排除產業清單
- [x] Free price source for LSE-listed AGGU (Phase 1, step 1): Alpha Vantage AGGU.LON, weekly adjusted prices in USD on the free key; iShares daily NAV as fallback (confirmed by the source check, 2026-10-21). Swapped in step 4: the iShares daily NAV is now primary, as Alpha Vantage gives weekly prices only and refused requests from a cloud server in testing; Alpha Vantage weekly is the fallback 確認倫敦掛牌 AGGU 的免費價格來源：Alpha Vantage 免費金鑰可取得 AGGU.LON 美元週線，iShares 每日淨值為備援（2026-10-21 資料來源檢查已確認）。第 4 步起對調：改以 iShares 每日淨值為主，因為 Alpha Vantage 只有週線，且測試時拒絕來自雲端主機的請求；Alpha Vantage 週線改為備援
- [x] Public GitHub repo for the portfolio, with personal data excluded (decided): bilingual README; holdings, API keys and windfall figures stay out of the repo, demo data only 公開 GitHub 作為作品集（已決定）：中英雙語 README；持股、API 金鑰與大額資金數字不進 repo，只放示範資料

Raised by the spec review after Phase 1, step 3 (2026-10-21) 第一階段第 3 步後檢視規格時提出:

- [x] Cash flows (monthly contributions, dividends, the windfall's arrival, withdrawals) have no entry page, and the CSV import skips dividend rows; F18 (step 5) and F2's actual-vs-projected path (step 8) need them. Done before step 5: a cash-flow form on N5 (add, edit, delete, with history; the trade date's FX rate as default), and the CSV import saves cash dividends as cash flows, from a mapped amount column 現金流（每月投入、股利、大額資金入帳、提領）尚無登錄頁面，CSV 匯入也會略過股利列；F18（第 5 步）與 F2 的實際與預測對照（第 8 步）都需要。第 5 步前完成：N5 加入現金流表單（新增、修改、刪除並保留紀錄，預設帶入當日匯率），CSV 匯入依對應的金額欄位把現金股利存為現金流
- [x] Gold price in TWD: the Bank of Taiwan page blocks scripts (source check, 2026-10-21), so physical gold was valued by hand. Done in step 4: the international USD gold price (FinMind GoldPrice, each day's last price) × that day's Bank of Taiwan USD rate, ÷ 31.1035 grams per ounce; the hand-entered value stays as fallback 台幣金價：臺灣銀行頁面會擋程式（2026-10-21 資料來源檢查），原本以手動估值。第 4 步完成：國際美元金價（FinMind GoldPrice，每日最後一筆）× 當日臺銀美元匯率 ÷ 每盎司 31.1035 克，手動估值作為備援
- [x] Daily FX source: FRED's TWD/USD (DEXTAUS) is published weekly, days late. Done in step 4: Bank of Taiwan daily rates through FinMind (TaiwanExchangeRate), FRED as fallback. Trade entry and the CSV import now default to the trade date's rate, or the newest one at most `fx_rate_check.max_age_days` (10) before it, and check typed rates against it 每日匯率來源：FRED 的台幣匯率（DEXTAUS）每週公布、延遲數天。第 4 步完成：改用經 FinMind 取得的臺灣銀行每日牌告，FRED 為備援；交易登錄與 CSV 匯入預設帶入交易日的匯率（當天沒有則取前 `fx_rate_check.max_age_days`（10）天內最近一筆），並以此檢查輸入的匯率
- [ ] Foreign-currency cash left in the 複委託 account after a USD-settled sale has no place in the data model (manual_assets holds grams or TWD only): settle in TWD, or add foreign-currency balances 複委託以外幣交割時，賣出後留在帳戶的外幣現金在資料結構中沒有位置（manual_assets 只有克與台幣）：改以台幣交割，或新增外幣餘額
- [x] Deploying to Vercel and installing the PWA are not a build step, yet Web Push (step 10) needs both. Done after step 4: the app has a web app manifest and home-screen icons, asks search engines not to index it, and Claude's working branches (`claude/**`) do not deploy; the setup is in docs/deploy-vercel.md 部署到 Vercel 與安裝 PWA 不在建置順序中，但第 10 步的推播兩者都需要。第 4 步後完成：App 加入 web app manifest 與主畫面圖示、要求搜尋引擎不收錄，Claude 工作中的分支（`claude/**`）不會部署；設定步驟見 docs/deploy-vercel.md
- [ ] DCA debit day (config `dca.day_of_month`), needed by the monthly-contribution rule (step 9) and the weekly view (step 10) 定期定額扣款日（config 的 `dca.day_of_month`），每月投入規則（第 9 步）與週檢視（第 10 步）需要
- [ ] (Raised in step 7) A split multiplies the units held, and N5 has no entry for it: returns stay right, as they come from adjusted closes, but a held security's quantity, and so its value and R1 / R2, are wrong until a trade is edited or a split entry type is added （第 7 步提出）股票分割會使持有單位數倍增，但 N5 沒有對應的登錄方式：報酬以還原收盤價計算仍正確，但持股數量（及市值與 R1／R2）在修改交易或新增「分割」登錄類型之前會不正確

Decided in Phase 1, step 4 (2026-10-21) 第一階段第 4 步決定:

- [x] The nightly job runs in GitHub Actions itself, writing with the Supabase secret key kept in GitHub's encrypted secrets, instead of calling an Edge Function (Section 6): the free plan's 2-second CPU limit is too small, and Actions keeps a log of every run. Its public log shows counts only; which tickers were loaded is kept in the `job_runs` table and shown in the app 每夜排程直接在 GitHub Actions 執行，以存放在 GitHub 加密 secrets 的 Supabase secret key 寫入，不再呼叫 Edge Function（第 6 節）：免費方案 2 秒 CPU 上限不夠，且 Actions 會留下每次執行紀錄。公開的執行紀錄只寫數量；載入了哪些代號存在 `job_runs` 表，在 App 內顯示
- [x] The data-failure alert (rule `DATA_FAILURE`, two misses in a row) counts failed runs and nights with no run at all; it shows on the holdings page now and becomes a push in step 10 資料異常警示（`DATA_FAILURE` 規則，連續兩次）同時計入失敗的執行與完全沒有執行的夜晚；目前顯示在持倉頁，第 10 步改為推播

Decided in Phase 1, step 5 (2026-10-21) 第一階段第 5 步決定:

- [x] TWR is computed daily per holding: each holding's TWD return from its adjusted close (dividends reinvested), weighted by its value at the previous close, chained over the days; a trade counts at its day's close. It is not derived from NAV and contributions, because a contribution waits in the bank before it buys anything 時間加權報酬逐日依持股計算：各持股以還原收盤價（股利再投入）計算台幣報酬，以前一日收盤市值加權後連乘；交易以當日收盤價計入。不以淨值與投入資金推算，因為投入的資金在買進前會先停在銀行
- [x] XIRR uses the trades themselves: buys (with fee and tax) as money in, sales and recorded dividends as money out, each change to a non-listed asset as money in or out, and the value at the end. Contribution and withdrawal cash flows are left out; money counts from the day it is invested 資金加權報酬直接採用交易：買進（含手續費與稅）為投入，賣出與已記錄的股利為取回，非上市資產的每次變動視為投入或取回，期末市值為最後一筆。投入資金與提領的現金流不計入，資金自投入市場當天起才計算
- [x] The SAA benchmark is the target weights rebalanced daily, each class at its `benchmark_ticker` proxy (the N4 proxy table) in TWD with dividends; classes that share a proxy are merged SAA 基準為目標權重每日再平衡，各類別以 `benchmark_ticker` 代表 ETF（N4 代理表）含息的台幣報酬計算；共用同一檔 ETF 的類別合併計算
- [x] Non-listed assets have no quantity history table: their past is replayed from the audit log (N5). A savings balance returns 0%, as its interest arrives as an edit to the balance (money in). Physical gold is priced in USD for the FX split, and before the nightly job's first saved gold price its value is moved back by GLDM's TWD return 非上市資產沒有數量歷史表，過去的數量由修改紀錄（N5）重建。存款報酬為 0%，因為利息以修改餘額記入（視為投入）。匯率拆解時實體黃金以美元計價；每夜排程存下第一筆金價之前，以 GLDM 的台幣報酬回推
- [x] NAV snapshots: `total_twd` is both pools; `weights_by_class` is each class's share of the regular pool, the base the targets are measured on. The nightly job recomputes every day since the first trade, so an edited trade or a late close corrects the past; the performance page computes from the trades on request, so it never waits for the job 淨值快照：`total_twd` 為兩個資金池合計；`weights_by_class` 為各類別占一般投入資金池的比例，與目標權重的計算基礎相同。每夜排程重算自第一筆交易起的每一天，修改交易或晚到的收盤價都會更正過去；績效頁則在開啟時直接由交易計算，不必等排程
- [x] Periods of a year or more are reported per year, shorter ones as they were (XIRR included), since a yearly rate over a few weeks exaggerates 一年以上的期間以年化報酬表示，未滿一年以期間報酬表示（XIRR 亦同），因為把幾週的報酬年化會誇大結果

Decided in Phase 1, step 6 (2026-10-22) 第一階段第 6 步決定:

- [x] The capital market assumptions are one config row, `cma` (Section 7: "CMA per asset class" in config): an expected yearly return, a volatility and a source note per asset class, with `last_verified` as the date they were last reviewed. They are edited on the Allocation page and logged like every setting; the values themselves remain the open question above 資本市場假設存為 config 表的一列 `cma`（第 7 節：CMA 放在 config）：各資產類別的預期年報酬、波動度與來源說明，`last_verified` 為最後檢視日期。在「資產配置」頁修改，並與其他設定一樣留下紀錄；數值本身仍是上方的待決問題
- [x] F6's drift colours follow F8's 5/25 rule (rule `F8_DRIFT`): red past the band, 5 percentage points or a quarter of the target, whichever is smaller; amber past half of it (config `drift_display.warn_share`, 0.5). Satellite classes are left to R2, shown as the sleeve's own row: amber between 20% and 25%, red above 25%. "Daily drift check": drift is worked out live on every view, and the nightly NAV snapshots keep each day's class weights; drift proposals and pushes come with steps 9 and 10 F6 的偏離顏色依 F8 的 5/25 規則（`F8_DRIFT`）：超過門檻（5 個百分點或目標的四分之一，取較小者）為紅色，超過一半為黃色（config `drift_display.warn_share`，0.5）。衛星類別交給 R2，以衛星部位整體一列顯示：20% 到 25% 為黃色，超過 25% 為紅色。「每日檢查偏離」：每次開啟頁面即時計算，每夜的淨值快照也保存每天的類別權重；偏離的提案與推播在第 9、10 步完成
- [x] Targets are edited together and must add up to 100%; they are saved in one statement, and each class that changed is logged. Adding or removing an asset class is done in Supabase's Table Editor for now, as securities refer to their class 目標權重一起修改、合計必須是 100%，以單一指令儲存，每個有變動的類別都會留下紀錄。新增或刪除資產類別目前在 Supabase 的 Table Editor 操作，因為證券會參照所屬類別
- [x] The N6 donuts show the regular pool by default, the one the SAA is set on, with the 80/20 core/satellite target as an inner ring; both pools or the windfall pool alone show no target ring. A slice keeps its colour whatever else is held, and as six product types are more than colour alone keeps apart, every slice is also named in the chart and listed in the table N6 圓餅圖預設顯示一般資金池（SAA 的基礎），內圈為核心／衛星 80／20 目標；選兩個資金池或大額資金池時不顯示目標圈。每個區塊的顏色固定不變；產品類別有六種，超過只靠顏色能分辨的數量，所以每個區塊在圖上與表格中都標示名稱

Decided in Phase 1, step 7 (2026-10-22) 第一階段第 7 步決定:

- [x] The VaR covers the whole portfolio, both pools, like `nav_snapshots.total_twd`: it is how much Hugo could lose, so the windfall counts too, and its cash lowers the share until it is deployed. Each holding is measured by its class's proxy, the class's `benchmark_ticker` (the N4 table); a theme ETF by its own prices once it has the whole window of them, the class benchmark (VT) until then N4 風險值涵蓋整個投資組合（兩個資金池），與 `nav_snapshots.total_twd` 相同：衡量的是 Hugo 可能損失多少，因此大額資金也計入，尚未投入的現金會降低比例。每檔持股以所屬類別的代理 ETF（類別的 `benchmark_ticker`，即 N4 代理表）衡量；主題 ETF 有完整期間的自身價格後用自身價格，之前用類別基準（VT）
- [x] A TWD balance (savings, or a money-market fund entered as a balance) adds value but no risk, instead of being measured by BIL: BIL in TWD moves with the dollar, a risk money that stays in TWD does not carry (as in step 5, where a savings balance returns 0%). Strategic cash held as a listed ETF such as BIL is still measured by its prices 台幣餘額（活存，或以餘額登錄的貨幣基金）計入市值但不增加風險，不以 BIL 衡量：以台幣計的 BIL 會隨美元波動，而留在台幣的資金沒有這個風險（與第 5 步存款報酬為 0% 一致）。以上市 ETF（例如 BIL）持有的戰略現金仍以其價格衡量
- [x] Σ is the sample covariance of the last 52 × `var.lookback_years` (156) weekly returns, Friday close to Friday close (a holiday Friday takes the close before it), dividends reinvested, in TWD at each Friday's rate; a new view, `weekly_prices`, gives each week's last close. A proxy whose closes do not reach back the whole window gives no VaR, and the card names it, rather than a VaR from a shorter window. z comes from `var.confidence` by the normal quantile, rounded to three decimals as a z-table quotes it (1.645 at 95%), so the Section 11 value (NT$32,900) comes out exactly and the formula shown with today's numbers multiplies out; the mean is left out, as in the formula Σ 為最近 52 × `var.lookback_years`（156）週週報酬的樣本共變異數，以週五收盤計（週五休市取前一個收盤價），股利再投入，以每個週五的匯率換算台幣；新增檢視表 `weekly_prices` 提供每週最後一筆收盤價。代理 ETF 的收盤價不足整個期間時不顯示風險值，並在卡片上指出是哪一檔，而不以較短期間計算。z 由 `var.confidence` 經常態分位數取得，依 z 表取到小數第三位（95% 為 1.645），因此第 11 節的驗收值（NT$32,900）完全相符，畫面上代入今天數值的公式也能直接相乘驗算；與公式相同，不計平均報酬
- [x] Today's figure is worked out when a page opens, from the holdings as the holdings page values them, so a new trade shows at once (as the performance page does). The nightly job stores each snapshot day's 1-week VaR at `var.confidence` in `var_95_1w`, recomputed every night like the NAV, and the 52-week sparkline draws one point a week from them, ending with today's figure. To give every day its own three years, the job loads the proxies' closes 156 weeks before the first trade, or before a year ago if that is earlier 今天的數值在開啟頁面時依持倉頁的估值直接計算，新增交易後立即反映（與績效頁相同）。每夜排程把每個快照日以 `var.confidence` 計算的一週風險值存入 `var_95_1w`，與淨值一樣每晚重算；近 52 週走勢線取自這些紀錄，每週一點，最後一點為今天的數值。為了讓每一天都有自己的三年資料，排程會載入代理 ETF 自第一筆交易（或一年前，取較早者）往前 156 週起的收盤價
- [x] The N4 histogram shows today's mix's weekly returns over the window, today's holdings as if held through each week, with one bin edge on the cutoff so the bars left of the line are exactly the weeks beyond the VaR, counted against the 1 in 20 expected. The card sits on the holdings page, the home page until step 10, after the target weights (the order of the Section 5 dashboard), and on its own page with the histogram, the inputs and the formula N4 分布圖顯示今天的持股組合在整個期間的週報酬（假設每週都持有今天的持股），並讓一個區間邊界落在門檻上，門檻左側的長條即為損失超過風險值的週數，並與每 20 週約 1 週的預期比較。卡片放在持倉頁（第 10 步前的首頁）目標權重之後（第 5 節儀表板的順序），另有獨立頁面呈現分布圖、輸入值與公式
- [x] Splits are now folded into Taiwan adjusted closes. FinMind's ex-dividend results leave them out and its split-adjusted prices need a paid level, so 0050's 1-into-4 split of June 2025 showed as a 75% weekly fall inside every VaR window until 2028 (found by the step 7 end-to-end check on live data). A Taiwan close moves at most 10% a day, so a day whose close is within 10% of ½, ⅓, ¼, ⅕, ⅛ or ⅒ of the one before (or 2 to 10 times it), once any ex-dividend that day is taken out, is a split; the closes before it are scaled by that ratio. Quoted closes stay as traded 台股還原收盤價現在也納入股票分割。FinMind 的除權息結果不含分割，其還原股價需付費等級，因此 0050 在 2025 年 6 月的 1 拆 4 在 2028 年前的每個風險值期間都會顯示為單週下跌 75%（第 7 步端對端檢查以真實資料發現）。台股單日漲跌最多 10%，所以收盤價（扣除當天除息後）落在前一日的 ½、⅓、¼、⅕、⅛、⅒（或 2 至 10 倍）上下 10% 以內時，即判定為分割，之前的收盤價依該比例調整；原始收盤價維持成交價

## 10. Glossary 雙語術語表

- **SAA (Strategic Asset Allocation)** – long-term target weights across asset classes, held through market cycles; Chinese translation: 策略性資產配置：長期維持的各資產類別目標權重，不隨市場短期波動而改變。
- **Rebalancing** – trading back to target weights after drift; Chinese translation: 再平衡：權重偏離後，透過買賣回到目標權重。
- **Drawdown** – fall from a previous peak, in %; Chinese translation: 回撤：從前一個高點下跌的幅度。
- **CAPE** – price divided by 10-year average inflation-adjusted earnings; Chinese translation: 週期調整本益比：股價除以過去 10 年經通膨調整的平均盈餘，用於衡量市場估值高低。
- **CAPM** – model linking an asset's expected return to its market risk; Chinese translation: 資本資產定價模型：以市場風險（β）解釋資產的預期報酬。
- **Beta (β)** – sensitivity of an asset's return to the market's return; Chinese translation: 貝他係數：資產報酬對市場報酬變動的敏感度。
- **Alpha (α)** – return not explained by market exposure; Chinese translation: 阿爾法：無法由市場曝險解釋的超額報酬。
- **R²** – share of return variation explained by the regression; Chinese translation: 判定係數：回歸模型能解釋的報酬變異比例。
- **Dimson beta** – beta summed over current and lagged market returns to fix non-synchronous trading; Chinese translation: Dimson 貝他：加總當期與落後期的係數，修正交易時間不同步的問題。
- **Blume adjusted beta** – raw beta pulled toward 1 (0.67 × β + 0.33); Chinese translation: Blume 調整貝他：將原始 β 向 1 收斂，反映 β 長期趨向平均的特性。
- **Efficient frontier** – portfolios with the highest expected return for each risk level; Chinese translation: 效率前緣：在每個風險水準下預期報酬最高的投資組合集合。
- **Sharpe ratio** – excess return per unit of volatility; Chinese translation: 夏普比率：每承擔一單位波動所獲得的超額報酬。
- **Monte Carlo simulation** – many random return paths used to estimate a range of outcomes; Chinese translation: 蒙地卡羅模擬：以大量隨機報酬路徑估計結果的可能範圍。
- **DCF / FCFF** – value as discounted free cash flow to the whole firm; Chinese translation: 現金流折現／公司自由現金流：將公司未來可分配給所有資金提供者的現金流折現成現值。
- **WACC** – blended cost of equity and after-tax debt; Chinese translation: 加權平均資金成本：股東權益成本與稅後負債成本的加權平均。
- **Terminal value** – value of all cash flows beyond the forecast period; Chinese translation: 終值：預測期之後所有現金流的價值。
- **Margin of safety** – gap between intrinsic value and price, as % of value; Chinese translation: 安全邊際：內在價值與股價的差距占內在價值的比例。
- **Fama–French factors** – size, value, profitability and investment return drivers; Chinese translation: Fama–French 因子：規模、價值、獲利能力、投資等解釋報酬的因子。
- **TER** – annual fund operating cost as % of assets; Chinese translation: 總費用率：基金每年營運成本占資產的比例。
- **Tracking difference** – fund return minus index return over a period; Chinese translation: 追蹤差異：基金報酬與指數報酬的差距。
- **Domicile** – country where a fund is legally registered; Chinese translation: 註冊地：基金依法登記的國家，影響預扣稅與遺產稅。
- **XIRR** – money-weighted return accounting for timing of each cash flow; Chinese translation: 資金加權報酬率：考慮每筆現金流時點的報酬率。
- **TWR** – time-weighted return that removes the effect of cash flows; Chinese translation: 時間加權報酬率：排除資金進出影響的報酬率。
- **Brinson attribution** – splits excess return into allocation, selection and interaction effects; Chinese translation: Brinson 績效歸因：將超額報酬拆解為配置效果、選擇效果與交互效果。
- **Beneish M-Score** – model estimating the likelihood of earnings manipulation; Chinese translation: Beneish M 分數：評估財報被操縱可能性的模型。
- **Altman Z-Score** – model estimating bankruptcy risk from financial ratios; Chinese translation: Altman Z 分數：以財務比率評估破產風險的模型。
- **PWA (Progressive Web App)** – a website installable like an app, with offline use and push; Chinese translation: 漸進式網頁應用程式：可像 App 一樣安裝、支援離線與推播的網站。
- Capital market assumptions (CMA) – long-run expected return and volatility set for each asset class; Chinese translation: 資本市場假設：為各資產類別設定的長期預期報酬與波動度，作為預測與最適化的輸入。
- Core–satellite – a portfolio built from a passive core plus a smaller, actively chosen satellite; Chinese translation: 核心–衛星策略：以被動式核心資產為主，搭配較小比例的主動選股部位。
- Tranche – one installment of a sum invested in stages; Chinese translation: 分批：將一筆資金分次投入時的其中一批。

## 11. Claude Code Handoff 交付 Claude Code

Export this doc as Markdown into a new repo as docs/PRD.md; from then on the repo copy is the source of truth, and Claude Code builds Phase 1 in the order below. 將本文件匯出為 Markdown，存入新 repo 的 docs/PRD.md；此後以 repo 中的版本為準，由 Claude Code 依下列順序建置第一階段。

**Starter CLAUDE.md**

```markdown
# Long-View Investment App
Read docs/PRD.md before any task. Build phase by phase; never start a phase before its gate passes.

Stack: Next.js (App Router) PWA on Vercel; Supabase (Postgres, Auth, Edge Functions);
GitHub Actions cron for nightly jobs; Web Push (VAPID); Apache ECharts.

Rules:
- Single user. Row-level security on every table.
- L2 only: never place trades, never store broker credentials.
- Public repo: no secrets, holdings or windfall figures in git; demo seed data only.
- Store money in trade currency plus the day's FX rate; report in TWD.
- Thresholds live in the rules / config tables, never hard-coded.
- All UI text bilingual: English + 繁體中文.
- Every model function ships with unit tests using the acceptance values in PRD Section 11.
```

**Phase 1 build order 第一階段建置順序**

1. Source check: a script calls each Section 6 source once, records limits and sample payloads, and reports ticker coverage (including AGGU). 資料來源檢查。
2. Supabase schema, row-level security and demo seed data. 資料庫結構、權限與示範資料。
3. N5 holdings entry page and CSV import. 持倉登錄頁與 CSV 匯入。
4. Nightly price and FX job via GitHub Actions. 每夜價格與匯率排程。
5. NAV snapshots and F18 performance. 淨值快照與真實績效。
6. F6 targets and N6 allocation donuts. 目標權重與配置圓餅圖。
7. N4 VaR card. 風險值卡片。
8. F2 calculator on the shared projection engine. 複利計算機。
9. Rules engine: R1, R2, F8 drift, proposals. 規則引擎與提案。
10. Web Push and the weekly dashboard as home. 推播與每週儀表板首頁。
11. F15 fee and tax drag. 費用與稅務拖累。

**Acceptance tests 驗收測試** (computed for this check; each becomes a unit test 每項皆轉為單元測試)

| Test 測試 | Input 輸入 | Expected 預期結果 |
| --- | --- | --- |
| F2 future value | PV 0, PMT NT$10,000, 6%/yr compounded monthly, 30 years, no step-up | ≈ NT$10,045,000 (annuity factor ≈ 1,004.5) |
| F2 growing contributions | Any r ≠ g | Closed-form result equals a month-by-month loop within NT$1 |
| N2 Brinson | Benchmark 60 / 40 earning 10% / 2%; portfolio 70 / 30 earning 12% / 1% | Allocation 0.80%, selection 0.80%, interaction 0.30%; sum 1.90% = R\_p − R\_b |
| N4 VaR | NT$1,000,000, weekly σ 2% | NT$32,900 for 1 week; ≈ NT$68,500 for 1 month (× √4.33) |
| R1 single stock | Pool NT$200,000; one stock NT$11,000 (5.5%) | Warning on save and a trim proposal |
| R2 satellite | Satellite NT$51,000 of NT$200,000 (25.5%) | Trim proposal back to 20%, selling ≈ NT$11,000 |
| F3 pace | NT$5.5M, CAPE percentile 75 | 24 tranches of ≈ NT$229,000 |
| F3 acceleration | ACWI −16%, then −26% | Next tranche merged; then 50% of remaining deployed; each tier fires once |
| Pool tagging | A windfall buy of a satellite-sleeve ticker | Excluded from R1 / R2 maths |

**First prompt for Claude Code 第一個指令**

```text
Read CLAUDE.md and docs/PRD.md. Start Phase 1, step 1: write scripts/check_sources.ts
that calls each data source in PRD Section 6 once, records rate-limit details and a
sample payload, and reports which tickers in the Investment Principles table each
source covers. Show me the report before writing any app code.
```
