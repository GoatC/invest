[PRD](../PRD.md) › Section 3, Module B

# Module B — Allocation 配置引擎

**F6 SAA builder SAA 配置建構器**

- Purpose 目的: hold the target weights for each asset class and the core / satellite split; the reference for F8, F18 and N2. 儲存各資產類別的目標權重與核心／衛星比例，作為 F8、F18、N2 的基準。
- Asset classes 資產類別 (editable 可編輯): US / global equity, Taiwan market-cap equity, global bonds, real assets (gold), strategic cash, plus three satellite sleeves (US stocks, Taiwan stocks, tactical themes); target weights in Investment Principles. 美股／全球大盤、台股市值型、全球債券、實體資產（黃金）、戰略現金，以及三個衛星部位（美股個股、台股個股、戰術主題）；目標權重見投資原則。
- Each class maps to one benchmark ETF or index for return measurement. Capital market assumptions (CMA): Hugo sets an expected return and volatility for each core class, with a source note; F2, F5 and F7 read from it. 每個類別對應一檔基準 ETF 或指數，用於計算報酬。資本市場假設（CMA）：由 Hugo 為每個核心類別設定預期報酬與波動度並註明來源，提供給 F2、F5、F7 使用。
- Auto-scored assumptions 自動評分的資本市場假設 (asked by Hugo on 2026-11-09): a satellite class (US stocks, Taiwan stocks, tactical themes) left without an assumption is scored from the stocks and ETFs it holds, so F2, F5 and F7 count it instead of leaving it out; an assumption Hugo types always wins. Each long line (both pools, weighted by exposure) gets CAPM on the index that explains it best, the higher R² of N1's two (a Taiwan-listed fund of US stocks reads the S&P 500): E = R\_f + β × P, β F11's (Blume-adjusted), R\_f the market's 10-year yield, P Hugo's own assumption for the class standing for that market (US → US / global equity, TW → Taiwan market-cap equity) less R\_f, so a β of 1 expects what Hugo expects of the market; F11's ERP + CRP when that class is blank. The class's expected return is the weighted mean; its volatility that of the weighted mix's monthly TWD returns, so diversification counts. Re-scored after each trade in a satellite class, after the assumptions are saved, and every night; settings in config `cma_auto`. 未設定假設的衛星類別（美股個股、台股個股、戰術主題）依其持有的個股與 ETF 自動評分，讓 F2、F5、F7 納入而非略過；Hugo 自行輸入的假設永遠優先。每檔做多部位（兩個資金池、依曝險加權）以最能解釋它的指數（N1 兩個指數中 R² 較高者；投資美股的台灣 ETF 對照標普 500）套用 CAPM：E = R\_f + β × P，β 取 F11（Blume 調整），R\_f 為該市場 10 年期殖利率，P 為 Hugo 對代表該市場類別（美國 → 美股／全球大盤、台灣 → 台股市值型）的假設減 R\_f，因此 β 為 1 時的預期報酬等於 Hugo 對該市場的預期；該類別未設定時改用 F11 的風險溢酬加國家風險溢酬。類別預期報酬為加權平均，波動度取加權組合的台幣月報酬，計入分散效果。衛星類別每次交易後、儲存假設後與每夜重新評分；設定存於 config `cma_auto`。
- Satellite target 衛星目標: 20% of the regular-contribution pool (windfall excluded); above 25% the rules engine proposes a mechanical trim back to 20%. F8 never buys satellite stocks to fill the target; satellite buys come only from buy-zone alerts. 目標為一般投入資金池的 20%（不含大額資金）；超過 25% 時由規則引擎提出機械式減碼回 20%；F8 不會為補足目標而買進衛星個股，衛星買進只來自買入區警報。
- Output 輸出: current vs target weights, drift in percentage points, colour-coded. 目前權重與目標權重、偏離百分點，以顏色標示。

**F8 Rebalancing engine 再平衡引擎**

- Trigger 觸發 (5/25 rule): a core class drifts more than 5 percentage points absolute, or more than 25% relative to its target; plus a calendar check every January. 任一核心類別絕對偏離超過 5 個百分點，或相對偏離超過目標的 25%；另每年 1 月定期檢查。
- Cash-flow first 現金流優先: each monthly contribution is allocated to underweight core classes before any sale is proposed; up to 20% of it may go to the satellite instead while a buy-zone alert is open. To limit minimum-fee drag, each month's cash goes to at most the two most underweight classes. 每月新投入資金先補足權重不足的核心類別，再考慮賣出；有買入區警報時，最多 20% 可改投衛星個股；為降低最低手續費拖累，每月資金最多只投入權重最不足的兩個類別。
- Output 輸出: draft order list with ticker, side, amount in TWD and in trade currency, estimated fees (from F15). Hugo confirms, then trades manually. 建議下單清單（代號、買賣方向、台幣與交易幣別金額、預估費用），由 Hugo 確認後手動下單。

**F7 Efficient frontier & CML 效率前緣與資本市場線**

