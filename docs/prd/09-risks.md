[PRD](../PRD.md) › Section 9

# 9. Risks, Limitations & Open Questions 風險、限制與待決問題

The largest design risk is windfall acceleration, which may commit most of the cash before a drawdown bottoms. 最大的設計風險是大額資金加速投入：可能在跌勢見底前就投入大部分資金。

| Risk 風險 | Why it matters 影響 | Mitigation 對策 |
| --- | --- | --- |
| Acceleration risk 加速投入風險 | Markets can keep falling after a tier fires, leaving little cash for the bottom 觸發後市場可能續跌，谷底時剩餘資金不多 | Tiers spaced 10 points apart; F3 backtest compares acceleration with a fixed pace 級距間隔 10 個百分點；F3 回測比較加速與固定節奏 |
| Free data breaks 免費資料中斷 | Rate limits and unofficial endpoints can change without notice 流量限制與非官方介面可能隨時變動 | Nightly batch with cache; failure push after two misses; one fallback source per data type 夜間批次加快取、連續失敗兩次即推播、每類資料備援一個來源 |
| Partial ESG coverage ESG 覆蓋不完整 | No free full ESG scores 沒有免費的完整 ESG 評分 | Show coverage % beside each light 燈號旁顯示覆蓋率 |
| Model risk 模型風險 | CAPM, DCF and mean–variance outputs are only as good as their inputs CAPM、DCF、均值–變異數的結果取決於輸入品質 | Show inputs beside every output; weight bounds in F7; scenario ranges in F12 每個輸出旁顯示輸入、F7 設權重上下限、F12 用情境區間 |
| Tax rules change 稅法變動 | Thresholds in F15 may go stale F15 的門檻可能過時 | Stored as config with a "last verified" date 存為設定並標示最後確認日期 |
| iPhone push 手機推播 | Web Push on iOS works only after Add to Home Screen iOS 需先加入主畫面才能收推播 | Install step in the setup checklist 列入安裝檢查清單 |
| iOS shell 原生外殼 (2026-11-14) | Free signing lasts 7 days; no push reaches it; built where no Xcode can run it 免費簽署 7 天到期；收不到推播；在沒有 Xcode 的環境撰寫 | Install over the app weekly with one command, ios/install.sh (docs/ios-app.md); the web app stays for pushes; GitHub Actions builds every change 每週覆蓋安裝；PWA 保留收推播；GitHub Actions 每次變更都編譯 |
| Data privacy 資料隱私 | Holdings and windfall data are sensitive 持股與大額資金資料屬敏感資訊 | Single-user login, row-level security, no broker credentials stored 單人登入、資料列層級權限、不儲存券商帳密 |
| Supabase auto-pause 免費專案暫停 | A Free project with little activity for 7 days is paused 免費專案 7 天低活動會被暫停 | The nightly GitHub Actions job reads and writes the database every night; data-failure alert if it stops 每夜由 GitHub Actions 排程讀寫資料庫；中斷即警示 |
| Schedule switched off 排程被暫停 | GitHub turns off the schedule of a public repo after 60 days without activity GitHub 會暫停 60 天無活動的公開 repo 排程 | Missed nights count toward the data-failure alert; re-enable in the Actions tab 未執行的夜晚計入資料異常警示；於 Actions 分頁重新啟用 |
| Minimum fees 最低手續費 | NT$10,000 split across 8 sleeves means very small 複委託 orders 每月 1 萬分到 8 個部位，單筆複委託金額過小 | F8 sends each month's cash to at most 2 classes; F15 compares minimum fees 每月最多投入 2 個類別；F15 比較低消 |
| Short-term trading 短線交易 (N8) | A score marks stress, not a bottom; VIX products decay while held 分數代表壓力而非底部；VIX 商品持有會流失價值 | Band proposals, 5% cap per VIX product, the satellite's money only, a shadow log of hit rates before real money 依區段提案、每檔 VIX 商品 5% 上限、只用衛星資金、先以影子紀錄觀察命中率 |
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
- [ ] (F6 auto, 2026-11-09) Satellite classes left blank are scored from their holdings with your core assumption as each market's premium (config `cma_auto.premium` cma); switch to F11's ERP on the assumptions page if you prefer the market's own premium, and type an assumption for any class you want to set yourself （F6 自動評分）未設定的衛星類別依持股評分，各市場溢酬取你的核心假設；若偏好市場本身的溢酬，可在「資本市場假設」頁改用 F11 風險溢酬，或直接為該類別輸入假設
- [ ] (N8, 2026-11-06) The calm and panic figures are starting values set against CBOE's history; check them on the Volatility page, Taiwan's VIX and the policy index especially, once a few months of closes are in （N8）平靜與恐慌值是依 CBOE 歷史設定的起始值；累積幾個月資料後，請在「波動警報」頁確認，尤其是臺指 VIX 與政策不確定性指數
- [ ] (Raised in Phase 3, step 5) N2's level 2 prices each sector with its Select Sector SPDR fund as a price return (no dividends) and reads about a year of closes; the benchmark's sector weights are the core equity fund's file of the day, not each month's. Longer, total-return sector series would sharpen it （第三階段第 5 步提出）N2 第二層以 Select Sector SPDR 基金的價格報酬（不含股息）衡量各產業，約讀取一年的收盤價；基準的產業權重取當天的核心股票基金檔，而非每個月的。更長、含息的產業資料會更精確
- [ ] (Dividend prompts, 2026-11-12) The estimate takes 30% off a US-domiciled security's dividend and nothing else (config `dividends.withholding`): brokers' fees on dividends, Taiwan's 2.11% supplementary premium on a payout of NT$20,000 or more and partial refunds of US withholding are left to the amount Hugo types. London-listed distributing funds have no free dividend feed, and Alpha Vantage's free key answers one request a second, so a night with several new US dividends may fill some payment dates a night later 配息估計只扣美國註冊標的的 30% 預扣稅；券商費用、二代健保補充保費與預扣稅退稅以實際入帳金額為準。倫敦掛牌配息型基金無免費來源；Alpha Vantage 免費金鑰每秒一次，同一晚有多筆新配息時，部分發放日可能隔夜才補上
- [ ] (In-app banner, 2026-11-12) The seven occasions and their order are a first set (config `banners.kinds`, `snooze_days` 7, `balance_stale_days` 45): add or drop some after a few weeks of use 橫幅的七種時機與順序為初版，使用幾週後再增減
- [x] Phase 3's gate: passed by Hugo on 2026-10-29, after merging the Phase 3 pull requests (#20, #21), applying the migrations and checking each Phase 3 page's numbers against his own money; the app is complete 第三階段的關卡：Hugo 於 2026-10-29 通過，已合併第三階段的 pull request（#20、#21）、套用 migration，並對照自己的資金檢查各頁數字；App 建置完成
