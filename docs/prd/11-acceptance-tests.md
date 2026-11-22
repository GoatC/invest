[PRD](../PRD.md) › Section 11

# 11. Acceptance tests 驗收測試

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
| F12 forward P/E (added 2026-11-04) | Today 2026-05-26 (FY1 ends 2026-12-31, 219 days: w 0.6); FY1 EPS 7.0 (30 days ago 6.9), FY2 8.0 (7.9); price 148, TTM EPS 6, own median P/E 25 | NTM EPS 7.4 (7.3 thirty days ago); trailing P/E 24.67, forward 20.0; growth 23.3%, PEG 0.857; 20% below the own median, price at it 185; revisions +1.37%; score +3: leans cheap |
| F12 forward P/E, rich | The same at price 300, each year's mean 5% lower 30 days ago | Forward P/E 40.5, +62% on the own median; PEG 1.74 (neutral); revisions down; score −2: leans expensive |
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
| N5 leverage (added 2026-11-05) | Buy 10 at 100, fee 2, 2.5× | Own money 10 × 100 ÷ 2.5 + 2 = 402; at 110 own money 500; at 60 (a 40% fall, 1 ÷ 2.5) 0; at 59 −10 |
| N5 leveraged sell | Buy 10 at 100, 2×, FX 30; sell 5 at 120 | Half of the 500 own money released plus 5 × 20 gained: gain NT$3,000; 5 left on 250 own money |
| N5 short | Sell short 4 at 50, fee 1; buy to cover 4 at 40, fee 1; FX 32 | Proceeds 199, covered for 161: gain 38 USD = NT$1,216; open at 4 × 50 with no fee, own money 160 at 60 and 240 at 40 |
| N5 R1 on exposure | 0050 NT$200,000; 2330 NT$10,000 of own money at 3× | Pool NT$210,000; 2330 weighs 30,000 ÷ 210,000 = 14.3% for R1 (own money only 4.8%): breach of 5% |
| N5 class weight | Short 100 of 0050 at 100, now 90 | Exposure −NT$9,000; own money 10,000 + 1,000 = NT$11,000; class weight −9,000 ÷ 11,000 |
| N5 performance | Short 10 at 100, close 90; 2× long 10 at 100, close 105 | Short: NT$1,000 put in, worth 1,100, return +10%; 2× long: NT$500 put in, return +10% |
| N5 VaR exposure | VT long 300, VT short own 100 exposure −100; AAPL own 50 at 3× | V = 450 of own money; VT proxy 200, VOO proxy 150 |
| F10 leveraged replay | Own money 100, exposure −200 (a 2× short); its series −10% | End value 120 |
| F10 what-if, 2× long | Margin 100; series −20%, −40%, +50%; margin call at 30% | 60, then −4: margin call and wiped out in month 2; frozen at −4 after (worst −4% of the margin) |
| F10 what-if, short | 1× short, margin 100; series −50%, +100% | 150 (exposure −50), then 100; never called or wiped |
| F10 what-if, portfolio | Portfolio 1,000 → 800; position 100 → 300, or 100 → 0 | Deepest fall 0; or 300 ÷ 1,100 = 27.27% (NT$300) |
| F7 leverage | Mix 8% at 12% volatility, Rf 2%, spread 1% | 2×: 2% + 2 × 6% − 1% = 13% at 24%; 0.5×: 5% at 6% |
| F7 shorts | Three classes, shorts allowed to 30% each | Lower bounds −30%; the best Sharpe never below long-only; weights sum to 1; gross exposure ≥ 1 |
| N1 position β | β 1.2, α 2% a year; NT$100,000 own money; index −10% | Long 2×: β 2.4, α 4%, own money −24%, hedge: short NT$240,000 of the index; short 1.5×: β −1.8, own money +18%, hedge: buy NT$180,000 |
| N8 sub-score (added 2026-11-06) | Calm 12, panic 40; VIX 26, 50, 10 | 5.0, 10 (capped), 0 |
| N8 term structure | VIX 28.18, VIX3M 25.55 (2026-11-05); calm 0.85, panic 1.15 | Ratio 1.1029; sub-score 8.43 |
| N8 score | Sub-scores 10 (weight 2), 0 (weight 2), 5 (weight 1) | Mean 5; score 1 + 0.9 × 5 = 5.5; all calm 1.0, all at panic 10.0 |
| N8 drawdown | 200 more than a year ago, then 100, a high of 120, now 90 | 25% (the older 200 not counted); sub-score 10 on 3% / 25% |
| N8 short fall | 100, 99, 98, 97, 95, 90 | 10% over 5 sessions: sub-score 10 on 0 / 10%; a rise reads 0 |
| N8 coverage | Taiwan's VIX missing (weight 2 of 10.5); then the spread 6 days old | 8.5 ÷ 10.5 = 80.95%, the rest re-weighted; then 7.5 ÷ 10.5 (stale); the VIX alone (19%) gives no score under 50% |
| N8 policy index | Two days of 100, then a week of 400; six days of 100, then 700 | 7-day mean 400; 185.7 |
| N8 FOMC time (step 2) | Decision 14:00 New York on 2026-12-09 (standard time); on 2026-06-17 (daylight time) | 2026-12-10 03:00 Taipei; 2026-06-18 02:00 |
| N8 CPI time | 7:30 am Central on 2026-11-10; on 2026-10-14 | 21:30 Taipei the same day; 20:30 |
| N8 reminder | An event on 2026-12-10, lead 2 days | Due on 12-08 (or 12-09 if missed), once; not on 12-07 nor on the day |
| N8 run (step 3) | Scores 4.9, 6.3, 5.6, 6.4; tense 6, reset gap 1 | One tense run since the 6.3; with 4.8 in place of 5.6, since the 6.4 |
| N8 tense | Pool NT$200,000 (BIL NT$17,000, satellite 15%); AAPL value 140, NVDA 130, MSFT 120 at price 100, buy multiple 0.75 | Budget 2% = NT$4,000: sell 40 BIL, buy 20 AAPL (−4.8% to 105) and 20 NVDA (+2.6% to 97.5); MSFT (+11.1%) left out |
| N8 panic | The same pool with NT$2,000 of 00677U; score 8.4 | Sell 20 00677U and 100 BIL (5% = NT$10,000); NT$12,000 by targets 28 : 12 → 84 VT, 36 00692 |
| N8 hedge | Score 3.2, no VIX product held | 1% = NT$2,000: sell 20 BIL, buy 20 00677U; none with NT$2,000 held; no order with the satellite at 20% |
| N8 shadow return | Buy NT$8,400 VT at 100 and NT$3,600 00692 at 50, sell NT$2,000 00677U at 20; after 5 sessions 110, 45, 15 | (840 − 360 + 500) ÷ 14,000 = +7.0%; the BIL funding sale left out |
| N8 hit rate | Returns +7%, −2%, pending | 2 measured, 50%, mean +2.5% |
| N8 news spike (step 4) | Usual count 5 (median of 24 saved runs); min_sources 10, spike 3 | 15 needed: 12 outlets do not alert, 16 do |
| N8 news warm-up | Fewer than 24 runs saved | 3 × 10 = 30 needed: 28 do not alert, 56 do |
| N8 news cooldown | Last alert 11 hours ago, then 13 hours ago; cooldown 12 h | Held back; then alerts again |
| F6 auto premium (added 2026-11-09) | US / global equity assumption 6.5%, US 10-year 4.0%; β 1.2, then 1 | Premium 2.5%; 4.0% + 1.2 × 2.5% = 7.0%; β 1 gives 6.5%, the anchor's own |
| F6 auto fallback | No Taiwan market-cap assumption; Taiwan 10-year 1.8%, ERP 5.0% + CRP 0.78%; β 0.8 | 1.8% + 0.8 × 5.78% = 6.424% |
| F6 auto class | NT$30,000 at 7.0% and NT$10,000 at 6.424%; ±3% and ∓3% a month for 36 months | 0.75 × 7.0% + 0.25 × 6.424% = 6.856%; volatility 0.03 × √(36 ÷ 35) × √12 = 10.54% alone, the mix (±1.5%) 5.27% |
| F6 auto best fit | A Taiwan-listed fund: R² 0.55 on the S&P 500, 0.20 on TAIEX | Reads the S&P 500's market line |
| F6 auto basket | A 75% weight returning 2%, 4%, −2%; a 25% weight from month 2, 8%, 2% | 2%, 5%, −1% (month 1 the first line alone) |
| N5 cash-flow book (added 2026-11-12) | Buy 2 VT at US$150, fee US$1, at 31.80 | (300 + 1) × 31.80 = NT$9,571.80 put in, counted from the trade alone |
| N5 book, sell | 100 at NT$88 + NT$20; 20 sold at NT$92, fee NT$20, tax NT$1.84 | Bought NT$8,820, sold NT$1,818.16, net put in NT$7,001.84 |
| N5 book, leverage and short | 2× long of 10 at 100, fee 5, FX 30; 2× short of 10 at 100, fee 5 | Long counts 505 × 30 = NT$15,150; short counts its margin 500 × 30 = NT$15,000 |
| N5 book, windfall | NT$400,000 arrived; a windfall-pool buy of 10 at US$100 at 32 | Deployed NT$32,000 (8%), NT$368,000 waiting; the regular pool's net put in unchanged |
| N5 book, old contribution | A contribution of NT$10,000 typed in beside the buy it paid for | Listed, not added |
| N5 dividend | 100 shares of 0050 bought before the ex-dividend date 2026-07-21; NT$0.60 a share, paid 2026-08-10 | Asked from 2026-08-10 (not on 08-09), NT$60; bought on the ex-date: not asked; asked until 2026-10-09 (60 days) |
| N5 dividend, US | 2 VT, US$0.4084 a share, 30% withheld, USD at 32 | US$0.57, NT$18.24 |
| N5 dividend, no payment date | VT ex-dividend 2026-09-18, lag 7 days | Asked from 2026-09-25, marked as an estimate |
| N5 dividend answered | A dividend cash flow of the same security and pool dated 2026-07-21 to 2026-09-09 (30 days after the payment) | Not asked; one dated 2026-09-10, of another pool or of another security answers nothing; one flow answers one dividend |
| N5 dividend off the closes | VT 2026-09-17 close 159.22, adjusted 158.81; 2026-09-18 close and adjusted 158.55 | Ex-dividend 2026-09-18, 159.22 × (1 − 158.81 ÷ 159.22) = US$0.41 (paid: 0.4084) |
| Banner (added 2026-11-12) | One dividend due, a standing warning, no device with push | Dividend, then warning, then push; the dividend closed with ✕ until 2026-11-19 is hidden on 11-18 and back on 11-19; another dividend shows at once |
| Standing warning (added 2026-11-12) | R1 fires on AAPL; a warning stands from 2026-10-01; rules checked on 2026-10-21 | No new draft, nothing closed: it stays open (no time-out); dismissed, the same state waits out `cooldown_days` |
| Banner, windfall | NT$5.5M arrived, no TWD balance; then a balance; then a plan | "Add its balance"; "no tranche plan"; nothing |
| Banner, stale balance | Balances valued 45 and 103 days ago, threshold 45 | Only the 103-day one is asked about |
| Dashboard line (added 2026-11-13) | 1 share at 100 (fee 1), +20% to 120; 9 more at 120 in the windfall pool; then −10% over the last week | The line reads +20% before and after the buy and ends at 1.2 × 0.9 − 1 = +8.0%; gain since the start −NT$101 (1,181 in, 1,080 left); last seven days −NT$120, −10% |
| Dashboard line, drawing | Returns 0, +10%, −10% in a box 200 × 100, 10 clear above and below | Starts at the left edge at 50, peaks at 10 in the middle, ends at the right edge at 90; the zero line at 50; flat at a peak |
| Widget figures (added 2026-11-18) | The dashboard line's case: 1 at 100 (fee 1), 9 more at 120 on 04-01 (windfall), worth 1,200 at the close of 06-24, 1,080 on 07-01 | As of 07-01: NT$1,080, 7 days −10.00% (the poster's figure), at most 40 points from 0 to +8.00% |
| Widget stale | A Friday close on 2026-11-13, stale after 3 days; a close on 2027-02-05 | Fresh on Monday 11-16, stale on Tuesday 11-17; stale on 2027-02-10 |