- Logic 邏輯: long-only mean–variance optimisation with weights summing to 1 and per-class min / max bounds; expected returns from the CMA in F6, covariance from 10 years of monthly returns. 只做多的均值–變異數最適化，權重總和為 1，各類別有上下限；預期報酬取自 F6 的資本市場假設，共變異數取 10 年月報酬。 A satellite class whose assumption is auto-scored (F6) reads its holdings' weighted monthly returns in place of its benchmark's, so its return and risk describe the same holdings (added 2026-11-09). 自動評分的衛星類別（F6）改以其持股的加權月報酬取代基準 ETF，使報酬與風險描述同一批持股（2026-11-09 加入）。

```latex
Sharpe = \frac{E[R_p] - R_f}{\sigma_p}
```

- Output 輸出: frontier curve, capital market line, current and target portfolios plotted as points. Reference only: it never writes back to F6 targets. 效率前緣曲線、資本市場線，並標出目前與目標投資組合的位置。結果僅供參考，不會自動改寫 F6 的目標權重。
- What-if: shorting and leverage 假設情境：做空與槓桿 (added 2026-11-05): below the long-only frontier, a what-if lets each class go short down to a cap (0–100% of the portfolio per class, 0.1 steps; its maximum unchanged and the weights still summing to 100%, so shorts fund longs; gross exposure Σ|w| is shown), and holds the whole mix at a leverage L from 0.1× to 3.0× in 0.1× steps along the capital allocation line: below 1× the rest earns R\_f, above 1× the extra is borrowed at R\_f plus a spread (0–5%, default 1%). Allowing shorts can only raise the best Sharpe ratio. The page notes what a straight line hides: a loss beyond own money ends in a margin call, shorts pay borrow fees and the dividends of what they borrowed. Analysis only: read from the page's address, never saved, never written to F6 targets or `frontier.bounds`, no rule reads it. 在只做多的效率前緣下方新增假設情境：每個類別可放空至上限（每類別占投資組合 0–100%，以 0.1 為級距；上限不變、權重仍合計 100%，即以放空的資金買進其他類別；並顯示總曝險 Σ|w|），整個配置可沿資本配置線以 0.1 倍到 3.0 倍（以 0.1 倍為級距）的槓桿 L 持有：低於 1 倍時其餘資金賺取無風險利率，高於 1 倍時多出的部分以無風險利率加利差（0–5%，預設 1%）借入。允許放空只會提高最佳夏普比率。頁面說明直線所隱藏的風險：虧損超過自有資金即被追繳保證金，放空須支付借券費與所借股票的股利。僅供分析：參數來自網址，不儲存、不寫回 F6 目標或 `frontier.bounds`，也沒有規則讀取。

```latex
E[R_L] = R_f + L\left(E[R_p] - R_f\right) - \max(0,\, L - 1) \cdot \text{spread}, \qquad \sigma_L = L\, \sigma_p
```

**F10 Stress test & scenario replay 壓力測試與情境回放**

- Scenarios 情境: 2008 global financial crisis, 2020 COVID crash, 2022 rate shock, plus a custom shock. 2008 金融海嘯、2020 新冠崩盤、2022 升息衝擊，另可自訂情境。
- Logic 邏輯: apply each scenario's asset-class returns (in TWD) to current weights. 將各情境的資產類別報酬（以台幣計）套用到目前權重。
- Output 輸出: maximum drawdown in % and NT$, months to recover, and which F3 acceleration tiers would have fired. 最大回撤（百分比與台幣金額）、回本所需月數，以及會觸發哪些 F3 加速級距。
- Direction & leverage 多空方向與槓桿 (added 2026-11-05): a short or leveraged holding (N5) moves its class by its exposure, not its own money: each month the value changes by exposure × r and the exposure by (1 + r), so a short gains when its class falls and a 2× long moves twice as far. 做空或槓桿持股（N5）以曝險而非自有資金帶動其類別：每月價值變動為曝險 × r，曝險本身變為 × (1 + r)；因此做空在類別下跌時獲利，2 倍做多的波動為兩倍。
- What-if position 假設部位 (added 2026-11-05): add a position not held, long or short, leverage 1.0× to 10.0× in 0.1× steps, with an amount of own money (default 5% of the portfolio), following one asset class's series. Each scenario shows its own money month by month (it starts at ±L × margin of exposure; a 1 ÷ L move against it uses it up), the lowest share of the margin left (below 0 when a gap costs more than was put in), the first month it reached config `leverage.margin_call_share` (margin call) and the first month it was used up, when the broker would have closed it and its loss is frozen; and the whole portfolio's deepest fall with the position added. Monthly steps miss a crash inside a month; borrowing cost, borrow fees and a short's dividends are left out. Analysis only, nothing saved. 加入一個未持有的假設部位：做多或做空、槓桿 1.0 至 10.0 倍（以 0.1 倍為級距）、投入的自有資金（預設為投資組合的 5%），跟隨某個資產類別的資料。每個情境顯示自有資金的逐月變化（起始曝險為 ±L × 保證金；反向變動 1 ÷ L 即虧光）、剩餘保證金的最低比例（跳空損失超過投入時會低於 0）、首次降到 config `leverage.margin_call_share`（追繳保證金）的月份，以及虧光的月份（券商會在此時平倉，損失就此凍結）；並顯示加入該部位後整個投資組合的最大回撤。以月為單位會漏掉月中的崩跌；未計入融資利息、借券費與做空須支付的股利。僅供分析，不儲存。
