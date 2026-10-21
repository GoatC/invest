# Data source check 資料來源檢查

PRD Phase 1, step 1: each PRD Section 6 source called once, with its limits, a sample payload and ticker coverage. 第一階段第 1 步：每個資料來源呼叫一次，記錄流量限制、樣本與標的覆蓋。

- Generated 產生時間: 2026-10-21 11:52:02 (Asia/Taipei)
- Runner 執行環境: local run 本機執行 · Node v22.22.0
- Requests 請求: 29 of 35 succeeded 成功
- Keys present 已設定的金鑰 (values never written 不寫出內容): `ALPHAVANTAGE_API_KEY` ✅ · `FINMIND_TOKEN` ✅ · `FRED_API_KEY` ❌ · `FMP_API_KEY` ❌ · `MOENV_API_KEY` ✅ · `SEC_USER_AGENT` ✅

Legend 圖例: ✅ covered 有涵蓋 · ❌ not found 找不到 · — not applicable 不適用 · ⏭️ skipped, key not set 略過（未設金鑰） · ⚠️ call failed, coverage unknown 呼叫失敗 · · not checked this run 本次未檢查

## Summary 摘要

| # | Source 來源 | Section 6 data 資料 | Status 狀態 | Requests 請求數 | Documented limit 官方限制 | Observed this run 本次實測 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | TWSE OpenAPI 證交所開放 API | Taiwan prices 台股價格 | ✅ ok | 1 | No published limit; no key 未公布限制，免金鑰 | no rate-limit headers 無流量標頭 |
| 2 | FinMind | Taiwan prices and financials; US prices (backup) 台股價格與財報；美股價格備援 | ✅ ok | 6 | 600 requests/hour with a token (PRD §6); 300/hour without (FinMind docs); HTTP 402 when used up | user_info: 0 of 600 requests used 已用／上限 |
| 3 | MOPS 公開資訊觀測站 | Taiwan filings and material information 台股財報與重大訊息 | ✅ ok | 3 | No published limit; no key 未公布限制，免金鑰 | no rate-limit headers 無流量標頭 |
| 4 | SEC EDGAR | US filings 美股財報與 8-K | ✅ ok | 2 | At most 10 requests/second; a User-Agent with contact details is required (SEC fair-access policy) 每秒最多 10 次，需註明聯絡方式 | no rate-limit headers 無流量標頭 |
| 5 | Alpha Vantage | US stock, ETF and index prices (primary) 美股、ETF 與指數價格（主要來源） | ❌ failed 失敗 | 4 | 25 requests/day on a free key (PRD §6); also commonly cited as 5/minute | Requests used this run 本次用量: 4 of the 25/day free quota; error: Alpha Vantage: JSON instead of CSV; error: Alpha Vantage: We have detected your API key as *** and our standard API rate limit is 25 requests per day. Please subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly remove all daily rate limits. |
| 6 | Financial Modeling Prep (FMP) | Optional price source from the §6 free-tier note; tested only for AGGU 選用來源，只測 AGGU | ⏭️ skipped 略過 | 0 | 250 requests/day on the free plan (PRD §6) | — |
| 7 | FRED (St. Louis Fed) | US rates, TWD/USD 美國利率與匯率 | ✅ ok | 2 | API: 120 requests/minute per key (commonly cited); keyless CSV download: no published limit | no rate-limit headers 無流量標頭 |
| 8 | Central Bank of the ROC 中央銀行 (data.gov.tw dataset 10840) | Taiwan 10-year government bond yield 台灣 10 年期公債殖利率 | ✅ ok | 2 | Open-data file updated monthly; no published limit 每月更新的開放資料，未公布限制 | no rate-limit headers 無流量標頭 |
| 9 | Robert Shiller online data (shillerdata.com) | US CAPE 週期調整本益比 | ✅ ok | 2 | Static spreadsheet; no published limit. Its link rotates, so it is read from the page each time 下載連結會變，每次從網頁讀取 | no rate-limit headers 無流量標頭 |
| 10 | Kenneth French Data Library | Factor returns 因子報酬 | ✅ ok | 1 | Static zip files; no published limit 靜態檔案，未公布限制 | no rate-limit headers 無流量標頭 |
| 11 | Damodaran Online | Equity risk premium 股票風險溢酬 | ✅ ok | 1 | Static pages; implied ERP updated monthly (PRD F11); no published limit | no rate-limit headers 無流量標頭 |
| 12 | TWSE corporate governance evaluation 公司治理評鑑 | Governance rating 公司治理評鑑 | ✅ ok | 1 | Published once a year; no published limit 每年公布一次 | no rate-limit headers 無流量標頭 |
| 13 | EPA ECHO | US environmental penalties 美國環境裁罰 | ✅ ok | 1 | No published limit; EPA may throttle heavy use 未公布限制 | no rate-limit headers 無流量標頭 |
| 14 | Ministry of Environment open data 環境部 (ems_p_46) | Taiwan environmental penalties 台灣環境裁罰 | ✅ ok | 1 | Free member API key required; no limit stated in the docs found 需免費會員金鑰 | no rate-limit headers 無流量標頭 |
| 15 | ETF issuer holdings files ETF 發行商持股檔 | ETF holdings ETF 成分股 | 🟡 partial 部分 | 7 | Public website downloads; no published limits 官網公開下載，未公布限制 | error: HTTP 403 Forbidden |
| 16 | Bank of Taiwan gold price 臺灣銀行黃金牌價 | Gold price in TWD 台幣金價 | ❌ failed 失敗 | 1 | Public web page; no published limit 公開網頁，未公布限制 | error: bot challenge page instead of prices: the site asks for a browser to solve a challenge |

## Ticker coverage 標的覆蓋

### Investment Principles tickers 投資原則標的

