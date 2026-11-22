[PRD](../PRD.md) › Section 3, Module A

# Module A — Planning 大局規劃

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
