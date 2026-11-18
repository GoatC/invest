# iPhone 主畫面小工具（Widget）設計 · iOS home-screen widget

日期：2026-11-18 · 提出：Hugo · 狀態：草稿，待 Hugo 核可

## 1. 為什麼要做

Hugo 想把它放在主畫面，**順眼看一下，確認沒事就好**，不必打開 App。所以它是「看一眼」用的，不是分析工具：數字要少、要大，一眼就能讀完。

## 2. 要做到的、不做的、做了也算失敗的

**要做到**（Hugo 的回答，2026-11-18）
- 中型（長方形）Widget，顯示：
  - **總市值**：一般和大額兩個資金池合計，與儀表板海報的「總市值」意思相同；
  - **近 7 天漲跌，百分比**：算法與海報上「近 7 天」那顆一樣（`lib/models/value-line.ts` 的 `week.change`，時間加權報酬，扣掉這段期間存入或提出的錢）；
  - **走勢線**。
- 數字是**昨日收盤**，並標出是哪一天的收盤。
- **解鎖才顯示**數字。
- 點 Widget 會打開 App 的儀表板。
- 漲跌的紅綠跟著 App 的顏色設定（config `sectors` 的 `colour`，預設紅漲綠跌），旁邊一律加 ▲／▼。

**不做**
- 盤中即時價格。
- 小型、大型、鎖定畫面、StandBy 這幾種尺寸（之後要再說）。
- 網頁版（PWA）的 Widget：iOS 不允許網頁有 Widget。
- 台幣漲跌金額、累計報酬、兩個資金池分開顯示。

**做了也算失敗**
- Widget 存著 Hugo 的完整登入，或是一把能讀寫整個資料庫的鑰匙。
- 數字跟海報對不起來，例如大額資金一入帳，7 天漲跌就跳一大段。
- 用到付費 Apple 帳號才有的功能（App 群組、推播等），讓免費簽署簽不過。
- 鑰匙、金額或持股進了 git（repo 是公開的）。
- 鎖定時，看得到數字。

## 3. 限制

- **免費簽署**（CLAUDE.md、`docs/ios-app.md`）：沒有 App 群組，所以 Widget 讀不到 App 的登入或儲存空間，只能自己上網要資料。Widget 是另一個 target，會多佔一個 App 識別碼（免費帳號每 7 天最多 10 個；之後每週重裝沿用同一個，不會再多），也跟著 App 每 7 天到期。
- **雲端環境沒有 Xcode**：Swift 只能靠「iOS shell build」workflow 編譯和 `look` job 截圖驗證；把 Widget 加到主畫面、貼上鑰匙，只有 Hugo 的手機看得到。
- 網站除了 `/login` 之外，每一頁都要登入（`proxy.ts` → `lib/supabase/proxy.ts`）。Vercel 上沒有 service key，只有 GitHub Actions 的排程有 `SUPABASE_SECRET_KEY`。
- 每張表都要開 row-level security（CLAUDE.md）。門檻放 config，不寫死在程式裡。
- 每個 model 函式都要有單元測試，用 PRD 第 11 節的驗收值。

## 4. 考慮過的做法（Hugo 選了 A）

| | 做法 | 取捨 |
|---|---|---|
| **A（選定）** | **每晚先算好一份**：每晚的資料更新算完後，存一小筆 Widget 用的數字。Widget 帶專用鑰匙來要，資料庫比對無誤，就只交出這一筆。 | Vercel 不必多放任何密碼；鑰匙外流也只看得到這幾個數字；回應很快。代價：白天新增交易後，要等當晚或按「更新最新資料」，Widget 才會變。Hugo 已接受只看昨日收盤。 |
| B | 每次都現算：Widget 來問時，網站讀全部資料、照儀表板算一次。 | 數字永遠和儀表板一樣；但 Vercel 要多放一把萬能 service key（Hugo 多一個設定步驟，外流的影響也大），每次刷新都要讀全部資料。 |
| C | 讓 Widget 也登入 Hugo 的帳號。 | 存著完整登入，違反「只能讀幾個數字」的原則。不採用。 |

鑰匙本身，Hugo 選「只能讀這幾個數字的專用鑰匙，貼一次」，不用 iOS 鑰匙圈共享（不確定免費帳號能不能用），也不改付費帳號。

## 5. 決定好的做法

### 5.1 資料：每晚一份 Widget 數字

- **新的 model** `lib/models/widget.ts`：輸入每日序列（`buildSeries` 的 `DayPoint[]`）和顏色設定，輸出 Widget 要的那份數字：
  - `asOf`：最後一個收盤日；
  - `totalTwd`：那天兩個資金池合計的總值，與 `nav_snapshots.total_twd` 同一個數字；
  - `weekChange`：`valueLine(days).week.change`。序列不滿 7 天時是 null，Widget 顯示「—」；
  - `points`：走勢線，**和海報同一條**（`valueLine` 的 `points`，自第一天起的累計報酬），取樣到約 40 點；
  - `redUp`。
  
  海報和 Widget 共用 `valueLine`，所以兩邊的 7 天漲跌一定一樣。這個 model 要寫單元測試，驗收值同時加進 PRD 第 11 節。
- **新的表**（一筆的單例表，開 RLS，owner policy 和其他表一樣；service_role 可寫）：
  - `widget_snapshot`：上面那份數字，加上 `updated_at`；
  - `widget_key`：鑰匙的 **SHA-256 雜湊**（不存原文）和 `created_at`。
