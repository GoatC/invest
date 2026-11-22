[PRD](../PRD.md) › Section 4

# 4. Rules Engine, L2 Automation & Push 規則引擎、自動化與推播

Automation is conditional: the app evaluates written rules after every data refresh, raises a warning when one fires, and stops there: Hugo decides and trades. 自動化是有條件的：每次資料更新後，App 會評估書面規則；規則觸發時發出警示，之後停下，由 Hugo 決定並自行下單。

**Rules engine 規則引擎** — the Investment Policy Statement in executable form. Each rule stores: id, plain-language description (EN / 中文), condition, threshold, action, cooldown, enabled flag. Every edit is logged with date and old / new value. The two Investment Principles rules load as R1 and R2. 規則引擎即可執行版本的投資政策聲明。每條規則記錄：編號、中英文說明、條件、門檻、動作、冷卻期、啟用狀態；每次修改都記錄日期與新舊數值。投資原則的兩條規則即為 R1 與 R2。

**L2 warning flow 警示流程** (changed by Hugo on 2026-11-12: a proposal is now a standing warning that can be dismissed; before it, a proposal was approved, its orders edited, and marked filled, and it expired after 14 days 2026-11-12 Hugo 要求：提案改為可忽略的常駐警示；之前的提案需核准、可修改下單清單、標記成交，並於 14 天後失效)

1. Scheduled job refreshes data, then evaluates all enabled rules. 排程工作更新資料後，評估所有啟用中的規則。
2. A fired rule raises a warning (a row in proposals) with its figures, a line of what it suggests and the orders it suggests, for reference. 觸發的規則發出一則警示（proposals 的一列），附依據數字、一行建議動作與建議下單清單（僅供參考）。
3. Push notification sent to phone and Mac. 推播到手機與 Mac。
4. The warning stands, as tiles on the dashboard and the holdings page and as the in-app banner elsewhere, until Hugo dismisses it, its rule no longer fires (cleared), or a new state supersedes it. It never times out; config `proposal_expiry_days` only says how many days after the debit the monthly contribution still fires. 警示會一直顯示（儀表板與持倉頁的小卡、其他頁的 App 內橫幅），直到 Hugo 按「忽略」、規則不再觸發（解除），或被新的狀態取代；不會逾時關閉。config `proposal_expiry_days` 只決定每月投入在扣款後持續幾天。
5. Hugo trades at the broker if he chooses, and records the trade on the holdings page or by the broker statement CSV, as any trade. 若 Hugo 決定下單，到券商交易後在持倉頁或以券商對帳單 CSV 登錄，與其他交易相同。
6. A dismissed state waits out its cooldown; a dismissed period (a month's contribution, a year's review, a volatility run) is not raised again. A windfall warning dismissed moves its tranche to done (an acceleration's pulled-forward tranches to accelerated): the cash not bought stays in the pool and the tranches left spread it. 忽略後的狀態須等冷卻期結束；已忽略的期間（某月投入、某年檢查、一波波動）不再發出。忽略大額資金的警示即視為該批已處理（加速批次標為加速）：未買進的現金留在資金池，由剩下的批次分攤。

**Push rules 推播規則** (all thresholds editable 所有門檻皆可調整)

| Trigger 觸發事件 | Condition 條件 | Warning suggests 警示建議 | Source 來源 |
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
| Volatility alert 波動警報 (N8 step 3) | Score crosses 6 or 8 from below 分數由下往上穿越 6 或 8 | Tense: watchlist buys; panic: sell the VIX hedge, buy core equity; pushed in the quiet hours too 緊張：買進觀察清單；恐慌：賣出 VIX 避險、買進核心股票；安靜時段照樣推播 | N8 |
| Breaking news 前沿新聞 (N8 step 4) | A topic at 10+ outlets in 3 h and 3 × its usual count 某主題 3 小時內 10 家以上且達平常 3 倍 | The topic, outlets and newest headline; no orders; through the quiet hours 主題、家數與最新標題；不附下單清單；安靜時段照送 | N8 |
| Volatility hedge 波動避險 (N8 step 3) | Score below 4, no hedge held 分數低於 4 且未持有避險 | A 1% VIX-product hedge within the 5% cap 1% 的 VIX 商品避險（5% 上限內） | N8 |
| Dividend paid 配息入帳 (2026-11-12) | A holding's dividend reaches its payment date (or its estimate), unrecorded; only those due within `dividends.push_days` (3) 持股配息到發放日（或估計日）且尚未登錄；只推播最近 3 天內到期者 | Asks whether to record it; opens the cash-flow form filled in; no orders; after the quiet hours 詢問是否登錄，點開為已填好的現金流表單；不附下單清單，安靜時段後送出 | N5 |
| Event ahead 事件前提醒 (N8 step 2) | Two days before a calendar event (`volatility.events.lead_days`) 日曆事件前兩天 | Reminder, no orders, after the quiet hours 提醒，不附下單清單，安靜時段後送出 | N8 |

**Noise controls 降噪設計:** quiet hours 23:00–08:00 Taipei; each rule fires at most once per 7 days unless its state changes; no price-movement alerts. Exception (N8, 2026-11-06): the volatility alert pushes through the quiet hours, as US sessions fall in them. 安靜時段為台北時間 23:00–08:00；同一規則 7 天內最多觸發一次（狀態改變時除外）；不推播價格波動。例外（N8，2026-11-06）：波動警報在安靜時段照樣推播，因為美股交易時間落在其中。
