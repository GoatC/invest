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
4. **Explain every number 每個數字都可解釋** — Each model shows its formula, inputs and assumptions, in English and Chinese, one tap away: the explanation sits folded behind ⓘ. 每個模型都以中英雙語顯示公式、輸入值與假設，點一下 ⓘ 即可展開。
5. **Free data only 只用免費資料** — All phases run on free data sources; paid upgrades stay an open question. 所有階段都只使用免費資料；是否升級付費資料列為待決問題。
6. **Figures, not paragraphs 數字優先，少用段落** — A page shows labelled figures as tiles with a status icon (✓ on track, ! watch, ✕ act, … waiting) and short lines; sentences that explain go behind ⓘ, edit histories fold under their heading. 頁面以「標籤＋數字＋狀態圖示」的小卡呈現（✓ 正常、! 注意、✕ 需處理、… 等待中），只留短句；說明文字收進 ⓘ，修改紀錄收合在標題下。

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

Twenty features ship across three phases; IDs keep the numbering from the original 20-feature list, and N1–N7 are new (N7 added during Phase 2). 共 20 個功能，分三個階段上線；編號沿用原本 20 項清單，N1–N7 為新增功能（N7 於第二階段加入）。

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
| N7 | Sector heatmap tab: heatmap, treemap, bubble chart 產業熱圖分頁：熱力圖、板塊圖、泡泡圖 | C Analysis | 2 | Nightly sector closes 每夜更新類股價格 |
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

**N7 Sector heatmap 產業熱圖** (added in Phase 2 第二階段加入)

A tab of its own (the menu's "Sectors 產業熱圖"), next to the Regression Lab, that shows at a glance which sectors are moving and how much of the portfolio sits in each, in three charts switched by tabs like N6's lenses. Display only: no rule, no push (design principle 2: decisions, not prices). 獨立分頁（選單「產業熱圖」），以三張可切換的圖表一眼看出哪些產業在動、投資組合在各產業放了多少；只做顯示，不設規則、不推播（設計原則 2：推播決策而非價格）。

- Sectors 產業: the 11 GICS sectors. US sectors are priced by the Select Sector SPDR ETFs (XLK, XLF, XLV, XLY, XLP, XLE, XLI, XLB, XLU, XLRE, XLC); Taiwan's by the TWSE industry indices (半導體業、電子零組件業、金融保險業 …), each mapped to a GICS sector in config `sectors` (editable), so the two markets share one list and can also be shown apart. 以 GICS 11 個產業為準：美國產業以 Select Sector SPDR ETF 計價；台灣以證交所類股指數計價，並在 config `sectors` 中對應到 GICS 產業（可修改），兩個市場共用一份清單，也可分開檢視。
- Heatmap 熱力圖: rows are sectors, columns are periods (1 week, 1 month, 3 months, year to date, 1 year); each cell's colour is the return on a diverging scale, with the % written in the cell. The colour convention is a setting: Taiwan's red-up, green-down by default (紅漲綠跌), or the US's green-up. 列為產業、欄為期間（1 週、1 月、3 月、今年以來、1 年），格子顏色為報酬（雙向色階），格內寫出百分比；配色為設定值，預設台灣慣例紅漲綠跌，可改為美國慣例綠漲。
- Treemap 板塊圖: one tile per sector, its area the portfolio's exposure in TWD through F14's look-through (the ETFs' holdings plus the stocks held directly, both pools or one), its colour the chosen period's return; tapping a tile opens the companies inside it. 每個產業一個方塊，面積為依 F14 穿透計算的台幣曝險（ETF 成分股加直接持股，可選資金池），顏色為所選期間的報酬；點選方塊展開其中的公司。
- Bubble chart 泡泡圖: one bubble per sector, x = its 1-year return, y = its annualised volatility (weekly returns, 1 year), size = the portfolio's exposure, colour = market (US / Taiwan); the portfolio's own exposure-weighted point is marked. 每個產業一顆泡泡：X 軸為 1 年報酬、Y 軸為年化波動度（1 年週報酬）、大小為投資組合曝險、顏色為市場（美國／台灣），並標出投資組合依曝險加權的位置。
- Each chart has its table underneath, and a sector lists the holdings behind it (directly and through each ETF), as N6's slices do. 每張圖下方都有表格；點選產業即列出背後的持股（直接持有與透過各 ETF），與 N6 相同。
- Data 資料: the sector proxies' daily closes, loaded by the nightly job into index\_prices (step 2's table) with one fallback each; exposure from F14. 類股代理的每日收盤價由每夜排程載入 index\_prices（第 2 步的資料表），各有一個備援；曝險取自 F14。

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
| N7 Sectors | Heatmap 熱力圖 | Period 期間 | Sector 產業 | Which sectors move, over which horizon 哪些產業在動、在哪個期間 |
| N7 Sectors | Treemap 板塊圖 | — | — | Portfolio exposure per sector, coloured by return 各產業曝險，依報酬上色 |
| N7 Sectors | Bubble 泡泡圖 | 1-year return 一年報酬 | Volatility 波動度 | Return against risk, sized by exposure 報酬對風險，大小為曝險 |

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

1. This week: the portfolio's value (both pools) and the three push lines, each with its status icon; when a proposal waits, a button jumps to the proposals at the foot 本週：投資組合總市值（兩個資金池）與三行摘要（各附狀態圖示）；有提案待處理時，按鈕直接跳到頁尾的提案
2. VaR card: 95% one-week Value at Risk in NT$ and % (N4), its distribution and make-up folded under it 風險值卡片：95% 一週風險值（台幣與百分比），分布圖與組成收合在下方
3. Watchlist: distance to buy and trim zones, and red-flag light per company 觀察清單：距離買入區與減碼區的幅度，以及紅旗燈號
4. Coming week: DCA date, tranche dates, earnings dates of holdings 下週事件：扣款日、分批日、持股財報日
5. Allocation donut with three lens tabs (N6) 資產配置圓餅圖，三種分法分頁
6. Windfall progress: deployed vs remaining, on schedule or accelerated 大額資金進度：已投入與剩餘、依排程或加速中
7. Actual vs projected path (F2) 實際與預測路徑對照
8. Proposals: open (approve / edit / dismiss), approved and waiting for trades, decided and closed, with "check the rules now" 提案：待處理（核准／修改／略過）、已核准待下單、已關閉，以及「立即檢查規則」

The SAA drift bars, colour-coded green / amber / red, sit on the Allocation page only, so the dashboard does not repeat them; the largest drift is the band's second line. 以綠／黃／紅標示的 SAA 偏離長條只放在資產配置頁，儀表板不重複；最大偏離列在本週摘要第二行。

**Navigation 導覽:** four pages as buttons — Dashboard, Holdings, Performance, Allocation — and four groups that list their pages below the button: Analysis (look-through, stress test, efficient frontier, attribution, regression, sectors), Other risks (red flags, cost of equity, costs & tax), Life planning (calculator, life timeline, Monte Carlo, windfall), More (data status, CSV import). On a phone the four pages are a bottom tab bar and "More" opens the groups. Navigation buttons and page titles show Chinese only. New trades are entered at the top of Holdings, which also holds the valuation watchlist and, folded, the securities list. 四個頁面按鈕——儀表板、持倉、績效、資產配置——與四個在按鈕下方列出頁面的群組：分析區（合併透視、壓力測試、效率前緣、績效歸因、回歸分析、產業熱圖）、其他風險（紅旗指標、權益成本、費用與稅務）、人生規劃（複利計算機、人生時間軸、蒙地卡羅、大額資金）、其他（資料狀態、匯入 CSV）。手機上四個頁面改為底部分頁列，「更多」打開各群組。導覽按鈕與頁面標題只顯示中文。新增交易在持倉頁最上方；持倉頁也包含估值觀察清單，以及收合的證券主檔。

Monthly and quarterly outputs (N2 attribution, F5 re-run, N1 5-factor results) appear in the weekly view only in the week they update. 每月與每季產出（N2 歸因、F5 重跑、N1 五因子結果）只在更新當週出現在週檢視。

## 6. Architecture & Data Sources 系統架構與資料來源

The stack is a Next.js PWA on Vercel plus a Supabase backend, built entirely with Claude Code and running on free tiers. 技術架構為部署在 Vercel 的 Next.js PWA，加上 Supabase 後端；完全以 Claude Code 開發，使用免費方案運行。

&#91;embedded content: System architecture · 3 layers, 1 human checkpoint\]

Nightly jobs pull free data into Postgres; the rules engine turns fired rules into proposals, pushes them, and Hugo trades by hand. Fills come back through manual entry or a broker statement CSV. A GitHub Actions cron runs the nightly job itself and writes to Postgres with the Supabase secret key, kept in GitHub's encrypted secrets; its nightly reads and writes also keep the free project from auto-pausing. (Changed in Phase 1, step 4 from calling a Supabase Edge Function: on the free plan an Edge Function stops after 2 seconds of CPU time and 150 seconds in all, too little for three years of prices and AGGU's 25 MB fund file.) 每夜排程把免費資料寫入資料庫；規則引擎把觸發的規則變成提案並推播，由 Hugo 手動下單；成交資料再以手動輸入或券商對帳單 CSV 匯回。每夜排程直接在 GitHub Actions 執行，以存放在 GitHub 加密 secrets 中的 Supabase secret key 寫入資料庫；每晚的讀寫同時避免免費專案因閒置而自動暫停。（第一階段第 4 步起改變：原本規劃呼叫 Supabase Edge Function，但免費方案每次只有 2 秒 CPU、最長 150 秒，不足以處理三年價格與 AGGU 的 25 MB 基金檔案。）