- **誰來寫**：每晚的排程（`scripts/lib/nightly/job.ts`）在存完 `nav_snapshots` 之後，用同一份 `days` 算出這份數字並存起來（`store` 加一個 `saveWidgetSnapshot`）。「更新最新資料」按鈕跑的也是這個排程（`refresh.yml`），所以會一起更新。這一步失敗時，記在 run 的 errors 裡，不影響其他步驟（和 snapshots 的寫法一樣）。
- **怎麼交出去**：一個 `security definer` 的 Postgres 函式 `widget_figures(key text)`，只授權給 `anon`：它算出 `sha256(key)`，跟 `widget_key` 比對，相符才回傳 `widget_snapshot` 那一筆，不符就回空的。另外再算一個 `stale` 旗標：`asOf` 比今天（台北時間）早超過 config `widget.stale_days` 天（起始值 3，新的 config 列）就是 true。
- **網站端點**：`GET /shell/widget`，鑰匙放在 `Authorization: Bearer …`。它用 anon key 呼叫上面的函式，回傳 JSON，並加 `cache-control: no-store`。這個路徑要排除在登入檢查之外（`proxy.ts` 的 matcher，或 `lib/supabase/proxy.ts` 放行）。鑰匙錯誤或缺少時回 401，回應裡沒有任何數字。

### 5.2 鑰匙：在 App 裡產生，貼進 Widget

- 放在 **更多 → 推播** 頁，新增一段「主畫面小工具 Home-screen widget」，收在 `<details>` 裡（設定類的東西都這樣收）：
  - 按鈕「產生鑰匙」：server action 產生 32 bytes 的亂數（base64url），把雜湊存進 `widget_key`，**原文只顯示這一次**，旁邊附「拷貝」按鈕。再按一次就換一把新鑰匙，舊的立刻失效。
  - 已有鑰匙時，顯示建立的日期，按鈕改成「換一把鑰匙」。
  - 字要少：一行說明，其餘放在 ⓘ 後面。
- 這頁本來就在導覽裡，不必改 `components/nav-pages.ts`。
- 不加橫幅：Widget 是選用的，沒設定也不算「等 Hugo 處理的事」。

### 5.3 iOS Widget

- **新的 target**：Widget Extension `LongViewWidget`，識別碼 `$(BUNDLE_ID).widget`，嵌在 App 裡；由 `ios/project.rb` 產生，Swift 檔放在 `ios/Widget/`。不要求任何 capability，`install.sh` 一次簽好兩個 target。
- **設定**：用 `AppIntentConfiguration`，只有一個欄位「鑰匙」。Hugo 長按 Widget → 編輯小工具 → 貼上。鑰匙由系統跟著這個 Widget 保存；App 本身不碰它。
- **網址**：Widget 從 `Info.plist` 讀 `SITE_HOST`（和 App 同一個 build setting），拼成 `https://<SITE_HOST>/shell/widget`。
- **畫面**（中型；沿用 Liquid Glass 規格裡海報的樣子：海報藍底 `#34689c`，深色模式 `#1f4f86`，白字）：

  ```
  ┌──────────────────────────────────────┐
  │ 總市值                     11/17 收盤 │
  │ NT$ 12,345,678                        │
  │ ▲ 1.23%  近 7 天        ╱‾‾╲__╱‾‾‾   │
  │                        （走勢線）     │
  └──────────────────────────────────────┘
  ```
  
  上面的數字是示意，不是真的。金額用圓體（SF Rounded）、等寬數字。7 天漲跌照 Liquid Glass 規格海報上的白底小膠囊（`.chip`）。走勢線用 Swift Charts 的 `LineMark`，白色。iOS 26 主畫面的「染色／清透」模式下，用 `widgetAccentable`，讓系統能重新上色。
- **解鎖才顯示**：金額、漲跌、走勢線都加 `.privacySensitive()`。手機鎖著時（鎖定畫面左滑進到的 Widget 頁、StandBy），iOS 會把它們換成遮罩。
- **還沒設定、出錯、資料太舊**（一行字，不寫段落）：
  - 沒有鑰匙：「長按 → 編輯小工具，貼上鑰匙」；
  - 401：「鑰匙已失效，請到 更多 → 推播 換一把」；
  - 連不上網站：保留上一次的數字，日期旁加 ⚠︎；
  - `stale` 為 true：日期旁加 ⚠︎。
- **多久更新一次**：時間線排到每晚排程跑完之後（排程是台北時間 22:23 開跑；Widget 排在 23:30 左右再要一次），中間每 3 小時備援一次。App 每次打開時呼叫 `WidgetCenter.shared.reloadAllTimelines()`，這不需要 App 群組。
- **點擊**：`widgetURL(longview://open?path=/)`，交給現有的 `Router`（只接受站內路徑），打開儀表板。

### 5.4 文件

- `docs/ios-app.md` 加一節「主畫面小工具」，用白話中文寫：怎麼產生鑰匙、怎麼加 Widget、怎麼貼鑰匙、鑰匙外流時怎麼換。第 10 節「請在手機上確認」也補上幾項。
- PRD 第 5 節「手機改版」第 8 步加一個子項（Widget），第 7 節資料結構加兩張表，第 11 節加驗收值。

## 6. 留給實作者決定的

- 確切的 config 欄位格式和 migration 檔名（照現有慣例）。
- 走勢線取樣幾點（約 40 點即可）。
- Widget 的時間線細節：備援間隔、失敗時的重試。
- 鑰匙欄位在 `AppIntent` 裡怎麼呈現（顯示為一般文字或遮住）。
- 「iOS shell build」的 `look` job 能不能截到 Widget：例如在 App 的測試畫面裡放一份 Widget view 的預覽；截不到的話，在 PR 裡列出只有 Hugo 手機能確認的項目。
- 端點的測試方式（Vitest 測 route handler，或 e2e）。