| Ticker 標的 | Role 角色 | Market 市場 | TWSE | FinMind | Alpha Vantage | FMP | Issuer file | BoT gold |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **VOO** | Core · US / global equity 美股／全球大盤 28% | US | — | ✅ | ⚠️ | — | ✅ | — |
| **VT** | Core · US / global equity 美股／全球大盤 28% | US | — | ✅ | ⚠️ | — | ✅ | — |
| **00692** | Core · Taiwan market-cap equity 台股市值型 12% | TW | ✅ | ✅ | — | — | · | — |
| **009816** | Core · Taiwan market-cap equity 台股市值型 12% | TW | ✅ | ✅ | — | — | · | — |
| **00922** | Core · Taiwan market-cap equity 台股市值型 12% | TW | ✅ | ✅ | — | — | ⚠️ | — |
| **BNDW** | Core · Global bonds 全球債券 22% | US | — | ✅ | ⚠️ | — | ✅ | — |
| **AGGU (LSE)** | Core · Global bonds 全球債券 22% | UK | — | ❌ | ❌ | ⏭️ | ✅ | — |
| **GLDM** | Core · Real assets 實體資產 10% | US | — | ✅ | ⚠️ | — | — | — |
| **Physical gold 實體黃金** | Core · Real assets 實體資產 10% | unlisted | — | — | — | — | — | ⚠️ |
| **BIL** | Core · Strategic cash 戰略現金 8% | US | — | ✅ | ⚠️ | — | ✅ | — |
| **MMF 貨幣基金** | Core · Strategic cash 戰略現金 8% | unlisted | — | — | — | — | — | — |
| **High-yield savings 高利活存** | Core · Strategic cash 戰略現金 8% | unlisted | — | — | — | — | — | — |

MMF and high-yield savings are entered as balances on the N5 page and need no market feed; physical gold is valued with the Bank of Taiwan gold price. 貨幣基金與高利活存在 N5 以餘額登錄，不需要行情資料；實體黃金以臺灣銀行金價估值。

### Proxies and examples the models need 模型需要的代理指標與範例

| Ticker 標的 | Role 角色 | Market 市場 | TWSE | FinMind | MOPS | SEC | Alpha Vantage | TWSE CG | EPA ECHO | MOENV |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **0050** | N4 VaR proxy for both Taiwan classes 台股類別的風險值代理 | TW | ✅ | ✅ | — | — | — | — | — | — |
| **ACWI** | F3 drawdown gauge: candidate free proxy for MSCI ACWI 指數代理候選 | US | — | ✅ | — | — | ⚠️ | — | — | — |
| **AAPL** | Satellite stand-in (PRD N1 example) 衛星個股範例 | US | — | ✅ | — | ✅ | ⚠️ | — | ✅ | — |
| **2330** | Satellite stand-in (PRD N1 example) 衛星個股範例 | TW | ✅ | ✅ | ✅ | — | — | · | — | · |

The satellite sleeves name no tickers yet (US 2–3 names, Taiwan 1–2 names, tactical themes), so AAPL and 2330, the PRD N1 examples, stand in for single stocks. 衛星部位尚未指定個股，暫以 PRD N1 的範例 AAPL 與 2330 代表。

### Coverage details 覆蓋細節

- **VOO**: FinMind ✅ Vanguard S&P 500 ETF · Issuer file ✅ 500 holdings on the first page
- **VT**: FinMind ✅ Vanguard Total World Stock Index ETF · Issuer file ✅ 500 holdings on the first page
- **00692**: TWSE ✅ close 92.45 · FinMind ✅ twse · ETF · Issuer file · no verified machine-readable issuer file yet 尚無已確認的官方檔案
- **009816**: TWSE ✅ close 15.93 · FinMind ✅ twse · ETF · Issuer file · no verified machine-readable issuer file yet 尚無已確認的官方檔案
- **00922**: TWSE ✅ close 39.56 · FinMind ✅ twse · ETF
- **BNDW**: FinMind ✅ Vanguard Total World Bond ETF · Issuer file ✅ 500 holdings on the first page
- **AGGU (LSE)**: Alpha Vantage ❌ Alpha Vantage: We have detected your API key as *** and our standard API rate limit is 25 requests per day. Please subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly remove all daily rate limits. · Issuer file ✅ 19977 holdings as of 19/Oct/2026 (Holdings sheet, 20018 rows)
- **GLDM**: FinMind ✅ SPDR Gold MiniShares Trust · Issuer file — holds physical gold; nothing to look through
- **BIL**: FinMind ✅ State Street SPDR Bloomberg 1-3 Month T-Bill ETF · Issuer file ✅ xlsx sheet "holdings", 120 rows, As of 19-Oct-2026
- **0050**: TWSE ✅ close 107.25 · FinMind ✅ twse · ETF
- **ACWI**: FinMind ✅ iShares MSCI ACWI ETF
- **AAPL**: FinMind ✅ Apple Inc. Common Stock · SEC ✅ CIK 320193 · Nasdaq · EPA ECHO ✅ matched by facility name, not ticker: N3 needs a company-to-facility map
- **2330**: TWSE ✅ close 2405.00 · FinMind ✅ twse · 電子工業 · MOPS ✅ company profile 公司基本資料 · TWSE CG · tier lists are in the linked results PDF; read with N3 in Phase 2 · MOENV · records carry no ticker; N3 matches them by business ID 統一編號 in Phase 2

## AGGU price source AGGU 價格來源

- ❌ Alpha Vantage, AGGU.LON (PRD primary price source): Alpha Vantage: We have detected your API key as *** and our standard API rate limit is 25 requests per day. Please subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly remove all daily rate limits.
- ⏭️ Financial Modeling Prep, AGGU.L
- ❌ FinMind US list (backup source)
- ✅ iShares NAV history (issuer file): latest 2026-10-19, 5.76

**Verdict 結論:** no free market-price feed confirmed for AGGU yet; the issuer’s daily NAV history works as a fallback valuation. 尚未確認免費的 AGGU 市價來源；可先用 iShares 每日淨值估值。

## Market-level series 市場層級資料

| Series 資料序列 | Source 來源 | Latest date 最新日期 | Latest value 最新值 |
| --- | --- | --- | --- |
| US 10-year Treasury yield 美國 10 年期公債殖利率 (DGS10) | FRED | 2026-10-19 | 5.15 % |
| TWD per USD 新台幣兌美元 (DEXTAUS) | FRED | 2026-10-16 | 32.4000 TWD per USD |
| Taiwan 10-year government bond yield 台灣 10 年期公債殖利率 (十年期政府公債次級市場利率(%)) | CBC | 2026M08 | 1.95500 % |
| S&P 500 CAPE workbook (ie_data.xls) | Shiller | file modified Tue, 06 Oct 2026 14:33:57 GMT | CAPE column present; values are parsed with F3 in Phase 2 |
| Fama–French 5 factors, monthly 五因子（月） | French | 2026-08 | Mkt-RF 2.56, SMB -0.53, HML -3.54, RMW -4.08, CMA -2.01, RF 0.29 % per month |
| S&P 500 implied ERP (Damodaran, trailing 12 m, adjusted payout) 隱含股票風險溢酬 | Damodaran | October 1, 2026 | 4.20% |
| AGGU NAV per share (iShares) 每單位淨值 | Issuer file | 2026-10-19 | 5.76 USD |