| Data 資料 | Free source 免費來源 | Used by 使用者 |
| --- | --- | --- |
| Taiwan prices, financials, filings 台股價格、財報、重大訊息 | TWSE OpenAPI, FinMind, MOPS 公開資訊觀測站. Daily closes: FinMind, dividend-adjusted by the nightly job from its ex-dividend results; TWSE OpenAPI as backup 每日收盤價以 FinMind 為主（由每夜排程依除權息結果還原），證交所 OpenAPI 備援 | F12, N1, N3, F18 |
| US filings 美股財報與 8-K | SEC EDGAR: XBRL company facts of 10-K / 10-Q (F12, step 4), sent with a contact User-Agent (`SEC_USER_AGENT`) as the SEC requires; Taiwan statements from FinMind's three statements and ex-dividend results 美股財報取自 SEC company facts（需聯絡 email）；台股財報取自 FinMind 三大報表與除權息結果 | F12, N3 |
| US stock, ETF and index prices 美股、ETF 與指數價格 | FinMind US prices as primary (daily, with adjusted close); Alpha Vantage free key as backup (25 requests/day; fills missing days only). LSE-listed AGGU: iShares daily NAV, with Alpha Vantage AGGU.LON weekly as backup (step 4) 主要用 FinMind（每日、含還原收盤價），Alpha Vantage 備援；倫敦掛牌的 AGGU 用 iShares 每日淨值，Alpha Vantage 週線備援（第 4 步） | All |
| TWD/USD 台幣匯率 | Bank of Taiwan daily rates through FinMind, the middle of spot buy and sell; FRED (weekly) as backup 臺灣銀行每日牌告（經 FinMind，取即期買賣中間值），FRED 週資料備援 | F18, N2, N5 |
| US rates 美國利率 | FRED; the 3-month bill (TB3MS, monthly) as N1's risk-free rate since Phase 2, step 2; the 10-year (DGS10, each month's last day) as F11's since step 3, with the US Treasury's daily par yield curve as fallback 自第二階段第 2 步起以 3 個月國庫券（TB3MS，每月）作為 N1 的無風險利率；第 3 步起以 10 年期公債（DGS10，取每月最後一天）作為 F11 的無風險利率，美國財政部每日殖利率曲線為備援 | F11, N1 |
| S&P 500 and TAIEX daily 標普 500 與加權報酬指數每日收盤 | FinMind (^GSPC; TAIEX total return index 發行量加權股價報酬指數); FRED SP500 and TWSE's daily index report as fallbacks (Phase 2, step 2) FinMind 為主，FRED 與證交所每日指數報表為備援（第二階段第 2 步） | N1 |
| Sector closes 類股價格 | Phase 2, step 7: the Select Sector SPDR ETFs' adjusted closes (FinMind USStockPrice; Alpha Vantage's weekly adjusted closes as the fallback, with a key); the TWSE industry indices' daily closes (FinMind TaiwanStockPrice, ids such as Electronic, FinancialInsurance; TWSE OpenAPI MI_INDEX, the last trading day only, filling a missing day), a little over a year (400 days) back 第二階段第 7 步：Select Sector SPDR ETF 還原收盤價（FinMind 美股價格，備援為 Alpha Vantage 週還原收盤）；證交所類股指數每日收盤（FinMind 台股價格，如 Electronic、FinancialInsurance；備援為證交所 OpenAPI MI_INDEX 最近一個交易日），讀取約一年（400 天） | N7 |
| Taiwan 10-year yield 台灣 10 年期公債殖利率 | Central Bank of the ROC's open data EG43M01 (capital-market rates), its 10-year secondary-market column, monthly, about two months behind (Phase 2, step 3); the setting in config capm as fallback 中央銀行開放資料 EG43M01（資本市場利率）的「十年期政府公債次級市場利率」，每月、約落後兩個月（第二階段第 3 步）；config capm 的設定值為備援 | F11 |
| US CAPE 週期調整本益比 | Robert Shiller's online data (ie_data.xls, monthly since 1871, with the S&P 500 price and dividends); multpl.com's monthly tables as fallback (Phase 2, step 1) Shiller 教授的線上資料（ie_data.xls，1871 年起每月，含 S&P 500 價格與股利）；multpl.com 每月表格為備援（第二階段第 1 步） | F3 |
| MSCI ACWI drawdown 全球股市跌幅 | The iShares MSCI ACWI ETF's daily closes, loaded like the other US ETFs (FinMind; Alpha Vantage fills gaps) ACWI ETF 每日收盤價，與其他美國 ETF 相同方式載入 | F3 |
| Factor returns 因子報酬 | Kenneth French Data Library | N1 |
| Equity risk premium 股票風險溢酬 | Damodaran Online: the implied ERP by month (ERPbymonth.xlsx, trailing-12-month figure); Taiwan's country risk premium from his country table, kept as a setting; the typed ERP in config capm as fallback (Phase 2, step 3) Damodaran Online：每月隱含風險溢酬（ERPbymonth.xlsx，近 12 個月現金殖利率法）；台灣的國家風險溢酬取自其國家風險表，存為設定值；config capm 的自訂值為備援（第二階段第 3 步） | F11 |
| Governance and penalties 公司治理與裁罰 | Phase 2, step 5: the Ministry of Environment's penalties (open data ems_p_46, free key `MOENV_API_KEY`) by the company's business ID from TWSE's company profiles (t187ap03_L); TWSE's governance evaluation and EPA ECHO typed in by the owner, as cgc.twse.com.tw refuses scripts and ECHO names facilities, not companies 第二階段第 5 步：環境部裁罰（開放資料 ems_p_46，需免費金鑰）依證交所公司基本資料的統一編號比對；公司治理評鑑（網站擋程式）與 EPA ECHO（以工廠命名）由使用者自行登錄 | N3 |
| Auditor changes, restatements, going concern 更換會計師、財報重編、繼續經營 | Phase 2, step 5: SEC submissions (8-K Items 4.01 and 4.02, the SIC industry) and EDGAR full-text search of 10-Ks for the going-concern paragraph; TWSE's daily material announcements (t187ap04_L, the last day only, so read from the first night forward) and a change of audit firm in its company profiles; MOPS by hand before that 第二階段第 5 步：SEC 8-K 4.01／4.02 與 10-K 全文搜尋；證交所每日重大訊息（只有最近一天，自第一晚起讀取）與公司基本資料的簽證事務所變動；之前的資料由使用者查公開資訊觀測站登錄 | N3 |
| ETF holdings ETF 成分股 | Phase 2, step 6: Vanguard's portfolio-holding JSON (VT, VOO; 500 lines a page, ticker, ISIN, weight), Fubon's assets page (00692); the GICS sector of S&P 500 members from State Street's Select Sector SPDR holdings files, of Taiwan companies from their TWSE industry code; read monthly. iShares' US files refuse plain requests and Cathay's page is closed to scripts, so other funds count whole 第二階段第 6 步：Vanguard 成分股 JSON（VT、VOO）、富邦投信資產頁（00692）；S&P 500 成分股的 GICS 產業取自 State Street Select Sector SPDR 持股檔，台股依證交所產業別；每月讀取。其他基金以整檔計算 | F14 |
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
| proposals 提案 | id, rule\_id, created\_at, status, orders, dismiss\_reason, state, detail, closed\_reason (step 9) | Rules engine |
| windfall\_tranches 分批計畫 | plan\_id, due\_date, amount\_twd, status (scheduled/accelerated/done) | F3 |
| valuations 估值 | ticker, date, model, iv\_bear, iv\_base, iv\_bull, inputs | F12 |
| beta\_results Beta 結果 | ticker, benchmark, model (1F/5F), freq, window, beta, alpha, factor\_loadings, r2, std\_err, run\_date | N1, F11 |
| red\_flags 紅旗 | ticker, date, indicator, value, level, coverage\_pct | N3 |
| attribution 歸因 | period, level, segment, allocation, selection, interaction, fx | N2 |
| config 設定 | tax thresholds, push schedule, quiet hours, satellite cap, single-stock cap, CMA per asset class | F15, Section 4–5 |
| watchlist 觀察清單 | ticker, added\_on, buy\_threshold, trim\_threshold, active, assumptions (step 4) | F12, N3 |
| windfall\_plan 大額資金計畫 | total\_twd, received\_on, cape\_percentile, tranche\_count, tiers\_fired, current\_drawdown\_peak | F3 |
| manual\_assets 非上市資產 | name, asset\_class\_id, unit (grams/TWD), quantity, valuation\_method, last\_value\_twd | N5, N4, N6 |

