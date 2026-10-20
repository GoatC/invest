# 資料來源檢查 Data source check

第一階段第 1 步（PRD 第 11 節）：`scripts/check_sources.ts` 會把 PRD 第 6 節列出的每個免費資料來源各呼叫一次，記錄流量限制（rate limit）、存一份樣本資料，並列出「投資原則」表格中每個標的（VOO、VT、00692、009816、00922、BNDW、AGGU、GLDM、BIL、實體黃金）分別由哪些來源提供。它也會回答 PRD 的待決問題：倫敦掛牌的 AGGU 有沒有免費的價格來源。

Phase 1, step 1: the script calls each PRD Section 6 source once, records its limits and a sample payload, and reports which Investment Principles tickers each source covers, including AGGU.

## 一次性準備 One-time setup

**1. 安裝 Node.js（20.12 以上，建議 22 LTS）。** Node.js 是執行這支程式的引擎。到 <https://nodejs.org/> 下載 LTS 版安裝。裝好後在「終端機」輸入下面指令，看到 `v22...` 之類的版本號就代表成功：

```bash
node --version
```

**2. 下載專案並安裝工具。** `git clone` 會把 GitHub 上的專案複製到你的電腦；`npm install` 會依照 `package.json` 下載這支程式需要的四個小工具（只裝在專案資料夾內的 `node_modules/`，不影響電腦其他地方，也不會上傳）。

```bash
git clone https://github.com/GoatC/Invest.git
cd Invest
git checkout claude/exciting-clarke-ud732l   # 合併到 main 之前，程式在這個分支
npm install
```

**3. 申請免費金鑰（API key）。** 金鑰就像各網站發給你的「通行證」。全部免費；沒填的那一項只會略過需要它的檢查，其餘照常執行。

| 變數 Variable | 用途 | 申請方式 |
| --- | --- | --- |
| `ALPHAVANTAGE_API_KEY` | 美股價格（主要來源），也用來測 AGGU.LON | <https://www.alphavantage.co/support/#api-key> 填 email 即可取得 |
| `FINMIND_TOKEN` | 台股價格與財報；有 token 時額度較高 | 在 <https://finmindtrade.com/> 註冊登入，到使用者資訊頁複製 token |
| `FRED_API_KEY` | 美國利率與匯率（選填；沒有也能用免金鑰下載） | <https://fred.stlouisfed.org/docs/api/api_key.html> |
| `MOENV_API_KEY` | 環境部裁罰資料（N3 紅旗用） | 在 <https://data.moenv.gov.tw/> 免費註冊會員後取得 |
| `FMP_API_KEY` | 選填，只用來測 AGGU | <https://site.financialmodelingprep.com/> |
| `SEC_USER_AGENT` | 不是金鑰：SEC 要求程式註明身分與聯絡 email | 直接填 `LongViewInvest 你的email` |

**4. 建立 `.env.local`，把金鑰放進去。** `.env.local` 是只存在你電腦上的設定檔，已被 `.gitignore` 排除，**永遠不會上傳到 GitHub**（這個 repo 是公開的）。先複製範本，再用文字編輯器打開填值：

```bash
cp .env.example .env.local
```

## 執行 Run

```bash
npm run check:sources
```

大約 1 分鐘。每個來源只呼叫一次、失敗也不重試，所以不會浪費額度；Alpha Vantage 最多用掉每日 25 次中的 4 次。

- 報告：`reports/source-check/report.md`（可讀版）與 `report.json`（機器可讀版）
- 原始樣本：`reports/source-check/samples/`（只留在本機，不會上傳）
- 只重跑某個來源（例如補上金鑰後）：`npm run check:sources -- --only=alphavantage`；其他來源保留上一次的結果。
- 來源代號 Source ids: `twse, finmind, mops, sec, alphavantage, fmp, fred, cbc, shiller, french, damodaran, twse_cg, echo, moenv, issuers, bot_gold`

## 看報告 Reading the report

- ✅ 有涵蓋 · ❌ 找不到 · — 不適用 · ⏭️ 未設金鑰而略過 · ⚠️ 呼叫失敗 · · 本次未檢查
- 「Summary」列出每個來源的狀態、請求數、官方限制與實測到的流量標頭。
- 「Ticker coverage」是標的 × 來源的對照表。
- 「AGGU price source」直接給出 AGGU 價格來源的結論。
- 「Market-level series」列出利率、匯率、CAPE、ERP、因子、金價的最新日期，用來看資料新不新。

報告不含金鑰（網址中的金鑰顯示為 `***`）、不含持股或大額資金數字，可以安心 commit 或貼給 Claude 看。

The report never contains key values (URLs show `apikey=***`), holdings or windfall figures, so it is safe to commit or share.
