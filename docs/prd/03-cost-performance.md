[PRD](../PRD.md) › Section 3, Module D

# Module D — Cost & Performance 成本與績效

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