A 20th table, push\_subscriptions (endpoint, keys, device name), is added in Phase 1 with the Web Push setup, with notifications, the pushes' outbox and log (step 10). 第 20 張資料表 push\_subscriptions（端點、金鑰、裝置名稱）會在第一階段建置 Web Push 時一併加入，另有推播的待送清單與紀錄 notifications（第 10 步）。

Two bookkeeping tables join them in Phase 1: audit\_log (table, row, old and new values, who and when) for N5's edit history (step 2), and job\_runs (job, start, finish, status, per-feed detail) for the nightly job's outcomes and the data-failure alert (step 4). 第一階段另有兩張紀錄用資料表：audit\_log（資料表、資料列、修改前後內容、修改者與時間），供 N5 的修改紀錄使用（第 2 步）；job\_runs（工作、開始與結束時間、狀態、各資料來源明細），記錄每夜排程結果並供資料異常警示使用（第 4 步）。

Phase 2 adds market\_series (series, obs\_month, value, source): the monthly S&P 500 CAPE, price and dividend yield the windfall planner reads, and since step 2 the US 3-month bill rate, written by the nightly job only (step 1); and index\_prices (index\_id, price\_date, close, source): the daily closes of the indices N1 regresses on, S&P 500 and TAIEX, and later N7's sector proxies, also written by the job only (step 2). beta\_results gets each holding's β once a month. Since step 3 market\_series also holds F11's US and Taiwan 10-year yields and Damodaran's implied ERP (us\_treasury\_10y, tw\_govt\_10y, us\_implied\_erp). 第二階段新增 market\_series（資料名稱、月份、數值、來源）：大額資金分批使用的每月 S&P 500 CAPE、價格與股息殖利率，第 2 步起另有美國 3 個月國庫券利率，只有每夜排程能寫入（第 1 步）；以及 index\_prices（指數代號、日期、收盤、來源）：N1 回歸使用的標普 500 與加權報酬指數每日收盤，之後也存放 N7 的類股代理，同樣只有排程能寫入（第 2 步）。beta\_results 每月存入各持股的 β。第 3 步起 market\_series 另存 F11 的美國與台灣 10 年期公債殖利率及 Damodaran 隱含風險溢酬。

Phase 2, step 4 adds fundamentals (ticker, period\_end, figures, currency, filed\_on, source): each single stock's twelve-month flows and quarter-end balances from its filings, written by the nightly job only. 第二階段第 4 步新增 fundamentals：個股每季的近四季流量與季末餘額，只有每夜排程能寫入。

Phase 2, step 5 adds company\_profiles (ticker, industry\_code, industry, sic, auditor, business\_id, checked, source), what the job knows of each single stock besides its filings, and red\_flag\_events (ticker, indicator, event\_date, source, ref, title, url, value), the events the feeds find, both written by the job only; and red\_flag\_entries (ticker, indicator, as\_of, value, note), the owner's own entries, logged. red\_flags gains detail (what each indicator read) and the levels none and na; fundamentals' figures gain grossProfit, cogs, sga, receivables, ppe, totalAssets, totalLiabilities and retainedEarnings. 第二階段第 5 步新增 company\_profiles（公司產業、簽證事務所、統一編號、各資料來源檢查日）與 red\_flag\_events（資料來源找到的事件），只有每夜排程能寫入；以及 red\_flag\_entries（使用者自行登錄，留有紀錄）。red\_flags 新增 detail 欄與 none（無資料）、na（不適用）兩種等級；財報數字新增毛利、營業成本、管銷費用、應收帳款、不動產廠房設備、總資產、總負債與保留盈餘。

Phase 2, step 6 adds fund\_holdings (fund, as\_of, source, constituents, loaded\_at): each fund's newest holdings file, one row per fund with its lines as compact arrays, written by the job only; company\_profiles gains sector (GICS) for the stocks held directly. 第二階段第 6 步新增 fund\_holdings：各基金最新的成分股檔案（每檔一列），只有每夜排程能寫入；company\_profiles 新增 GICS 產業欄位。

Phase 3, step 1 adds simulation\_runs (model, run\_date, summary): the nightly job's monthly Monte Carlo re-run, the inputs and the figures at the marks, written by the job only, read by the dashboard in the week it updates. 第三階段第 1 步新增 simulation\_runs（模型、執行日、摘要）：每夜排程每月一次的蒙地卡羅重跑結果，只有排程能寫入，儀表板在更新當週讀取。 Step 2 adds only config rows: timeline (the later goals) 第 2 步只新增 config：timeline（後續目標）。

After Phase 3, N5 adds splits (ticker, ex\_date, ratio, note): one row per stock split, ratio new shares per old share; trades stay as traded and the models read them in today's units. 第三階段後，N5 加入 splits（代號、生效日、比例、備註）：每次股票分割一列，比例為每 1 股舊股換得的新股數；交易維持成交時的紀錄，模型以今天的股數讀取。

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

