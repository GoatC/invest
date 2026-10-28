# 執行 App Running the app

接在 [Supabase 設定](supabase-setup.md) 之後（`npm run check:supabase` 全部 ✅）。上線與手機安裝見 [部署到 Vercel](deploy-vercel.md)。

Follows the Supabase setup; the app then runs on your Mac. Every page explains its figures behind ⓘ; this page lists what you have to do.

## 1. 取得最新程式並更新資料庫 Update

在 `invest` 資料夾執行：

```bash
git checkout main && git pull
npm install
npx supabase db push
npm run check:supabase
```

- `npm install`：安裝套件（第二階段第 1 步起含讀 Excel 的 `xlsx`）。
- `npx supabase db push`：列出新的 migration（每個 PR 的說明都會寫出），輸入 `Y` 套用。migration 只新增資料表、設定或欄位，不會改動你的資料。
- `npm run check:supabase`：每張資料表與檢視表都要 ✅；第二階段第 5 步（N3）之後是 **33 項**（新增 `company_profiles`、`red_flag_events`、`red_flag_entries`）。出現「找不到資料表，請先執行 db push」代表上一行還沒成功。

## 2. 啟動 App Start

```bash
npm run dev
```

打開 <http://localhost:3000>，以 Supabase 設定第 4 步的 email 與密碼登入。Terminal 要保持開著；按 `Control` + `C` 關閉。Run `npm run dev`, open http://localhost:3000, sign in; Control-C stops it.

## 3. 需要你做的事 What to do, page by page

持倉頁一開始是空的：示範資料只用在測試。

- **新增交易**：輸入代號後自動帶入幣別與交易日匯率；對帳單有成交匯率時改成那個。找不到代號就按「找不到？新增證券」。R1／R2 違反時只提醒；賣出超過持有數量會被拒絕。
- **黃金與現金**：「新增非上市資產」：實體黃金填克數（每夜依金價估值），活存與貨幣基金填台幣餘額。
- **現金流**：「新增現金流」：投入資金、大額資金入帳、股利（填實際收到的稅後金額）、提領，金額一律填正數。股利計入 XIRR；投入與提領只做紀錄。
- **匯入 CSV**：下載券商成交明細 CSV →「匯入 CSV」填券商名稱與檔案 → 檢查預覽（現金股利存成股利現金流，已存在的會略過）→ 沒有匯率欄時留空，帶入各列交易日匯率 → 新代號點「新增 XXX」後「重新檢查」→「匯入」。欄位對應依券商記住。
- **規則**：「提案」→「規則與門檻」，填每月定期定額金額與**扣款日**（未填前「每月投入」不觸發）。門檻、冷卻天數與啟用狀態也在這裡修改。
- **提案**：每晚（或按「立即檢查規則」）觸發的規則會產生提案與下單清單。核准、修改股數（0 為刪除）或略過；核准後到券商下單，從執行清單按「登錄交易」（自動帶入代號、股數、手續費），改成成交單的數字再儲存，最後「標記為已成交」。App 從不下單。
- **資產配置**：「修改目標權重」（合計 100%；衛星不是 20% 時同時改 R2 的 `target_weight`）、「修改假設」填各核心類別的預期報酬、波動度與來源。
- **推播**：依 [推播通知](web-push.md) 設定 VAPID 金鑰，在每台裝置按「開啟推播」（iPhone 從主畫面打開 App）。
- **費用與稅務**：在「你使用的券商」選定券商並儲存（提案才會估手續費）；設定中標示「尚未確認」的數字到官網核對後勾選「我今天已確認」。
- **大額資金**（F3）入帳時：①「新增現金流」選「大額資金入帳」；②「新增非上市資產」新增台幣餘額（現金與貨幣基金、大額資金池）；③「大額資金」頁「分批計畫」確認後「建立計畫」。每批到期會產生提案，登錄交易時自動選大額資金池。可在設定選各類別的買進基金（例如愛爾蘭註冊的 AGGU）。
- **回歸分析**（N1）：最下方設定中的**台幣無風險利率**（起始 1.7%）請到臺銀網站核對後勾選「今天已確認利率」。想看的代號先在「證券」新增，下一次每夜排程才有價格。
- **權益成本**（F11）：設定中的 ERP 與台灣國家風險溢酬請對照 Damodaran 網站（每年 1、7 月更新）後勾選「今天已確認輸入值」。
- **估值**（F12）：「估值」頁選一檔個股「加入觀察清單」，打開它的工作台：
  - 上方小卡是股價、基本情境內在價值、安全邊際與所在區間；圖表是三種模型（DCF、股利折現、倍數法）的悲觀到樂觀區間與買入區、減碼區價格。
  - 在「假設」設定警報採用的模型、各情境的成長率與永續成長率，必要時填入取代財報的數字（百萬為單位）與同業代號；儲存時一併存下估值，警報以它為準。
  - 財報由每夜排程載入：台股來自 FinMind；**美股來自 SEC，需要 GitHub secret `SEC_USER_AGENT`**（見 [每夜價格排程](nightly-job.md)）。新一季財報進來後，排程會自動重新估值，變動超過 10% 時提醒你檢視。
  - 股價 ≤ 內在價值 × 0.75 時，「買入區」提案以當月投入的衛星比例（20%）買進，受 R1／R2 限制；持股 ≥ 1.25 倍時「減碼區」提案賣出一半。倍數可在個股假設或「規則」頁修改。
- **紅旗指標**（N3）：「紅旗指標」頁列出每檔持有或觀察中個股的燈號、資料覆蓋率與觸發的指標；燈號只供參考，不會阻擋交易。點代號看每個指標的依據（Beneish M 與 Altman Z 代入財報數字、事件清單）。
  - 沒有免費來源的指標請自行登錄：台股的**公司治理評鑑級距**（證交所公司治理中心每年公布）；美股的**環境裁罰**（到 EPA ECHO 查該公司的工廠）；以及每夜排程開始讀取重大訊息之前的台股更換會計師、財報重編與繼續經營疑慮（公開資訊觀測站）。查過但沒有找到請填 0。新增或刪除紀錄後會立即重新掃描。
  - 設定中的**排除產業**（PRD 第 9 節待決）預設是空的：填入你不想投資的產業代碼或名稱（例如「菸」），符合的公司會變紅燈。
  - 每週掃描後，持股燈號轉差會產生「紅旗惡化」提案提醒檢視；衛星持股轉紅會產生「紅旗轉紅」提案，並先準備好全數賣出的出場清單，可修改或略過。
  - 台股環境裁罰需要 GitHub secret `MOENV_API_KEY`（見 [每夜價格排程](nightly-job.md)）。
- **複利計算機**：填好輸入後按「儲存為我的計畫」，之後每月底比較實際與計畫。

## 補充 Notes

- 標著 ＊ 的金額是估計值：每夜排程還沒載入價格或匯率時，暫以最近一筆交易估算。
- 所有門檻都在 `rules` 與 `config` 表，可在 App 的設定或 Supabase 的 Table Editor 修改，不需要改程式。
- 畫面顯示「無法從資料庫讀取」時，多半是還沒執行 `npx supabase db push`。
- `npm run dev` 顯示 Node.js 版本太舊：到 <https://nodejs.org> 安裝 LTS 版本後重開 Terminal。

Figures marked * are estimates until the nightly job has loaded their price. Thresholds live in the `rules` and `config` tables. A "could not read" page usually means `npx supabase db push` is still to be run.
