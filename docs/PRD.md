# Long-View Investment App — PRD 長期投資 App 產品規格書

Oct 20, 2026 · @Goat · v1.0 · Ready for Claude Code 可交付 Claude Code

This file holds what every task needs: the investment principles, the design principles, the fixed decisions and the feature list. Each other section is a file in [docs/prd/](prd/); read the one the task touches. 本檔收錄每項任務都需要的內容：投資原則、設計原則、已定決策與功能清單；其他章節各一個檔案，放在 [docs/prd/](prd/)，依任務閱讀。

| Section 章節 | File 檔案 | Covers 內容 |
| --- | --- | --- |
| 3 · Module A | [03-planning.md](prd/03-planning.md) | F2 calculator, F3 windfall, F1 timeline, F5 Monte Carlo 複利、大額資金、時間軸、蒙地卡羅 |
| 3 · Module B | [03-allocation.md](prd/03-allocation.md) | F6 SAA and CMA, F8 rebalancing, F7 frontier, F10 stress test 配置、再平衡、效率前緣、壓力測試 |
| 3 · Module C | [03-analysis.md](prd/03-analysis.md) | F11 CAPM, F12 valuation, N1 regression, N3 red flags, F14 look-through, N7 sectors 證券分析 |
| 3 · Module F | [03-volatility.md](prd/03-volatility.md) | N8 volatility alert, events, breaking news 波動警報 |
| 3 · Module D | [03-cost-performance.md](prd/03-cost-performance.md) | F15 fee and tax drag, F18 performance, N2 attribution 成本與績效 |
| 3 · Module E | [03-dashboard-entry.md](prd/03-dashboard-entry.md) | N5 holdings entry and CSV import, N4 VaR, N6 donuts, dividends 登錄與視覺化 |
| 4 | [04-rules-push.md](prd/04-rules-push.md) | Rules engine, L2 warning flow, push rules, noise controls 規則引擎與推播 |
| 5 | [05-weekly-review.md](prd/05-weekly-review.md) | Weekly push, the dashboard, navigation, in-app banner, holding signals 每週檢視與導覽 |
| 5 · Phone redesign | [05-phone-redesign.md](prd/05-phone-redesign.md) | Phone layout, holdings overview, charts, glass tab bar, opening screen, preloading, iOS shell, widget, appearance 手機改版與 iOS 外殼 |
| 6 | [06-architecture.md](prd/06-architecture.md) | Architecture and free data sources 架構與資料來源 |
| 7 | [07-data-model.md](prd/07-data-model.md) | Tables 資料表 |
| 9 | [09-risks.md](prd/09-risks.md) | Risks, limitations, open questions 風險與待決問題 |
| 10 | [10-glossary.md](prd/10-glossary.md) | Bilingual glossary 雙語術語表 |
| 11 | [11-acceptance-tests.md](prd/11-acceptance-tests.md) | Acceptance tests: each model's unit-test values 驗收測試 |
| — | [decisions.md](prd/decisions.md) | Decisions by build step and the phases' build orders (history) 各步驟決策與建置順序 |

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
2. **Decisions, not prices 推播決策而非價格** — No real-time price alerts; every push names a rule that fired and the action it proposes. One exception, asked for by Hugo on 2026-11-06: N8's volatility alert pushes when a market-stress score crosses its threshold, still as a rule with a proposal. 不推播即時股價；每則推播都要指出觸發的規則與建議的動作。唯一例外（Hugo 於 2026-11-06 提出）：N8 波動警報在市場壓力分數穿越門檻時推播，仍以規則與提案的形式呈現。 A second exception, asked for by Hugo on 2026-11-12: on the day a holding's dividend is paid, one push asks whether to record it (N5, dividend prompts); it proposes no trade. 第二個例外（Hugo 於 2026-11-12 提出）：持股配息發放當天推播一次，詢問是否登錄股利（N5 配息詢問），不附任何交易建議。
3. **Human in the loop (L2) 人在迴路中** — The app drafts order lists; Hugo confirms and places every trade manually at the broker. No broker API access. 由 App 產生建議下單清單，Hugo 確認後到券商手動下單；不串接券商 API。
4. **Explain every number 每個數字都可解釋** — Each model shows its formula, inputs and assumptions, in English and Chinese, one tap away: the explanation sits folded behind ⓘ. 每個模型都以中英雙語顯示公式、輸入值與假設，點一下 ⓘ 即可展開。
5. **Free data only 只用免費資料** — All phases run on free data sources; paid upgrades stay an open question. 所有階段都只使用免費資料；是否升級付費資料列為待決問題。
6. **Figures, not paragraphs 數字優先，少用段落** — A page shows labelled figures as tiles with a status icon (✓ on track, ! watch, ✕ act, … waiting) and short lines; sentences that explain go behind ⓘ, edit histories fold under their heading. 頁面以「標籤＋數字＋狀態圖示」的小卡呈現（✓ 正常、! 注意、✕ 需處理、… 等待中），只留短句；說明文字收進 ⓘ，修改紀錄收合在標題下。 Since 2026-11-07 it is also a rule in CLAUDE.md: a new or changed page shows about a fifth of the text a paragraph-style page would, settings and long lists folded, checked with the e2e TEXT_REPORT. 2026-11-07 起也列為 CLAUDE.md 的規則：新增或修改的頁面，文字量約為段落式頁面的五分之一，設定與長清單收合，並以端對端 TEXT_REPORT 檢查。
7. **Chinese first 中文為主** (asked by Hugo on 2026-11-09) — Names stay bilingual (a field, a column, a figure's label, a button, a link: "Regular pool 一般投入資金池"); sentences, notes, messages, lines carrying figures and push texts show in Traditional Chinese alone. Warnings are small alert tiles (status icon, rule code, name, the figure, a gauge against the limit, two or three short chips), never a sentence per warning. 名稱維持中英並列（欄位、表頭、數字標籤、按鈕、連結，例如「Regular pool 一般投入資金池」）；句子、附註、訊息、含數字的說明與推播只顯示繁體中文。警示一律以小卡呈現（狀態圖示、規則代號、名稱、數字、對照上限的量條與兩三個短標籤），不再一則警示一句話。 On a phone (under 760px wide) a name shows Chinese alone as well (Hugo, 2026-11-10): two languages side by side wrapped the buttons and cut the table headers. 手機上（寬度 760px 以下）名稱也只顯示中文（Hugo，2026-11-10）：中英並列會讓按鈕換行、表頭被切。

**Non-goals 非目標:** day trading, automatic order execution, multi-user or commercial use, real-time quote streaming. N8's short-term trades are held days to weeks and scored twice a day on closes, not intraday. 不做當沖、不自動下單、不支援多人或商業使用、不提供即時報價串流。N8 的短線部位持有數天到數週，每天以收盤資料計分兩次，不做盤中交易。

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

Twenty features ship across three phases; IDs keep the numbering from the original 20-feature list, and N1–N7 are new (N7 added during Phase 2). N8 was added after Phase 3, on 2026-11-06. 共 20 個功能，分三個階段上線；編號沿用原本 20 項清單，N1–N7 為新增功能（N7 於第二階段加入）。N8 於第三階段後（2026-11-06）加入。

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
| N8 | Volatility alert: stress score 1–10, event calendar, band proposals 波動警報：壓力分數 1–10、事件日曆、分區段提案 | F Short-term | After 3 第三階段後 | Scored twice a day; push on crossing 每天計分兩次，穿越門檻時推播 |
| F1 | 30-year life timeline (tab) 30 年人生財務時間軸（分頁） | A Planning | 3 | Weekly overlay of actuals 每週疊加實際值 |
| F5 | Monte Carlo simulation (shares F2 engine) 蒙地卡羅模擬（與 F2 共用引擎） | A Planning | 3 | Monthly re-run 每月重跑 |
| F7 | Efficient frontier & CML (reference only) 效率前緣與資本市場線（僅供參考） | B Allocation | 3 | On demand 手動執行 |
| F10 | Stress test & scenario replay 壓力測試與情境回放 | B Allocation | 3 | On demand 手動執行 |
| N2 | Brinson attribution (2 levels, FX split) Brinson 績效歸因 | D Cost | 3 | Monthly 每月 |

Three dropped features live on inside others: the US estate-tax check sits in F15, currency effects sit in F18 and N2, the IPS becomes the rules engine in Section 4, and F13 is merged into N1's Regression Lab. 三項刪除的功能併入其他功能：美國遺產稅檢查併入 F15，匯率效果併入 F18 與 N2，IPS 成為第 4 節的規則引擎；F13 併入 N1 回歸分析區。

## 8. Roadmap 開發路線圖

All three phases are built and their gates passed (Phase 3's on 2026-10-29); N8, the phone redesign, the iOS shell and the Ink design followed. The build orders are in [decisions.md](prd/decisions.md). 三個階段皆已完成並通過關卡（第三階段於 2026-10-29）；之後加入 N8、手機改版、iOS 外殼與 Ink 設計。建置順序見 [decisions.md](prd/decisions.md)。