- [ ] CMA per asset class: entered on the Allocation page (step 6) 各類別資本市場假設：在「資產配置」頁輸入
- [ ] F3 acceleration tiers 15% / 25% / 35%: editable on the Windfall page; decide with its backtest once real series load 加速級距：在「大額資金」頁依回測決定
- [ ] Valuation trim threshold 1.25 × intrinsic value and selling half (rule TRIM_ZONE); F12's default growth rates (`valuation`) are placeholders until Hugo sets his 估值減碼門檻與賣出比例、預設成長率待確認
- [ ] Foreign filers (IFRS, 20-F) and ADRs have no filings feed: type FCFF, net debt and shares on the Valuation page 外國發行人與存託憑證無財報來源，需自行輸入
- [ ] Weekly review day and time; Sunday 20:00 Taipei until set on the Notifications page 每週檢視時間；預設週日 20:00
- [ ] N3 exclusion list: empty until set on the Red flags page (industry codes or names, tickers) N3 排除產業清單：在「紅旗指標」頁設定前為空
- [ ] N3 governance tiers and US environmental penalties have no feed a script can read: typed in on the Red flags page (TWSE's evaluation each spring; EPA ECHO) 公司治理評鑑與美國環境裁罰無法以程式讀取，需自行登錄
- [ ] DCA debit day (`dca.day_of_month`, Rules page); MONTHLY_CONTRIBUTION waits until set 定期定額扣款日；設定前每月投入規則不觸發
- [ ] F2 defaults: inflation 2%, step-up 0% (`projection`) are placeholders 通膨與調升比例為暫定值
- [ ] 複委託 broker: pick on the Costs page; confirm its prices, London fees and London ETFs with the broker (starting values from a 2026-09-27 public comparison) 選定複委託券商並向券商確認費率
- [ ] Foreign-currency cash after a USD-settled sale has no place (manual_assets is grams or TWD): settle in TWD, or add FX balances 外幣交割後的外幣現金無處登錄
- [x] Splits: done after Phase 3 — entered on each security's page (table `splits`), trades before the ex-date read in the new shares 股票分割：第三階段後完成，在各證券頁登錄
- [ ] Irish ETFs: CSPX, IB01 and IGLN priced from iShares daily NAVs since after Phase 3, like AGGU; VWRA (Vanguard) still has only Alpha Vantage's weekly closes, which refuse cloud requests: add a daily source before a swap into it 愛爾蘭 ETF：CSPX、IB01、IGLN 已改用 iShares 每日淨值；VWRA 仍只有 Alpha Vantage 週線，轉換前需先加入每日來源
- [ ] US–Taiwan double-tax bill (US withholding 30% → 15%): change `tax.withholding.US` once in force 台美租稅協定生效後修改預扣稅率
- [ ] TWD risk-free rate for N1 is a setting (1.7%); Central Bank EG41M01 (money-market rates) is a candidate monthly series, after a source check 台幣無風險利率為設定值，EG41M01 待檢查
- [ ] F11 starting inputs: ERP 4.23%, Taiwan CRP 0.78% (Damodaran, 2026-01-05, updated Jan / Jul); tick "checked" on the Cost of equity page 確認 F11 起始輸入值
- [ ] F14's map from TWSE industry codes to GICS sectors is a starting map (config `look_through.tw_sectors`): check it on the Look-through page; N7 reads it too F14 的證交所產業別對 GICS 產業為起始對應，請在「合併透視」頁確認
- [x] N7 Taiwan sector history: FinMind's TaiwanStockPrice carries the TWSE industry indices' daily closes (source check 2026-10-28), TWSE's MI_INDEX the fallback N7 台灣類股歷史資料：FinMind 提供證交所類股指數每日收盤，證交所 MI_INDEX 為備援
- [ ] N7's map from the 20 TWSE industry indices to GICS sectors is a starting map (config `sectors.tw`): check it on the Sectors page N7 證交所類股指數對 GICS 產業為起始對應，請在「產業熱圖」頁確認
- [x] Decided: satellite 20% of the regular pool, trim above 25%, windfall excluded; 複委託 only; public repo with demo data only 已決定：衛星 20%／25%、僅複委託、公開 repo 只放示範資料
- [ ] (Raised in Phase 3, step 1) F5 and F7 read the history the free feeds hold, about five years of monthly returns by default (F7 asks for ten and uses what there is, at least 36 months): short for a 30-year simulation. Calibration to the CMA keeps the level in your hands, but the shape of the tails is only as wide as those years; a longer free history (index series back to the 1990s) would help （第三階段第 1 步提出）F5 與 F7 讀取免費資料來源擁有的歷史，預設約五年月報酬（F7 要求十年，有多少用多少，至少 36 個月），對 30 年的模擬偏短。依資本市場假設校準使水準由你決定，但尾端的寬度只反映那幾年；更長的免費歷史（回溯到 1990 年代的指數資料）會有幫助
- [ ] (Raised in Phase 3, step 3) F10 replays cash with BIL in TWD, which moves with the dollar as N4 treats BIL; a TWD savings balance or money-market fund would not. Gold and bonds are GLD and AGG (a US aggregate, not global bonds), and the equity series stands for ACWI as F3's gauge （第三階段第 3 步提出）F10 以台幣計的 BIL 回放現金，會隨美元波動（與 N4 對 BIL 的處理相同），但台幣活存或貨幣基金不會；黃金與債券分別為 GLD 與 AGG（美國綜合債券，不是全球債券），股票資料作為 F3 指標，代表 ACWI
- [ ] (Raised in Phase 3, step 5) N2's level 2 prices each sector with its Select Sector SPDR fund as a price return (no dividends) and reads about a year of closes; the benchmark's sector weights are the core equity fund's file of the day, not each month's. Longer, total-return sector series would sharpen it （第三階段第 5 步提出）N2 第二層以 Select Sector SPDR 基金的價格報酬（不含股息）衡量各產業，約讀取一年的收盤價；基準的產業權重取當天的核心股票基金檔，而非每個月的。更長、含息的產業資料會更精確
- [x] Phase 3's gate: passed by Hugo on 2026-10-29, after merging the Phase 3 pull requests (#20, #21), applying the migrations and checking each Phase 3 page's numbers against his own money; the app is complete 第三階段的關卡：Hugo 於 2026-10-29 通過，已合併第三階段的 pull request（#20、#21）、套用 migration，並對照自己的資金檢查各頁數字；App 建置完成

**Decisions by step 各步驟決策** (the code and migrations hold the detail 細節見程式與 migration)

Phase 1 第一階段:

- Spec review after step 3: cash flows got an N5 form and CSV import saves cash dividends; Vercel deploy and PWA install are in docs/deploy-vercel.md (`claude/**` branches do not deploy) 現金流表單與 CSV 股利；部署說明
- Step 1 / 4, data: AGGU priced from the iShares daily NAV, Alpha Vantage weekly as fallback; daily FX from Bank of Taiwan via FinMind (FRED fallback), trade entry defaulting to the trade date's rate or the newest within `fx_rate_check.max_age_days` (10); gold in TWD = FinMind USD gold × that day's USD rate ÷ 31.1035 g, hand value as fallback 資料來源：AGGU 用 iShares 淨值；臺銀匯率；台幣金價
- Step 4, nightly job: runs in GitHub Actions with the Supabase secret key (not an Edge Function: 2 s CPU is too little); the public log shows counts only, tickers stay in `job_runs`; DATA_FAILURE counts failed runs and nights with no run 每夜排程在 GitHub Actions 執行；公開紀錄只列數量
- Step 5, performance: TWR daily per holding from adjusted closes, weighted by the previous close's value, a trade at its day's close; XIRR from the trades (buys in, sales and dividends out, manual-asset changes, end value), contribution cash flows left out; SAA benchmark = targets rebalanced daily on each class's `benchmark_ticker` in TWD, shared proxies merged; manual assets replayed from the audit log, savings return 0%; `nav_snapshots.total_twd` both pools, `weights_by_class` on the regular pool, recomputed nightly from the first trade; periods ≥ 1 year annualised, shorter ones not TWR 逐日依持股；XIRR 依交易；基準每日再平衡；一年以上才年化
- Step 6, allocation: CMA is config `cma` (return, volatility, source, `last_verified`); drift colours follow F8_DRIFT's 5/25 band (red past it, amber past `drift_display.warn_share` 0.5 of it), satellite by R2 (amber 20–25%, red > 25%); targets saved together summing to 100%; donuts show the regular pool with the 80/20 inner ring, fixed slice colours, every slice named CMA 存 config；偏離顏色依 5/25；圓餅圖預設一般資金池
- Step 7, VaR: both pools; each holding on its class's `benchmark_ticker`, a theme ETF on its own prices once it has the window; TWD balances add value, no risk; Σ = sample covariance of 52 × `var.lookback_years` weekly Friday returns in TWD (view `weekly_prices`), no VaR when a proxy lacks the window; z from `var.confidence` rounded to 3 decimals (1.645); today's figure live, `var_95_1w` saved nightly for the 52-week line; histogram has a bin edge on the cutoff; Taiwan splits folded into adjusted closes (a day within 10% of a split ratio) 風險值涵蓋兩個資金池；z 取三位小數；台股分割納入還原價
- Step 8, F2: one month-by-month engine for F2 and F5, r = yearly ÷ 12, contribution at month end growing by (1 + step-up)^(1/12) − 1; plan = config `projection` (keeps its own PMT and return); expected return = target mix over classes with a CMA, re-weighted; actual vs plan on the regular pool at each past month end, money from the trades, gap split into money and growth 單一逐月引擎；計畫存 config；實際對照依交易
- Step 9, rules engine: each enabled rule evaluated by its `condition` on the regular pool after every nightly run and on "Check the rules now"; sale proceeds stay in the pool and buy the core classes furthest below target (at most `MONTHLY_CONTRIBUTION.max_classes`, 2; F8 never buys the satellite), through the largest listed holding, else a TWD balance, else the benchmark; sales round up, buys down; R2 trims pro rata net of R1's live trims; F8 cash first (no sale when the next contribution fixes it); MONTHLY_CONTRIBUTION from the day after the DCA date within `proposal_expiry_days`; ANNUAL_REVIEW from January's first Saturday; a rule fires once per `cooldown_days` per state, one open proposal per state (unique index), proposals close on timeout (14 days), clearing or a new state; dismissed or filled periods are not proposed again; every change logged 規則引擎評估方式、下單取整、冷卻與提案生命週期
- After step 9: US orders in fractions to 4 decimals (config `orders`); Taiwan stays whole shares 美股零股取到小數四位
- Step 10, push: three kinds, never a price: new proposal, weekly review (rules, largest core drift, value and change vs the snapshot a week before), data failure (once per streak); outbox and log table `notifications`, unique by kind and key; sent by GitHub Actions after the nightly job and hourly at minute 7, weekly review within the hour after `weekly_review`, skipped a day late; `quiet_hours` (23:00–08:00) hold pushes; the dashboard is home in Section 5's order, Phase 2 parts marked where they will sit; iPhone needs the Home Screen app (iOS 16.4+) 三種推播；安靜時段；儀表板為首頁
- Step 11, F15: config `tax`, `fees`, `brokers`, `fund_costs` on the Costs page (`tax.last_verified`); fund drag = TER + yield × share withheld (tracking difference shown, not added), plus custody abroad; 30-year cost on the F2 engine (yearly drag off the return, fee + FX off each contribution of DCA ÷ max_classes); draft orders carry fees (Taiwan commission and sale tax rounded down; broker fee abroad; FX spread not added); US_ESTATE_TAX on US-domiciled holdings of both pools at the latest USD rate vs US$60,000, a suggestion with no orders, cooldown 30 days; Taiwan checks per calendar year: overseas income (net gains abroad + dividends) vs the minimum tax floor, NHI premium on each Taiwan dividend ≥ the threshold (an upper bound for ETFs) 費用與稅務設定、拖累算法、遺產稅與台灣稅務檢查

Phase 2 第二階段:

- Step 1, F3: `market_series` holds `us_cape`, `sp500_price`, `sp500_yield` monthly from Shiller's ie_data.xls (link read nightly; SheetJS 0.20.3 from its own site), multpl.com fallback; gauge = CAPE percentile since 1881 at the plan's start month, tranche count by `windfall_pace` (30 / 70 → 6 / 12 / 24), due monthly on the start day; ACWI ETF as the MSCI ACWI proxy, drawdown vs the 52-week high (`window_weeks`), named by its peak, a deeper tier marks shallower ones; `tiers_fired` records {drawdown, peak_date, fired_on}; a tranche = cash waiting ÷ tranches left, from the windfall pool's TWD balances; split by core targets, `pool = windfall`, bought through `windfall.vehicles`, else the pool's largest holding, else the benchmark; strategic cash's share stays; backtest on Shiller's S&P 500 from `windfall.backtest.from_year` over `horizon_months` (cash at `windfall.cash_return`) CAPE 百分位定批數；ACWI 回落觸發級距；每批 = 等待現金 ÷ 剩餘批數
- Step 2, N1: benchmarks S&P 500 (FinMind ^GSPC, FRED fallback) and TAIEX total return (FinMind, TWSE fallback) in `index_prices`; closes reach back 5 + 1 years; returns from adjusted closes, local currency by default, TWD toggle; R_f per period from TB3MS (USD) or the TWD setting; Dimson for daily returns across markets > 8 h apart (Taiwan vs S&P adds the index's day before; US vs TAIEX adds TAIEX's day after), SE of the sum; t-interval with n − k df; Blume in config `regression`; rolling 52 weeks; compare up to 5; the monthly refresh saves each holding's β vs both indices in `beta_results` (adjusted β, CI, n, slopes in `factor_loadings`); N7 added as step 7 N1 基準、報酬、Dimson、每月存 β
- Step 3, F11: CAPM per market in its own currency: E(R) = R_f + β (ERP + CRP), R_f the 10-year (US DGS10 month end, Treasury fallback; Taiwan CBC EG43M01, setting fallback), ERP Damodaran's monthly implied (T12m, Excel 1904 dates) or typed (`capm.erp`), Taiwan CRP 0.78%; β Blume-adjusted (`capm.beta`) from N1's monthly refresh, else live; no new table: worked out on request F11 各市場 CAPM；R_f 用 10 年期；β 用 Blume 調整
- Step 4, F12: figures per quarter end in `fundamentals` (TTM flows from quarters, years to date and years; balances at the end; first report kept); loaded nightly for stocks held or watched and their peers; DCF = two-stage FCFF (`valuation.years`, scenario growth, terminal growth) at WACC with E at market value, R_e from F11, R_d = interest ÷ debt else R_f + `debt_spread`, tax = tax ÷ pretax else `tax_rate`; ΔNWC excludes cash and short-term debt; Gordon DDM on TTM dividends a share at the terminal rate; multiples (P/E, P/B, EV/EBITDA) against the peers' median and the own median over `history_years` (≥ `min_quarters`), bear / base / bull = lowest / median / highest implied price; per stock in `watchlist.assumptions` (model, years, rates, typed FCFF, net debt, shares, tax, R_d, peers); values saved in `valuations` on an edit and by the nightly job after a new quarter; the alerts read the newest saved base value of the stock's model; BUY_ZONE buys the month's contribution share (`satellite_share_with_buy_alert`) within R1's cap and R2's target, once a month per stock list, and MONTHLY_CONTRIBUTION leaves it that share; TRIM_ZONE sells `sell_share` (0.5) of a holding, cooldown 30 days; VALUATION_UPDATED prompts a review when a filing moves the value by more than `change`; the coming week lists each stock's next report (Taiwan deadline, US estimated from last year's filing date) 財報、三種模型、警報與下週財報日
- Step 5, N3: nine indicators, thresholds in config `red_flags`; Beneish M (eight-variable, the twelve months to the newest quarter end against the year before, SG&A or else operating expenses, D&A as depreciation) red above −1.78; Altman Z for manufacturers (SIC 2000–3999, TWSE industry codes in `manufacturing`) with the market value of equity, Z″ for others or without a profile (book equity, red < 1.10, amber < 2.60), banks and insurers (`financial`) without either; operating cash flow below net income at three yearly quarter ends → amber; auditor change, going concern, restatement and penalties count events in 3 × 365.25 days, from the feeds or the owner's entries (a count as of a date, 0 for checked and none); governance from the owner's tier, bottom 35% amber; exclusion by ticker or by industry code or name; light = worst level covered, coverage = covered ÷ applicable; a Taiwan auditor change is a change of firm (a partner rotating inside it is left out); the job reads TWSE's profiles and announcements nightly and SEC or MOENV when a company is due its weekly scan (`scan_days` 7), then saves the scan before the rules; an entry saves today's scan of its company at once; RED_FLAG_WORSENS (a holding, both pools) and RED_FLAG_RED (a regular-pool satellite stock, exit = `sell_share` 1 of it into the core) fire once per run of a light, named by the day it began; a satellite stock turning red is left to RED_FLAG_RED 九項指標；Beneish、Altman Z／Z″、現金流；事件三年；燈號取最差、覆蓋率；每週掃描；兩條規則每段燈號只觸發一次
- Step 6, F14: holdings of both pools at today's values; each fund spread over its newest issuer file (`look_through.sources`: Vanguard VT, VOO; Fubon 00692), read when `refresh_days` (28) have passed, the unnamed rest of a fund (cash, futures) kept with it; a fund without a file counts whole, in its trade currency and `fund_country`; gold as gold, a TWD balance as TWD cash; a company keyed by its ISIN's country and ticker ("TW:2330"), a direct stock by its market and ticker; country = ISIN country (the issuer's registration), currency = that country's; sector = GICS, S&P 500 members from the Select Sector SPDR files, Taiwan names by `tw_sectors`, the rest not classified, shares of the equity looked through; overlap(A, B) = Σ min(w_A, w_B) over common companies; `top_companies` (30) named, the rest one line; treemap coloured by the seven largest sectors; TER, tracking difference and domicile from F15's `fund_costs` 基金依發行商成分股展開；公司以 ISIN 國家加代號比對；重疊度取較小權重加總
- Step 7, N7: proxies in config `sectors` (`us`: the 11 Select Sector SPDR funds by GICS sector; `tw`: 20 TWSE industry indices by FinMind id, each with its TWSE name and GICS sector; `colour` red_up or green_up), saved in `index_prices` as the fund's ticker or `TW_` and the index id; no new table; returns from the close on or before the period's start (1W, 1M, 3M, the last close of the year before, 1Y; months by calendar, the month's end when shorter) to the newest close, none when no close lies within the 10 days up to the start; a sector with several Taiwan indices takes their equal-weighted average; volatility = sample standard deviation of the last 52 weekly returns (each 7 days back from the newest close), × √52, at least 26; exposure from F14's look-through (both pools or one), split US, Taiwan and elsewhere by the company's country, unclassified kept apart; a treemap tile's colour = the exposure-weighted return of its US and Taiwan rows (elsewhere left out); the portfolio's bubble = the exposure-weighted 1-year return and volatility of the rows; display only, no rule, no push 類股代理設定於 config；報酬自期初或之前的收盤起算；多個台灣指數取等權平均；波動度為 52 週週報酬 × √52；曝險取自 F14；板塊顏色依曝險加權；僅供參考

Phase 3 第三階段 (the gate for Phase 3 was passed by Hugo on 2026-10-29, which fixed its build order in Section 11 第三階段於 2026-10-29 由 Hugo 通過關卡，建置順序見第 11 節):

- Step 1, F5: runs on the F2 engine (`simulate`, the same loop) with a return drawn for each month; the draws are a moving-block bootstrap (config `monte_carlo.block_months`, 3) of whole historical rows, so classes keep their correlation, from each class's `benchmark_ticker` as monthly TWD returns over `lookback_years` (5, the window the nightly job already loads) and at least `min_months` (36) common months, or no run. Each class is re-centred on its CMA expected return ÷ 12 (F2's own monthly return, so the two modes agree on the mean) and, with `scale_to_cma`, its deviations are scaled to its CMA volatility ÷ √12; the history gives the shape of the swings and the co-movement, not the level. Classes without a CMA are left out and the rest re-weighted, as F2's expected return does; the portfolio holds target weights monthly. The windfall: the saved F3 plan's remaining tranches (waiting cash at `windfall.cash_return`, deployed money in the core mix only), else an expected windfall (`monte_carlo.windfall`: amount, arrival month, equal tranches); acceleration is not simulated (F10 replays it). The goal is in today's money (`monte_carlo.target_twd`). Seeded by the run's month, so a page shows the same figures all month; the nightly job saves the month's summary in `simulation_runs`, and the dashboard shows it that week 以 F2 引擎（同一個 `simulate` 迴圈）逐月抽樣報酬；抽樣為整列歷史月份的移動區塊自助抽樣（區塊 3 個月），類別間的相關性得以保留；歷史為各類別 `benchmark_ticker` 近 5 年（排程已載入的範圍）的台幣月報酬，至少 36 個共同月份，否則不執行。各類別以資本市場假設的預期報酬 ÷ 12 為中心（與 F2 相同，兩種模式平均值一致），並預設把波動縮放到假設波動度 ÷ √12；歷史只提供波動形狀與連動，不決定水準。沒有假設的類別不計入、其餘重新加權（與 F2 相同），每月維持目標權重。大額資金：已儲存 F3 計畫的剩餘各批（等待中現金依 `windfall.cash_return`，已投入部分僅計核心類別），否則為預期大額資金（金額、入帳月份、等額分批）；加速投入不在此模擬（F10 回放）。目標以今天幣值計。以當月為亂數種子，因此整個月顯示相同數字；每夜排程每月把摘要存入 `simulation_runs`，儀表板在當週顯示
- Step 2, F1: a page on the same F5 run (so the plan, band and windfall agree): the plan's path on F2's engine dashed, F5's median and 10–90% band, the actual value at each month end with the latest as the last point; the actual counts both pools when a windfall is in the run, else the regular pool. Year ends are the plan's own (year 1 ends twelve months after its first month) joined by straight lines. Phases: accumulation (the plan's start to end) and the windfall's deployment (the F3 plan's tranches, else the expected windfall's); later goals are config `timeline` (month, amount in today's money or none, name; at most 12), shown as lines with the plan's value, the median and the chance of the amount at the year end nearest the month (nothing is proposed from them) 同一次 F5 模擬上的頁面（計畫、區間與大額資金一致）：虛線為 F2 引擎的計畫，加上 F5 中位數與 10–90% 區間，以及每個月底的實際值（最新值為最後一點）；納入大額資金時實際值合計兩個資金池，否則為一般投入資金池。年底以計畫自己的年度為準（第 1 年在第一個月起滿十二個月時結束），以直線相連。階段：累積期（計畫起訖）與大額資金部署（F3 計畫的各批，否則為預期大額資金）；後續目標存為 config `timeline`（月份、今天幣值金額或無、名稱，最多 12 個），以直線標示，並顯示屆時的計畫、中位數與最接近該月年底達成金額的機率（不會據此提出任何建議）
- Step 3, F10: three historical scenarios (2008 from 2007-10, 39 months; 2020 from 2020-01, 15 months; 2022 from 2022-01, 24 months) stored in config `stress` as each month's return in TWD of five long-history series: US stocks SPY, Taiwan stocks the TAIEX total return, bonds AGG, gold GLD, cash BIL (FinMind US adjusted closes and TAIEX total return, × FRED's month-end USD/TWD for the dollar series; built once by `scripts/build_stress_scenarios.ts`, the class's own ETF often not existing then); each asset class maps to one series, the equity series standing for ACWI (whose history starts in 2008) as F3's gauge. The replay holds today's holdings of both pools buy-and-hold by asset class, a class with no series flat; deepest fall from the running peak (the start counted) in % and NT$ of today's value; months to recover from the trough back to that peak, none when the scenario ends first; F3's tiers (from the rule's window and tiers) read on the gauge's month-end closes, each once per drawdown with a deeper tier counting those above it and a reset at a new high. A custom scenario is one shock month by class, then each class's CMA expected return ÷ 12 until the start value returns (at most `custom.max_months`); on demand, nothing saved 三個歷史情境（2008 自 2007-10 起 39 個月；2020 自 2020-01 起 15 個月；2022 自 2022-01 起 24 個月）存為 config `stress`，為五個長歷史資料的台幣月報酬：美股 SPY、台股加權報酬指數、債券 AGG、黃金 GLD、現金 BIL（FinMind 美股還原收盤價與加權報酬指數，美元資料乘以 FRED 月底美元／台幣；由 `scripts/build_stress_scenarios.ts` 一次產生，因類別實際持有的 ETF 當時常尚未存在）；每個資產類別對應一個資料，股票資料作為 F3 的指標（代表 ACWI，其歷史自 2008 年才開始）。回放以今天兩個資金池的持股依資產類別買進持有，沒有對應資料的類別持平；最大回撤自歷史高點（含起點）起算，以百分比與今天價值的台幣金額表示；回本月數從谷底算到回到該高點，情境結束前未回本則留白；F3 級距（取自規則的期間與級距）以指標的月底收盤判斷，每個級距在同一波下跌中只觸發一次，較深級距視為同時觸發較淺者，創新高後重置。自訂情境為各類別第一個月的衝擊，之後各類別依資本市場假設的預期報酬 ÷ 12 成長，直到回到起始價值（最長 `custom.max_months`）；隨選執行，不儲存
- Step 4, F7: long-only mean–variance with weights summing to 1 and per-class bounds (config `frontier.bounds`, at most about twice the target by default); μ the CMA's expected return, Σ the sample covariance of the classes' monthly TWD returns (benchmark ETFs, the N4 proxies) × 12 over `frontier.lookback_years` (10; the nightly job loads the longer of this, the Monte Carlo's and the Regression Lab's windows) on the months every class has, at least `min_months`; solved exactly by pair moves of weight (SMO) at each λ of ½ wᵀΣw − λ μᵀw, the frontier stepped by return from the minimum-variance portfolio to the highest the bounds allow; Sharpe = (E[Rp] − Rf) ÷ σp with `frontier.risk_free` (1.7% a year to start), the tangent portfolio by golden section, the capital market line from (0, Rf) through it; the current mix (regular pool's class weights) and the target mix re-weighted to the classes used; charts: frontier with CML and points, weights stacked along the frontier, correlation heatmap; reference only, never written to F6 只做多的均值–變異數，權重合計 1、各類別有上下限（config `frontier.bounds`，預設最多約目標的兩倍）；μ 取資本市場假設的預期報酬，Σ 取各類別（基準 ETF，即 N4 代理指標）台幣月報酬在 `frontier.lookback_years`（10 年；每夜排程載入此年數、蒙地卡羅與回歸分析區中最長者）內、所有類別都有資料的月份的樣本共變異數 × 12，至少 `min_months` 個月；每個 λ 以成對轉移權重（SMO）精確求解 ½ wᵀΣw − λ μᵀw，前緣依報酬由最小變異數組合逐步到上下限允許的最高報酬；夏普比率 = (E[Rp] − Rf) ÷ σp，無風險利率取 `frontier.risk_free`（起始 1.7%），切線組合以黃金分割法求得，資本市場線由 (0, Rf) 通過切線組合；目前配置（一般投入資金池的類別權重）與目標配置重新加權為所用類別；圖表：含資本市場線與各點的前緣圖、沿前緣堆疊的權重、相關係數熱力圖；僅供參考，不寫回 F6
- Step 5, N2: Brinson–Fachler per class and month on the regular pool, weights at the start of the month (the previous day's value by class), the portfolio's class return chained from the daily series (`DayPoint.classDay`), the class benchmark's from its benchmark ETF; the benchmark is the target weights; a class without a benchmark price is left out and both sides re-weighted, a class not held takes the benchmark's return. Allocation, selection and interaction are worked out on own-currency returns and currency is the remainder to TWD per segment, so the four add up to R_p − R_b in TWD; months are linked by Carino's smoothing, complete months only, the first month of the series a baseline; the attribution's return from start-of-month weights is shown beside the pool's TWR. Level 2: the satellite's single stocks by GICS sector (company_profiles) held through each month as at its start, against the sector weights of the core equity fund (the `us_global_equity` benchmark, its look-through file) with each sector priced by its Select Sector SPDR fund (price return, USD → TWD, N7's `index_prices`, about a year). The nightly job saves each new complete month's effects of both levels in `attribution` (fx the currency effect) and the dashboard shows the latest in the week it is saved 第二層外的第一層：一般投入資金池逐類別逐月的 Brinson–Fachler 歸因，採月初權重（前一日各類別市值），投資組合的類別報酬由每日序列（`DayPoint.classDay`）連乘，基準的類別報酬取自其基準 ETF；基準為目標權重；沒有基準價格的類別不計入、兩邊重新加權，未持有的類別以基準報酬計。配置、選擇、交互以各幣別自身報酬計算，匯率效果為各區塊換算台幣後的差額，四項加總等於台幣的 R_p − R_b；各月以 Carino 平滑法連結，只計完整月份，資料第一個月為基準月；依月初權重算出的報酬與資金池的時間加權報酬並列。第二層：衛星個股依 GICS 產業（company_profiles），以月初持有狀態持有整個月，對照核心股票基金（`us_global_equity` 的基準，取其合併透視檔案）的產業權重，各產業以對應的 Select Sector SPDR 基金（價格報酬，美元轉台幣，取自 N7 的 `index_prices`，約一年）衡量。每夜排程把每個新的完整月份兩層的效果存入 `attribution`（fx 為匯率效果），儀表板在存入當週顯示最新一個月
- Step 6, N1 five factors: a page of the Regression Lab (`/regression/factors`) on Kenneth French's free monthly data, the US five-factor file and the developed and emerging markets' (the global file stops in 2019), loaded by the nightly job into `market_series` as `ff5_<region>_<factor>` (fractions, a month missing any of the six left out, `factors.keep_years` kept); each holding on its market's region (config `factors.regions`: US → US, TW → emerging, UK → developed), the whole portfolio on `factors.portfolio` (developed), today's holdings held through the window at today's weights re-weighted over the months every holding has, gold and balances without a ticker left out; returns monthly, total (dividends reinvested) and in US dollars like the factors, a Taiwan return converted with the month's USD/TWD move; the existing OLS with t = coefficient ÷ standard error, the interval at t(0.975, n − 6), R² and adjusted R², α × 12; windows 2 / 3 / 5 / 10 years (default 3), at least `min_months` 24 Regression Lab 的一個頁面（`/regression/factors`），使用 Kenneth French 的免費月資料：美國五因子檔，以及已開發與新興市場檔（全球檔只到 2019 年），由每夜排程存入 `market_series`，名稱為 `ff5_<區域>_<因子>`（以比例表示，六項缺任一項的月份不納入，保留 `factors.keep_years` 年）；各持股依其市場使用對應區域（config `factors.regions`：US → 美國、TW → 新興、UK → 已開發），整體投資組合使用 `factors.portfolio`（已開發），以今天的持股與權重持有整個期間、在所有持股都有資料的月份間重新加權，沒有代號的黃金與餘額不納入；報酬為月報酬、含息、以美元計（與因子相同），台股報酬以當月美元／台幣變動換算；沿用既有 OLS，t 值 ＝ 係數 ÷ 標準誤，信賴區間用 t(0.975, n − 6)，另有 R² 與調整後 R²、年化 α（× 12）；期間 2／3／5／10 年（預設 3 年），至少 `min_months`（24）個月

After Phase 3 第三階段之後 (open questions closed in code 以程式解決的待決問題):

- Splits, N5: a split is entered on its security's page as N old shares becoming M new ones on the ex-date (table `splits`, ratio M ÷ N; a reverse split below 1); not in the future, as closes before the ex-date are still in old shares, and refused when it would leave a sell larger than the holding. Trades stay saved as traded; every model reads them restated in today's units (quantity × ratio, price ÷ ratio, amounts unchanged), so quantity, average cost a share, value and R1 / R2 are right; F18's day-by-day replay restates quoted closes the same way, so the ex-date moves no value, and returns still come from adjusted closes 股票分割：在證券頁以「N 股舊股變為 M 股新股」登錄（`splits` 表，比例 M ÷ N，反分割小於 1）；不可登錄未來日期，若會使某筆賣出超過持有數量則拒絕。交易維持原紀錄，所有模型以今天的股數讀取（數量 × 比例、價格 ÷ 比例，金額不變）；F18 逐日重算也以相同方式換算原始收盤價，生效日不會產生價值跳動，報酬仍取自還原收盤價
- Prices, Irish swaps: CSPX (253743), IB01 (307243) and IGLN (258441, the USD line of SGLN) join AGGU on the iShares daily NAV, so a swap the US estate-tax check suggests is priced from the first night; VWRA stays on Alpha Vantage weekly. The product page's NAV is read from its own data at full precision, as the page since October 2026 runs the figure into the 52-week range in its text (which had left AGGU on its 25 MB download every night). A NAV that moves to about a whole multiple of the day before (within 3%) is a consolidation or split, and the adjusted NAVs before it are scaled: IB01 consolidated about 20 into 1 on 2021-07-26 愛爾蘭替代 ETF 價格：CSPX、IB01、IGLN 與 AGGU 一樣讀取 iShares 每日淨值，VWRA 維持 Alpha Vantage 週線；產品頁淨值改由頁面資料讀取完整精度（2026 年 10 月起頁面文字把淨值與 52 週區間連在一起，使 AGGU 每晚都要下載 25 MB 檔案）；單日淨值變為前一日約整數倍（3% 內）視為合併或分割，之前的還原淨值依比例調整（IB01 於 2021-07-26 約 20 合 1）

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

**Phase 2 build order 第二階段建置順序** (set when Phase 1's gate passed 第一階段通過關卡時訂定)

1. F3 windfall tranche planner: it needs no other Phase 2 feature, and the windfall can arrive at any time. 大額資金分批部署：不需要其他第二階段功能，且大額資金隨時可能入帳。
2. N1 Regression Lab, single-factor β (Fama–French 5-factor mode in Phase 3). 回歸分析區（單因子 β；五因子模式在第三階段）。
3. F11 CAPM cost of equity, from N1's β. CAPM 權益成本（取 N1 的 β）。
4. F12 valuation workbench, buy-zone and trim alerts, discounting at F11's cost of equity. 估值工作台與買入／減碼警報（以 F11 的權益成本折現）。
5. N3 red-flag indicator, beside F12's watchlist. 紅旗指標（與 F12 的觀察清單並列）。
6. F14 combined look-through. 核心與衛星合併透視。
7. N7 sector heatmap tab: heatmap, treemap, bubble chart, on F14's exposure (added 2026-10-28). 產業熱圖分頁：熱力圖、板塊圖、泡泡圖，曝險取自 F14（2026-10-28 加入）。

**Phase 3 build order 第三階段建置順序** (set when Hugo passed Phase 2's gate, 2026-10-29 第二階段關卡通過時訂定)

1. F5 Monte Carlo on the F2 engine: it needs no other Phase 3 feature, and F1 shows its fan. 蒙地卡羅（F2 引擎）：不需要其他第三階段功能，且 F1 要顯示它的扇形圖。
2. F1 30-year life timeline, with F2 and F5 and the actuals overlaid. 30 年人生財務時間軸（疊加 F2、F5 與實際值）。
3. F10 stress test and scenario replay, with F3's acceleration tiers. 壓力測試與情境回放（含 F3 加速級距）。
4. F7 efficient frontier and CML, reference only. 效率前緣與資本市場線（僅供參考）。
5. N2 Brinson attribution. Brinson 績效歸因。
6. N1 Fama–French 5-factor mode. 回歸分析區五因子模式。

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
| N1 OLS (added in Phase 2, step 2) | x = 1, 2, 3, 4, 5; y = 2, 4, 5, 4, 5 | β 0.6, α 2.2, R² 0.6, SE 0.283, 95% CI −0.300 to 1.500 (t₀.₉₇₅,₃ = 3.182) |
| N1 Blume | Raw β 1.2 | Adjusted 0.67 × 1.2 + 0.33 = 1.134 |
| N1 Dimson | Daily Taiwan series = 0.7 × S&P 500 that day + 0.5 × the day before | Slopes 0.7 and 0.5, summed β 1.2 |
| F11 CAPM, US (added in Phase 2, step 3) | R\_f 4.0%, β 1.2, ERP 5.0% | Cost of equity 4.0% + 1.2 × 5.0% = 10.0% |
| F11 CAPM, Taiwan | R\_f 1.8%, raw β 0.85 (Blume 0.8995), ERP 4.23% + country premium 0.78% | 1.8% + 0.8995 × 5.01% ≈ 6.31% |
| F12 FCFF (added in Phase 2, step 4) | EBIT 100, tax 20%, D&A 30, CapEx 40, ΔNWC 10 | 60 |
| F12 WACC | E 600 at 10%, D 400 at 5%, tax 20% | 7.6% |
| F12 DCF | FCFF 100, 5% for 5 years, WACC 9%, terminal 2.5%; net debt 200, 10 shares | EV ≈ 1,755.62 (TV 2,012.60); 155.56 a share |
| F12 Gordon | D₀ 2.00, g 3%, R\_e 8% | 41.20 |
| F12 zones | Value 100, price 70; multiples 0.75 / 1.25 | Margin of safety 30%; buy zone at ≤ 75, trim zone at ≥ 125 |
| N3 Beneish (added in Phase 2, step 5) | Every index 1, TATA 0 | M = −4.84 + 0.920 + 0.528 + 0.404 + 0.892 + 0.115 − 0.172 − 0.327 = −2.480: green (≤ −1.78) |
| N3 Altman | X1 0.1, X2 0.2, X3 0.1, X4 1.0, X5 1.2 | Z = 2.53: amber (1.81–2.99); Z″ = 6.56 × 0.1 + 3.26 × 0.2 + 6.72 × 0.1 + 1.05 × 1.0 = 3.03: green (> 2.60) |
| N3 coverage | A US company: 8 indicators apply (no governance rating), 7 covered | 87.5%; the light is the worst of the 7 |
| F14 overlap (added in Phase 2, step 6) | A holds X 50%, Y 30%, Z 20%; B holds X 40%, Y 40%, W 20% | min(50, 40) + min(30, 40) = 70% |
| F14 combined | NT$100,000 of a fund 50% TSMC, NT$20,000 of one 2% TSMC, NT$10,000 of TSMC held directly | NT$50,000 + NT$400 + NT$10,000 = NT$60,400 |
| N7 returns (added in Phase 2, step 7) | Close 100 a year ago, 105 at the last year end, 110 now | 1 year +10.00%; year to date 110 ÷ 105 − 1 = +4.76% |
| N7 volatility | 52 weekly returns, +1% and −1% in turn | Sample SD 0.01 × √(52 ÷ 51) = 1.0098% a week; × √52 = 7.28% a year |
| N7 treemap colour | US tech +10% on NT$30,000, Taiwan tech +20% on NT$10,000 | (30,000 × 10% + 10,000 × 20%) ÷ 40,000 = +12.5% |
| F5 degenerate paths (added in Phase 3, step 1) | No volatility; PMT NT$10,000, 6%/yr, 30 years, no step-up | Median, both band edges and the mean path all ≈ NT$10,045,000, as the F2 case |
| F5 money | No return, no inflation; PV 50,000, PMT 1,000, 2 years | Median 74,000 = money put in; no path ends below it |
| F5 goal | Every path alike; goal below, then above, the final value in today's money | Chance of reaching it 100%, then 0% |
| F5 calibration | A class with CMA 8% a year and 15% volatility | Calibrated monthly mean 8% ÷ 12; monthly standard deviation 15% ÷ √12 |
| F5 windfall | NT$400,000 pool: NT$200,000 deployed, two tranches of NT$100,000 due in months 2 and 3; core mix +1% a month, cash 0 | Month 12: 200,000 × 1.01¹² + 100,000 × 1.01¹⁰ + 100,000 × 1.01⁹ |
| F1 year ends (added in Phase 3, step 2) | Plan starting 2026-05 | Year 0 ends 2026-04-30, year 1 2027-04-30, year 30 2056-04-30 |
| F1 projection at a month | Band median 100 at year 1 and 200 at year 2; month 18 | 150 half way between the two year ends |
| F1 goal chance | Ten paths worth 100 … 1,000 at year 2; goal 600 | 50% reach it; 100% at goal 100, 0% above 1,000 |
| F1 phases | Tranches due 2027-09, 2028-02 and 2028-08; plan from 2026-05 for 30 years | Accumulation 2026-05 to 2056-04; windfall 2027-09 to 2028-08 |
| F10 drawdown (added in Phase 3, step 3) | 60 / 40 mix, buy-and-hold; stocks −10%, −20%, +30%, +30%, bonds +1% a month | 94.4 → 84.004 → 97.372 → 114.632 of 100; deepest fall 15.996% in month 2; back at the peak 2 months after the trough |
| F10 F3 tiers | Gauge −10% a month for three months; tiers 15% / 25% / 35% | 19% below the high in month 2 fires 15%; 27.1% in month 3 fires 25%; 35% never; a 30% fall in one month fires 15% and 25% together |
| F10 custom shock | All stocks −30%, then 6% a year | Back at the start after 72 months (0.7 × 1.005ⁿ ≥ 1) |
| F7 minimum variance (added in Phase 3, step 4) | Two uncorrelated classes, volatility 10% and 20% | Weights 80 / 20; volatility √0.008 = 8.944% |
| F7 tangent portfolio | The same, expected returns 8% and 12%, Rf 2% | Weights ∝ Σ⁻¹(μ − Rf): 70.59 / 29.41; Sharpe √0.61 = 0.7810 |
| F7 Sharpe | E[Rp] 10%, Rf 2%, σp 16% | 0.5 |
| F7 bounds | The better class capped at 50% | Weights 50 / 50 at a high λ; every frontier point sums to 1 within its bounds |
| N2 Brinson (added in Phase 3, step 5) | Benchmark 60 / 40 earning 10% / 2%; portfolio 70 / 30 earning 12% / 1% | Allocation 0.80%, selection 0.80%, interaction 0.30%; sum 1.90% = R_p − R_b (already above) |
| N2 currency | The same, the portfolio's equity earning 2 of its 12 points from the dollar, the benchmark's 1 of its 10 | Currency 0.7 × 2% − 0.6 × 1% = 0.8%; all four effects sum to R_p − R_b in TWD |
| N2 Carino | Several months of any returns | Linked effects sum to the period's R_p − R_b |
| N1 five factors (added in Phase 3, step 6) | 36 months of a return built from market 0.9, size 0.3, value −0.2, profitability 0.1, investment 0.05, α 0.1% a month, plus a little noise (computed with numpy) | Loadings 0.9019 / 0.3068 / −0.1929 / 0.0983 / −0.0401; standard errors 0.0333 / 0.0654 / 0.0867 / 0.1103 / 0.1318; t 27.07 / 4.69 / −2.23 / 0.89 / −0.30; α 0.1154% a month (t 1.25); R² 0.9617, adjusted 0.9553 |
| N1 five factors, no noise | A return that is exactly Rf + 0.9 Mkt − 0.4 CMA | Loadings exactly 0.9, 0, 0, 0, −0.4; α 0; R² 1 |

**First prompt for Claude Code 第一個指令**

```text
Read CLAUDE.md and docs/PRD.md. Start Phase 1, step 1: write scripts/check_sources.ts
that calls each data source in PRD Section 6 once, records rate-limit details and a
sample payload, and reports which tickers in the Investment Principles table each
source covers. Show me the report before writing any app code.
```
