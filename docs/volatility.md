# 波動警報 Volatility alert (N8)

每個平日自動計算一次「市場壓力分數」（1 = 平靜，10 = 恐慌），存進 Supabase，並在 App 的「波動警報」頁顯示今天的分數、近一年走勢與每個成分。這是 N8 的第一步；事件日曆（第二步）與超過門檻時的推播和進場建議（第三步）之後加入。

On weekdays, GitHub Actions scores market stress from 1 (calm) to 10 (panic), saves it in Supabase and shows it on the Volatility page with the last year's line and each component. This is N8's first step; the event calendar (step 2) and the alert with its proposals (step 3) follow.

## 它怎麼運作 How it works

- **時間**：平日每天兩次，在 GitHub Actions 執行（`.github/workflows/volatility.yml`、`scripts/volatility.ts`），公開 repo 免費。
  - 台北時間 **15:17**：台股收盤、臺指 VIX（13:45）已公布。
  - 台北時間 **06:17**：CBOE 已公布前一個美股交易日的 VIX。
- **資料**（全部免費，存入 `index_prices`）：

| 成分 Component | 來源 Source | 備援 Fallback |
| --- | --- | --- |
| VIX、VIX3M | CBOE 每日歷史檔 | FRED VIXCLS、VXVCLS |
| 臺指選擇權波動率指數 TWVIX | 期交所每月檔（只有最近三個月，App 自己累積歷史） | — |
| 美國每日政策不確定性 EPU（新聞） | policyuncertainty.com | FRED USEPUINDXD |
| 美國高收益債利差 HY_OAS | FRED BAMLH0A0HYM2 | —（失敗時少計一個成分） |
| 標普 500、加權報酬指數 | FinMind（與每夜排程相同） | FRED、證交所 |

- **計分**：每個成分在「平靜值」以下得 0 分、「恐慌值」以上得 10 分，中間依直線換算；總分 = 1 ＋ 0.9 × 加權平均。超過 5 天的數值不計入；涵蓋權重低於 50% 時不計分，當次執行記為失敗。所有數值都在「波動警報」頁的設定中，可以修改並留下紀錄。
- **紀錄**：每次執行記在 `job_runs`（工作名稱 `volatility`），分數存在 `volatility_scores`（每天一列，第二次執行會更新）。這個排程失敗**不會**觸發「資料異常」推播，那只看每夜排程。
- **公開紀錄**：GitHub Actions 的紀錄只有市場數據與分數，沒有任何持股或金額。

## 設定步驟 Setup

只要做一次。不需要新的金鑰：沿用每夜排程已設好的 `SUPABASE_URL`、`SUPABASE_SECRET_KEY` 與 `FINMIND_TOKEN` 三個 GitHub secrets。

1. **合併 pull request**：在 GitHub 合併這次的 PR。合併後排程就會自動開始（下一個 15:17 或 06:17）。
2. **更新資料庫**：在你電腦上的 repo 資料夾執行下面的指令，把新的資料表 `volatility_scores` 與設定 `volatility` 加進 Supabase。這和之前每次加新功能時的步驟一樣。

   ```bash
   git pull
   ```

   ```bash
   npx supabase db push
   ```

3. **（可選）立刻跑一次**：到 GitHub repo 的 **Actions** 分頁 → 左邊選 **Volatility 波動警報** → 右邊 **Run workflow**。約 1 分鐘後打開 App 的「分析區 → 波動警報」，就會看到今天的分數。
4. **確認數值**：資料累積幾個月後，回到「波動警報」頁檢查各成分的平靜值與恐慌值，尤其是臺指 VIX 與政策不確定性指數；確認後勾選「今天已確認數值」並儲存。

## 疑難排解 Troubleshooting

- **頁面顯示「近期數值不足」**：排程還沒跑過，或最近一次失敗。到 Actions 分頁看 Volatility 的紀錄；資料狀態寫在紀錄最後幾行。
- **臺指 VIX 顯示「無資料」**：期交所網站暫時連不上，下一次執行會再試；它只提供最近三個月，所以排程停超過三個月會留下缺口。
- **排程停了**：公開 repo 連續 60 天沒有活動時，GitHub 會暫停排程。到 Actions 分頁的 Volatility 按 **Enable workflow** 重新啟用。

本頁只呈現市場數據，不構成投資建議。This page shows market data only; it is not advice.