## Source details 各來源細節

### 1. TWSE OpenAPI 證交所開放 API: ✅ ok

- Data 資料: Taiwan prices 台股價格
- Used by 使用功能: F12, N1, N3, F18
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: No published limit; no key 未公布限制，免金鑰
- Checked 檢查時間: 2026-10-21 10:52:19

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Daily quotes for every listed security (STOCK_DAY_ALL) | 200 | 1710 ms | 320.1 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` (Last-Modified: Tue, 20 Oct 2026 21:20:45 GMT)

Notes 備註:

- Trading date in the payload 資料日期: 2026-10-20 (raw "1151020")
- 1383 securities in one reply; fields: Date, Code, Name, TradeVolume, TradeValue, OpeningPrice, HighestPrice, LowestPrice, ClosingPrice, Change, Transaction
- One trading day per reply, no history: N4 needs 3 years of weekly returns, so history comes from FinMind or builds up nightly.

Sample 樣本: Rows for our Taiwan tickers 本專案的台股標的

```json
[
  {
    "Date": "1151020",
    "Code": "0050",
    "Name": "元大台灣50",
    "TradeVolume": "123086544",
    "TradeValue": "13246672426",
    "OpeningPrice": "107.65",
    "HighestPrice": "108.30",
    "LowestPrice": "107.05",
    "ClosingPrice": "107.25",
    "Change": "-0.9000",
    "Transaction": "274227"
  },
  {
    "Date": "1151020",
    "Code": "00692",
    "Name": "富邦公司治理",
    "TradeVolume": "511826",
    "TradeValue": "47566010",
    "OpeningPrice": "93.10",
    "HighestPrice": "93.60",
    "LowestPrice": "92.40",
    "ClosingPrice": "92.45",
    "Change": "-0.9500",
    "Transaction": "2009"
  },
  {
    "Date": "1151020",
    "Code": "00922",
    "Name": "國泰台灣領袖50",
    "TradeVolume": "12754702",
    "TradeValue": "507113370",
    "OpeningPrice": "39.90",
    "HighestPrice": "40.12",
    "LowestPrice": "39.50",
    "ClosingPrice": "39.56",
    "Change": "-0.5000",
    "Transaction": "14499"
  },
  {
    "Date": "1151020",
    "Code": "009816",
    "Name": "凱基台灣TOP50",
    "TradeVolume": "190979092",
    "TradeValue": "3053321008",
    "OpeningPrice": "16.00",
    "HighestPrice": "16.09",
    "LowestPrice": "15.91",
    "ClosingPrice": "15.93",
    "Change": "-0.1400",
    "Transaction": "81491"
  },
  {
    "Date": "1151020",
    "Code": "2330",
    "Name": "台積電",
    "TradeVolume": "22402430",
    "TradeValue": "53857463127",
    "OpeningPrice": "2400.00",
    "HighestPrice": "2415.00",
    "LowestPrice": "2395.00",
    "ClosingPrice": "2405.00",
    "Change": "-15
… (41 more characters)
```

### 2. FinMind: ✅ ok

- Data 資料: Taiwan prices and financials; US prices (backup) 台股價格與財報；美股價格備援
- Used by 使用功能: F12, N1, N3, F18; backup for US prices
- Auth 驗證: FINMIND_TOKEN (Authorization: Bearer)
- Documented limit 官方限制: 600 requests/hour with a token (PRD §6); 300/hour without (FinMind docs); HTTP 402 when used up
- Checked 檢查時間: 2026-10-21 11:38:36

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Quota for this token (user_info) | 200 | 974 ms | 681 B | — |
| 2 | Taiwan securities list (TaiwanStockInfo) | 200 | 1175 ms | 600.2 kB | — |
| 3 | Taiwan daily prices for 00922 (TaiwanStockPrice) | 200 | 215 ms | 1.7 kB | — |
| 4 | Taiwan income statements for 2330 (TaiwanStockFinancialStatements) | 200 | 212 ms | 11.1 kB | — |
| 5 | US securities list (USStockInfo) | 200 | 1751 ms | 3.7 MB | — |
| 6 | US daily prices for VT (USStockPrice) | 200 | 272 ms | 1.3 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://api.web.finmindtrade.com/v2/user_info`
2. `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo`
3. `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=00922&start_date=2026-10-07`
4. `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id=2330&start_date=2025-09-16`
5. `https://api.finmindtrade.com/api/v4/data?dataset=USStockInfo`
6. `https://api.finmindtrade.com/api/v4/data?dataset=USStockPrice&data_id=VT&start_date=2026-10-07`

Observed limits 實測限制:

- user_info: 0 of 600 requests used 已用／上限

Notes 備註:

- TaiwanStockInfo: 4345 rows
- USStockInfo: 19869 rows

Sample 樣本: TaiwanStockPrice 00922 since 2026-10-07: 9 rows, latest 2026-10-20

```json
[
  {
    "date": "2026-10-19",
    "stock_id": "00922",
    "Trading_Volume": 26613273,
    "Trading_money": 1056567591,
    "open": 39.95,
    "max": 40.08,
    "min": 39.51,
    "close": 40.06,
    "spread": 0,
    "Trading_turnover": 20691
  },
  {
    "date": "2026-10-20",
    "stock_id": "00922",
    "Trading_Volume": 12754702,
    "Trading_money": 507113370,
    "open": 39.9,
    "max": 40.12,
    "min": 39.5,
    "close": 39.56,
    "spread": -0.5,
    "Trading_turnover": 14499
  }
]
```

Sample 樣本: TaiwanStockFinancialStatements 2330: 68 rows for quarters 2025-09-30, 2025-12-31, 2026-03-31, 2026-06-30

```json
[
  {
    "date": "2025-09-30",
    "stock_id": "2330",
    "type": "EPS",
    "value": 17.44,
    "origin_name": "基本每股盈餘"
  },
  {
    "date": "2025-09-30",
    "stock_id": "2330",
    "type": "OTHNOE",
    "value": -93566000,
    "origin_name": "其他收益及費損淨額"
  },
  {
    "date": "2025-09-30",
    "stock_id": "2330",
    "type": "OtherComprehensiveIncome",
    "value": 95201936000,
    "origin_name": "其他綜合損益（淨額）"
  }
]
```

Sample 樣本: USStockPrice VT since 2026-10-07: 10 rows, latest 2026-10-20

```json
[
  {
    "date": "2026-10-19",
    "stock_id": "VT",
    "Adj_Close": 157.11,
    "Close": 157.11,
    "High": 157.98,
    "Low": 157.07,
    "Open": 157.5,
    "Volume": 2102400
  },
  {
    "date": "2026-10-20",
    "stock_id": "VT",
    "Adj_Close": 157.8,
    "Close": 157.8,
    "High": 158.4,
    "Low": 156.76,
    "Open": 156.85,
    "Volume": 2360278
  }
]
```

### 3. MOPS 公開資訊觀測站: ✅ ok

- Data 資料: Taiwan filings and material information 台股財報與重大訊息
- Used by 使用功能: F12, N3
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: No published limit; no key 未公布限制，免金鑰
- Checked 檢查時間: 2026-10-21 10:52:26

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | MOPS website (reachability) | 200 | 2460 ms | 942 B | — |
| 2 | Listed-company profiles from MOPS, via TWSE OpenAPI (t187ap03_L) | 200 | 1331 ms | 1.3 MB | — |
| 3 | Material information in the latest batch, via TWSE OpenAPI (t187ap04_L) | 200 | 123 ms | 198.8 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://mops.twse.com.tw/mops/` (Last-Modified: Wed, 30 Sep 2026 04:00:52 GMT)
2. `https://openapi.twse.com.tw/v1/opendata/t187ap03_L` (Last-Modified: Tue, 20 Oct 2026 21:24:36 GMT)
3. `https://openapi.twse.com.tw/v1/opendata/t187ap04_L` (Last-Modified: Tue, 20 Oct 2026 21:24:31 GMT)

Notes 備註:

- MOPS website answered; page title: 公開資訊觀測站
- t187ap03_L: 1097 companies; code field "公司代號"

Sample 樣本: t187ap04_L: 112 announcements

```json
[
  {
    "出表日期": "1151021",
    "發言日期": "1151020",
    "發言時間": "70004",
    "公司代號": "2072",
    "公司名稱": "世紀風電",
    "主旨 ": "公告本公司名稱由「世紀離岸風電設備股份有限公司」更名\r\n為「世紀能源設備股份有限公司」，公告期間：115年8月26日至\r\n115年11月25日。",
    "符合條款": "第51款",
    "事實發生日": "1150824",
    "說明": "1.事實發生日：民國115年08月24日\r\n2.公司名稱：世紀能源設備股份有限公司(原名：世紀離岸風電設備股份有限公司)\r\n3.與公司關係(請輸入本公司或子公司)：本公司\r\n4.相互持股比例：不適用\r\n5.發生緣由：\r\n(1)公司名稱變更核准日期/事實發生日：民國115年08月24日\r\n(2)公司名稱變更核准文號：經授商字第11530130420號\r\n(3)更名案股東會決議通過日期：民國115年08月12日\r\n(4)變更前公司名稱：世紀離岸風電設備股份有限公司\r\n(5)變更後公司名稱：世紀能源設備股份有限公司\r\n(6)變更前公司簡稱：世紀風電\r\n(7)變更後公司簡稱：世紀能源\r\n6.因應措施：無\r\n7.其他應敘明事項：(1)本公司於115/08/26收到經濟部變更登記核准函。\r\n(2)依據臺灣證券交易所股份有限公司營業細則第45條規定，\r\n於更名後須連續公告三個月。\r\n(3)本公司股票代號未變動，普通股仍為「2072」。\r\n(4)本公司英文名更名為「Century Energy Co., Ltd.」"
  },
  {
    "出表日期": "1151021",
    "發言日期": "1151020",
    "發言時間": "70004",
    "公司代號": "6949",
    "公司名稱": "沛爾生醫*-創",
    "主旨 ": "公告本公司股票面額由「新台幣10元」變更為「新台幣0.5元」，\r\n公告期間：115年08月06日至115年11月05日。",
    "符合條款": "第51款",
    "事實發生日": "1150713",
    "說明": "1.事實發生日：民國115年07月13日\r\n2.公司名稱：沛爾生技醫藥股份有限公司\r\n3.與公司關係(請輸入本公司或子公司)：本公司\r\n4.相互持股比例：不適用\r\n5.發生緣由：\r\n(1)公司面額變更核准日期/事實發生日：民國115年07月13日\r\n(2)公司面額變更核准文號：經授商字第經授商字第11530095510號號函\r\n(3)董事會決議通過換股計畫書日期：民國115年08月06日\r\n(4)變更前面額：新台幣10.00\r\n(5)變更後面額：新台幣0.50\r\n(6)新股票上市買賣日及舊股票終止上市買賣日：民國115年09月07日\r\n(7)換發股票時程重大訊息公告日期：民國115年08月06日重大訊息公告\r\n6.因應措施：無。\r\n7.其他應敘明事項：一、本公司係辦理變更股票面額，每股面額由新台幣10元變更為新台幣0.5元，業經臺灣\r\n證券交易所函核准在案。\r\n二、配合面額變更，新股票上市買賣日(115年09月07日)之參考價按比例調整為舊股票\r\n最後交易日(115年8月26日)收盤價之20分之1，請投資人注意。\r\
… (74 more characters)
```

### 4. SEC EDGAR: ✅ ok

- Data 資料: US filings 美股財報與 8-K
- Used by 使用功能: F12, N3
- Auth 驗證: SEC_USER_AGENT (declared contact)
- Documented limit 官方限制: At most 10 requests/second; a User-Agent with contact details is required (SEC fair-access policy) 每秒最多 10 次，需註明聯絡方式
- Checked 檢查時間: 2026-10-21 11:38:42

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Company tickers with exchange (company_tickers_exchange.json) | 200 | 466 ms | 523.9 kB | — |
| 2 | Recent filings for Apple, CIK 320193 (submissions API) | 200 | 399 ms | 163.8 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://www.sec.gov/files/company_tickers_exchange.json` (Last-Modified: Fri, 16 Oct 2026 11:53:51 GMT)
2. `https://data.sec.gov/submissions/CIK0000320193.json`

Notes 備註:

- company_tickers_exchange.json: 10443 tickers; fields cik, name, ticker, exchange
- Latest 10-Q/10-K: 10-Q filed 2026-07-31 (the F12 re-run trigger)

Sample 樣本: Ten most recent filings 最近十筆申報

```text
2026-10-19  4
2026-10-19  4
2026-10-16  144
2026-10-15  4
2026-10-08  4
2026-10-05  4
2026-10-05  4
2026-10-05  4
2026-10-05  4
2026-10-02  144
```

### 5. Alpha Vantage: ❌ failed 失敗

- Data 資料: US stock, ETF and index prices (primary) 美股、ETF 與指數價格（主要來源）
- Used by 使用功能: All
- Auth 驗證: ALPHAVANTAGE_API_KEY
- Documented limit 官方限制: 25 requests/day on a free key (PRD §6); also commonly cited as 5/minute
- Checked 檢查時間: 2026-10-21 11:38:43

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Active US listings (LISTING_STATUS, CSV) | 200 Alpha Vantage: JSON instead of CSV | 375 ms | 2 B | — |
| 2 | Weekly adjusted prices for VT (TIME_SERIES_WEEKLY_ADJUSTED) | 200 Alpha Vantage: We have detected your API key as *** and our standard API rate limit is 25 requests per day. Please subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly remove all daily rate limits. | 64 ms | 258 B | — |
| 3 | Symbol search "AGGU" (SYMBOL_SEARCH) | 200 Alpha Vantage: We have detected your API key as *** and our standard API rate limit is 25 requests per day. Please subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly remove all daily rate limits. | 60 ms | 258 B | — |
| 4 | TIME_SERIES_WEEKLY for AGGU.LON | 200 Alpha Vantage: We have detected your API key as *** and our standard API rate limit is 25 requests per day. Please subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly remove all daily rate limits. | 59 ms | 258 B | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://www.alphavantage.co/query?function=LISTING_STATUS&apikey=***`
2. `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=VT&apikey=***`
3. `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=AGGU&apikey=***`
4. `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY&symbol=AGGU.LON&apikey=***`

Observed limits 實測限制:

- Requests used this run 本次用量: 4 of the 25/day free quota

### 6. Financial Modeling Prep (FMP): ⏭️ skipped 略過

- Data 資料: Optional price source from the §6 free-tier note; tested only for AGGU 選用來源，只測 AGGU
- Used by 使用功能: AGGU candidate
- Auth 驗證: FMP_API_KEY not set 未設定
- Documented limit 官方限制: 250 requests/day on the free plan (PRD §6)
- Checked 檢查時間: 2026-10-21 10:52:33

_No requests made. 未發出請求。_

Skipped 略過:

- FMP_API_KEY not set: optional, only needed if Alpha Vantage cannot price AGGU 選用金鑰

### 7. FRED (St. Louis Fed): ✅ ok

- Data 資料: US rates, TWD/USD 美國利率與匯率
- Used by 使用功能: F11, F18, N2
- Auth 驗證: none: keyless fredgraph.csv 免金鑰 CSV
- Documented limit 官方限制: API: 120 requests/minute per key (commonly cited); keyless CSV download: no published limit
- Checked 檢查時間: 2026-10-21 10:52:33

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | DGS10 recent observations (keyless CSV) | 200 | 413 ms | 499 B | — |
| 2 | DEXTAUS recent observations (keyless CSV) | 200 | 624 ms | 569 B | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2026-09-06` (Last-Modified: Tue, 20 Oct 2026 20:16:39 GMT)
2. `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXTAUS&cosd=2026-09-06` (Last-Modified: Mon, 19 Oct 2026 20:17:00 GMT)

Notes 備註:

- DEXTAUS converts every USD-priced holding to TWD: VOO, VT, BNDW, GLDM, BIL, and AGGU, whose LSE line trades in USD.

Sample 樣本: DGS10, keyless CSV

```csv
observation_date,DGS10
2026-09-08,4.80
2026-09-09,4.83
… (25 more lines) …
2026-10-15,5.10
2026-10-16,5.09
2026-10-19,5.15
```

Sample 樣本: DEXTAUS, keyless CSV

```csv
observation_date,DEXTAUS
2026-09-08,31.5100
2026-09-09,31.4600
… (24 more lines) …
2026-10-14,32.1600
2026-10-15,32.4000
2026-10-16,32.4000
```

### 8. Central Bank of the ROC 中央銀行 (data.gov.tw dataset 10840): ✅ ok

- Data 資料: Taiwan 10-year government bond yield 台灣 10 年期公債殖利率
- Used by 使用功能: F11
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: Open-data file updated monthly; no published limit 每月更新的開放資料，未公布限制
- Checked 檢查時間: 2026-10-21 10:59:07

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Dataset 10840 資本市場利率: metadata (data.gov.tw API) | 200 | 822 ms | 8.6 kB | — |
| 2 | Capital-market rates, monthly (CSV) | 200 | 1804 ms | 56.6 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://data.gov.tw/api/v2/rest/dataset/10840`
2. `https://www.cbc.gov.tw/public/data/OpenData/經研處/EG43M01.csv` (Last-Modified: Tue, 29 Sep 2026 08:22:11 GMT)

Notes 備註:

- CSV links in the metadata: https://www.cbc.gov.tw/public/data/OpenData/經研處/EG43M01.csv , https://www.cbc.gov.tw/public/data/OpenData/經研處/EG43Y01.csv

Sample 樣本: Header and last rows; 10-year column "十年期政府公債次級市場利率(%)"

```csv
月,政府公債-3年期(%),政府公債-5年期(%),政府公債-7年期(%),政府公債-10年期(%),政府公債-15年期(%),公司債-1年期(%),公司債-2年期(%),公司債-3年期(%),公司債-4年期(%),公司債-5年期(%),公司債-6年期(%),公司債-7年期(%),公司債-10年期(%),金融債券-2年期(%),金融債券-3年期(%),金融債券-5年期(%),央行單券-CDs-1年期(%),央行單券-CDs-2年期(%),央行單券-SB-1年期(%),十年期政府公債次級市場利率(%)
2026M06,-,-,-,1.790,-,-,-,2.068,-,2.020,3.200,1.866,2.742,-,1.760,1.891,1.523,1.638,-,1.77460
2026M07,-,-,-,-,-,-,-,2.250,-,2.042,-,2.050,2.092,-,-,1.980,1.604,1.615,-,1.90030
2026M08,-,-,-,1.969,-,-,-,2.292,-,2.228,-,2.050,3.357,-,-,2.200,1.626,1.663,-,1.95500
```

### 9. Robert Shiller online data (shillerdata.com): ✅ ok

- Data 資料: US CAPE 週期調整本益比
- Used by 使用功能: F3
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: Static spreadsheet; no published limit. Its link rotates, so it is read from the page each time 下載連結會變，每次從網頁讀取
- Checked 檢查時間: 2026-10-21 10:59:10

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Data page (find the current ie_data.xls link) | 200 | 408 ms | 121.6 kB | — |
| 2 | ie_data.xls: monthly S&P 500 price, dividends, earnings, CPI, CAPE | 200 | 949 ms | 1.7 MB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://shillerdata.com/`
2. `https://img1.wsimg.com/blobby/go/e5e77e0b-59d1-44d9-ab25-4763ac982e53/downloads/1449043e-a1ed-4e2e-8e9c-7b9a2a064493/ie_data.xls?ver=1791297298731` (Last-Modified: Tue, 06 Oct 2026 14:33:57 GMT)

Notes 備註:

- Current download link 目前下載連結: https://img1.wsimg.com/blobby/go/e5e77e0b-59d1-44d9-ab25-4763ac982e53/downloads/1449043e-a1ed-4e2e-8e9c-7b9a2a064493/ie_data.xls?ver=1791297298731

Sample 樣本: Legacy .xls (OLE2): expected column labels found 找到的欄位標籤

```text
found: Date, CPI, Earnings, Dividend, CAPE, TR CAPE, Excess CAPE Yield
missing: none
PE (CAPE) Plot
Excess CAPE Yield (ECY)
CAPEg
TR CAPE
LANDSCAPE_CC270
CAPE<
```

### 10. Kenneth French Data Library: ✅ ok

- Data 資料: Factor returns 因子報酬
- Used by 使用功能: N1
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: Static zip files; no published limit 靜態檔案，未公布限制
- Checked 檢查時間: 2026-10-21 10:52:39

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Fama/French 5 factors (2x3), monthly, CSV in a zip | 200 | 464 ms | 12.0 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_CSV.zip` (Last-Modified: Fri, 25 Sep 2026 21:55:02 GMT)

Sample 樣本: F-F_Research_Data_5_Factors_2x3.csv: 758 monthly rows

```csv
,Mkt-RF,SMB,HML,RMW,CMA,RF
196307,   -0.39,   -0.48,   -0.84,    0.64,   -1.15,    0.27
196308,    5.08,   -0.80,    1.72,    0.40,   -0.38,    0.25
…
202607,   -0.61,   -0.09,    2.11,   11.07,    2.26,    0.33
202608,    2.56,   -0.53,   -3.54,   -4.08,   -2.01,    0.29
```

### 11. Damodaran Online: ✅ ok

- Data 資料: Equity risk premium 股票風險溢酬
- Used by 使用功能: F11
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: Static pages; implied ERP updated monthly (PRD F11); no published limit
- Checked 檢查時間: 2026-10-21 10:59:11

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Home page with the current implied ERP (New_Home_Page/home.htm) | 200 | 472 ms | 17.1 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://pages.stern.nyu.edu/~adamodar/New_Home_Page/home.htm`

Notes 備註:

- ERP files linked 相關檔案: https://pages.stern.nyu.edu/~adamodar/pc/implprem/ERPbymonth.xlsx , https://pages.stern.nyu.edu/~adamodar/pc/datasets/histimpl.xls , https://pages.stern.nyu.edu/~adamodar/pc/implprem/ERPOct26.xlsx

Sample 樣本: Text around the ERP line

```text
o the site.
Equity Risk Premiums (Data, Updates and Papers)
Implied ERP on October 1, 2026 = 4.20% (Trailing 12 month, with adjusted payout); 3.70% (Trailing 12 month cash yield); 5.67% (Average CF yield last 10 years); 3.61% (Net cash yield); 3.30% (Normalized Earnings & Payout) (with the US treasury rate of 5.29% used as the riskfree rate in US dollars; increase each of the premiums by the default spread (0.22%)for the US, if you are netting that out of the treasury to get 
```

### 12. TWSE corporate governance evaluation 公司治理評鑑: ✅ ok

- Data 資料: Governance rating 公司治理評鑑
- Used by 使用功能: N3
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: Published once a year; no published limit 每年公布一次
- Checked 檢查時間: 2026-10-21 11:51:54

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Latest evaluation results page | 200 | 7458 ms | 61.0 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://cgc.twse.com.tw/evaluationCorp/listCh`

Notes 備註:

- Edition on the page 屆別: 第 12 屆(114年)公司治理評鑑
- Downloadable files 可下載檔案: https://cgc.twse.com.tw/static/20260430/8a828e179dd8817f019ddd4b86530000_114%E5%B9%B4(%E7%AC%AC%E5%8D%81%E4%BA%8C%E5%B1%86)%E5%85%AC%E5%8F%B8%E6%B2%BB%E7%90%86%E8%A9%95%E9%91%91%E7%B3%BB%E7%B5%B1%E8%A9%95%E9%91%91%E7%B5%90%E6%9E%9C%E6%9A%A8%E8%A9%95%E9%91%91%E7%A8%8B%E5%BA%8F%E8%AA%AA%E6%98%8E.pdf , https://cgc.twse.com.tw/static/20241219/8a828e1793ce5bea0193dd8add0b0006_114%E5%B9%B4%E5%85%AC%E5%8F%B8%E6%B2%BB%E7%90%86%E8%A9%95%E9%91%91%E7%B3%BB%E7%B5%B1%E4%BF%AE%E6%AD%A3%E7%B8%BD%E8%AA%AA%E6%98%8E.pdf , https://cgc.twse.com.tw/static/20250103/8a828e179401a35301942b8c6c91000c_114%E5%B9%B4%E5%BA%A6%E5%85%AC%E5%8F%B8%E6%B2%BB%E7%90%86%E8%A9%95%E9%91%91%E7%B3%BB%E7%B5%B1%E4%BD%9C%E6%A5%AD%E6%89%8B%E5%86%8A.pdf , https://cgc.twse.com.tw/static/20250113/8a828e179448c93b01945f5871fc0017_114%E5%B9%B4%E5%85%AC%E5%8F%B8%E6%B2%BB%E7%90%86%E8%A9%95%E9%91%91%E6%8C%87%E6%A8%99.xlsx , https://cgc.twse.com.tw/static/20250306/8a828e179544c53e0195692c990f0022_114%E5%B9%B4%E5%BA%A6%E5%85%AC%E5%8F%B8%E6%B2%BB%E7%90%86%E8%A9%95%E9%91%91%E6%8C%87%E6%A8%99%E4%BF%AE%E6%AD%A3%E5%B0%8D%E7%85%A7%E8%A1%A8.pdf , https://cgc.twse.com.tw/static/20241219/8a828e1793ce5bea0193dd90b2c0000c_114%E5%B9%B4%E5%BA%A6%E5%85%AC%E5%8F%B8%E6%B2%BB%E7%90%86%E8%A9%95%E9%91%91%E6%8C%87%E6%A8%99%E9%A1%8C%E5%9E%8B%E8%AA%BF%E6%95%B4%E5%B0%8D%E7%85%A7%E8%A1%A8.pdf , https://cgc.twse.com.tw/static/20260107/8a828e179b9664ed019b984a3a020000_%E5%AE%A3%E5%B0%8E%E8%AA%B2%E7%A8%8B%E7%B0%A1%E5%A0%B11-%E5%85%AC%E5%8F%B8%E6%B2%BB%E7%90%86%E8%A9%95%E9%91%91%E4%BB%8B%E7%B4%B9%E6%9A%A8%E8%A9%95%E5%88%86%E6%8C%87%E5%8D%97%E8%88%87%E7%AF%84%E4%BE%8B%E8%AA%AA%E6%98%8E.pdf , https://cgc.twse.com.tw/static/20250305/8a828e179544c53e0195657d1f890020_2.%20%E5%85%AC%E5%8F%B8%E6%B2%BB%E7%90%86%E7%9B%B8%E9%97%9C%E8%A6%8F%E7%AB%A0_%E5%90%88%E4%BD%B5V5.pdf

Sample 樣本: Page text (start) 頁面文字

```text
TWSE 公司治理中心 
English 
關於我們
公司治理中心簡介
公司治理藍圖簡介
我國公司治理發展歷程
強化我國公司治理藍圖(2013-2017)
新版公司治理藍圖(2018~2020)
公司治理3.0-永續發展藍圖(2021-2023)
相關網站
聯絡我們
最新消息
新聞稿
電子報
國內外時事
盡職治理守則
盡職治理守則簡介
簽署名單
各國盡職治理守則
盡職治理報告範例
證交所發布盡職治理
相關資訊
服務提供者專區
各公會盡職治理專區
企業永續發展
上市櫃公司永續發展行動方案
(2023年)
上市櫃公司永續發展路徑圖
企業永續發展簡介
ESG相關法規
上市櫃公司永續報告書
企業ESG資訊揭露
企業永續相關指數
臺灣永續指數
臺灣企業社會責任中小型指數
臺灣公司治理100指數
臺灣高薪100指數
臺灣就業99指數
ESG指數化商品
永續發展債券
臺灣永續投資調查
執行成果
-->
公司投資人關係整合平台
產學合作實習計畫
計畫緣由
計畫時程
辦理成果
參考資料
準則
揭露指引及範例-IFRS永續揭露準則
揭露指引及範例-永續報告書
揭露指引及範例-TCFD
歷年ESG年鑑
其他參考資料
法規及問答
法規架構
主管機關訂定
證交所及櫃買中
心訂定
其他行業別之公
司治理實務守則
股東會年報最佳實務參考範例
問答集
評鑑資訊
ESG評鑑簡介
ESG評鑑
公司治理評鑑
資訊揭露評鑑簡介
-->
資訊揭露評鑑
-->
宣導活動及出版品
宣導活動
公司治理報告
年報及永續報告書審閱報告
國際公司治理發展簡訊
影音宣導短片
其他參考資料
資料庫
獨立董事人才資料庫
執法統計資料庫
金管會裁罰案件專區
金管會證期局裁罰案件
專區
重大工安、災難、環境汙染及各主管機關裁罰案件專區
會計師懲戒專區
上市公司違規及交易面
異常資訊
上櫃公司違規及交
… (1841 more characters)
```

### 13. EPA ECHO: ✅ ok

- Data 資料: US environmental penalties 美國環境裁罰
- Used by 使用功能: N3
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: No published limit; EPA may throttle heavy use 未公布限制
- Checked 檢查時間: 2026-10-21 10:52:44

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Facility search by name "APPLE" (get_facilities) | 200 | 1231 ms | 359 B | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://echodata.epa.gov/echo/echo_rest_services.get_facilities?output=JSON&p_fn=APPLE`

Notes 備註:

- Facilities matching "APPLE": 3932; rows are paged with get_qid (QueryID 483)

Sample 樣本: get_facilities reply

```json
{
  "Message": "Success",
  "Version": "ALL DATA v2017-06-16 0923",
  "QueryRows": "3932",
  "IndianCountryRows": "912",
  "SVRows": "15",
  "CVRows": "77",
  "V3Rows": "194",
  "FEARows": "49",
  "InfFEARows": "157",
  "INSPRows": "141",
  "…": "7 more keys"
}
```

### 14. Ministry of Environment open data 環境部 (ems_p_46): ✅ ok

- Data 資料: Taiwan environmental penalties 台灣環境裁罰
- Used by 使用功能: N3
- Auth 驗證: MOENV_API_KEY
- Documented limit 官方限制: Free member API key required; no limit stated in the docs found 需免費會員金鑰
- Checked 檢查時間: 2026-10-21 11:46:26

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | First five penalty records (ems_p_46) | 200 | 1420 ms | 9.8 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://data.moenv.gov.tw/api/v2/ems_p_46?api_key=***&format=JSON&limit=5&offset=0`

Notes 備註:

- 5 records in this reply; fields: ems_no, fac_name, county_name, document_no, transgress_date, transgress_law, penalty_money, penalty_date, ispetition, petition_results, appeal_or_rescind, transgress_type, fac_address, transgress_name, openinfor, lawsuit_date_1, illegal_money, track_illegal_money, petition_agency, ban, transgress_address, subject, gist_define, improve_deadline, inspection_condition, transgress_control_id, is_improve, inspection_datetime_s, penaltykind, isimportant, paymentstate, isreminder, isadmincourt, isreducemoney, allow_rework_date, fac_city_code, fac_area_code, transgress_city_code
- Penalty dates in these records 裁處日期: 2026-07-07 to 2026-09-14
- Records carry a business ID 統一編號, so they can be matched to listed companies.

Sample 樣本: First records in the reply 回傳的前幾筆

```json
[
  {
    "ems_no": "L89097000842",
    "fac_name": "興亞營造工程股份有限公司",
    "county_name": "苗栗縣",
    "document_no": "40-115-070014",
    "transgress_date": "2026-06-30",
    "transgress_law": "廢棄物清理法第31條第1項第2款",
    "penalty_money": "6000",
    "penalty_date": "2026-07-28",
    "ispetition": "0",
    "petition_results": "",
    "appeal_or_rescind": "",
    "transgress_type": "事業廢棄物",
    "…": "26 more keys"
  },
  {
    "ems_no": "A43097016489",
    "fac_name": "宏倫企業有限公司",
    "county_name": "臺北市",
    "document_no": "21-115-070396",
    "transgress_date": "2026-06-02",
    "transgress_law": "空氣污染防制法第44條第1項",
    "penalty_money": "500",
    "penalty_date": "2026-07-07",
    "ispetition": "0",
    "petition_results": "",
    "appeal_or_rescind": "",
    "transgress_type": "移動污染",
    "…": "26 more keys"
  },
  "… 3 more items"
]
```

### 15. ETF issuer holdings files ETF 發行商持股檔: 🟡 partial 部分

- Data 資料: ETF holdings ETF 成分股
- Used by 使用功能: F14
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: Public website downloads; no published limits 官網公開下載，未公布限制
- Checked 檢查時間: 2026-10-21 10:59:13

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | iShares AGGU product page (find the fund download link) | 200 | 311 ms | 3.1 MB | — |
| 2 | iShares AGGU fund download: holdings and NAV history (SpreadsheetML) | 200 | 10106 ms | 25.5 MB | — |
| 3 | SSGA BIL daily holdings (xlsx) | 200 | 724 ms | 18.5 kB | — |
| 4 | Vanguard VT holdings (JSON, first page) | 200 | 670 ms | 171.7 kB | — |
| 5 | Vanguard VOO holdings (JSON, first page) | 200 | 207 ms | 174.4 kB | — |
| 6 | Vanguard BNDW holdings (JSON, first page) | 200 | 230 ms | 209.0 kB | — |
| 7 | Cathay 00922 PCF page 申購買回清單 (HTML) | 403 HTTP 403 Forbidden | 521 ms | 400 B | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://www.ishares.com/uk/individual/en/products/291772/ishares-core-global-aggregate-bond-ucits-etf` (Last-Modified: Wed, 21 Oct 2026 00:35:36 GMT)
2. `https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v1/get-fund-document?appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=ishares-uk&locale=en_GB&portfolioId=291772&component=fundDownloadV2&userType=individual`
3. `https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-bil.xlsx` (→ redirected to `https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-bil.xlsx` · Last-Modified: Tue, 20 Oct 2026 10:05:22 GMT)
4. `https://investor.vanguard.com/vmf/api/VT/portfolio-holding/stock.json`
5. `https://investor.vanguard.com/vmf/api/VOO/portfolio-holding/stock.json`
6. `https://investor.vanguard.com/vmf/api/BNDW/portfolio-holding/bond.json`
7. `https://www.cathaysite.com.tw/ETF/purchase?code=DO`

Notes 備註:

- Fund download link taken from the product page
- Worksheets 工作表: Fund Header, Performance Returns, Historical NAVs, Growth of Hypothetical 10,000, Key Facts, Portfolio Characteristics, Exposure Breakdowns, Holdings, Others
- Historical NAVs 歷史淨值: 2259 daily values, 2017-11-21 to 2026-10-19
- BNDW is a fund of two Vanguard bond ETFs (BND, BNDX), so its look-through may need their holdings too.

Sample 樣本: Historical NAVs, newest first

```text
2026-10-19  5.76
2026-10-16  5.77
2026-10-15  5.77
```

Sample 樣本: BIL holdings workbook: first short text cells

```text
Fund Name: | Ticker Symbol: | Holdings: | DoubleLine® is a registered trademark of DoubleLine Capital LP. | here | for more information. | Disclosure | Distributor: | Not FDIC Insured * No Bank Guarantee * May Lose Value | State Street® SPDR® Bloomberg 1-3 Month T-Bill ETF | BIL | As of 19-Oct-2026 | Name | Identifier | SEDOL | Weight | Coupon | Par Value | Market Value | Local Currency | Maturity | TREASURY BILL 11/26 0.00000 | US912797UM78 | BNZJKH9 | USD | 11/05/2026 | US912797SU23 | BVPJDQ5 | 11/27/2026 | TREASURY BILL 12/26 0.00000
```

Sample 樣本: VT holdings JSON

```json
{
  "size": 10170,
  "asOfDate": "2026-09-30T00:00:00-04:00",
  "self": {
    "type": "application/xml,application/json",
    "href": "http://api.vanguard.com/rs/ire/01/ind/fund/VT/portfolio-holding/stock?start=1&count=500",
    "ref": "self"
  },
  "next": {
    "type": "application/xml,application/json",
    "href": "http://api.vanguard.com/rs/ire/01/ind/fund/VT/portfolio-holding/stock?start=501&count=500",
    "ref": "next"
  },
  "fund": {
    "entity": [
      {
        "type": "portfolioHolding",
        "asOfDate": "2026-09-30T00:00:00-04:00",
        "longName": "NVIDIA Corp.",
        "shortName": "NVIDIA CORP",
        "sharesHeld": "20230881",
        "marketValue": 4620328602.78,
        "ticker": "NVDA",
        "isin": "US67066G1040",
        "…": "7 more keys"
      },
      {
        "type": "portfolioHolding",
        "asOfDate": "2026-09-30T00:00:00-04:00",
        "longName": "Apple Inc.",
        "shortName": "APPLE INC",
        "sharesHeld": "12538449",
        "marketValue": 4175554285.98,
        "ticker": "AAPL",
        "isin": "US0378331005",
        "…": "7 more keys"
      },
      "… 498 more items"
    ]
  }
}
```

### 16. Bank of Taiwan gold price 臺灣銀行黃金牌價: ❌ failed 失敗

- Data 資料: Gold price in TWD 台幣金價
- Used by 使用功能: N5, N4, N6
- Auth 驗證: none 免金鑰
- Documented limit 官方限制: Public web page; no published limit 公開網頁，未公布限制
- Checked 檢查時間: 2026-10-21 10:59:28

| # | Call 呼叫 | HTTP | Time 時間 | Size 大小 | Rate-limit headers 流量標頭 |
| --- | --- | --- | --- | --- | --- |
| 1 | Gold passbook prices, last 12 months, NT$ per gram (HTML) | 200 bot challenge page instead of prices: the site asks for a browser to solve a challenge | 415 ms | 1.9 kB | — |

Request URLs (keys blanked) 請求網址（金鑰已遮蔽）:

1. `https://rate.bot.com.tw/gold/chart/ltm/TWD?Lang=zh-TW`

Notes 備註:

- Physical gold needs another route before N5: a browser-based fetch, or the gold price in USD times TWD/USD.

---

Raw payloads are saved under `reports/source-check/samples/` (git-ignored). Re-run one source with `npm run check:sources -- --only=<id>`; sources not re-run keep their last result. 原始資料存在 `reports/source-check/samples/`（不會上傳）。
