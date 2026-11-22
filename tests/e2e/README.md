# End-to-end check 端對端檢查

`npm run test:e2e` builds the app, runs it against a local stand-in for Supabase loaded with the
migrations and the demo seed, and walks through every page in Chromium: the manifest, icons and
security headers, sign-in, each feature's figures against the demo data and the PRD's acceptance
cases, every form's save, edit, delete and edit log, the CSV import, the rules engine and its
standing warnings, Web Push to a stand-in push service on local HTTPS, dark mode, a phone-width
check of every page, the navigation, the glass tab bar, the opening screen and the preloading, the
iOS shell stood in for, and sign-out. Each step prints one `ok` or `FAIL` line naming what it
checked (tests/e2e/drive.mjs holds them in order), then any browser error. The walk runs with the
preloading off (`localStorage.preload = 'off'`), so each step meets a server that is not busy with
twenty other pages.

Unless `E2E_NIGHTLY=0`, it then runs the real volatility job (`scripts/volatility.ts`, live CBOE,
TAIFEX and policy-index feeds) and the news job (`scripts/news.ts`, live Google News) against the
stand-in and checks what they saved. With a `FINMIND_TOKEN` in the environment it also removes the
invented weekly history, runs the real nightly job (`scripts/nightly.ts`, live feeds) twice, the
second time as on GitHub Actions, and checks every live series it loads and what the app shows
from them.

`npm run test:e2e` 會建置 App，連到載入資料庫遷移與示範資料的本機 Supabase 替身，並以 Chromium 走過每一頁：manifest、圖示與安全標頭、登入、各功能以示範資料與 PRD 驗收案例核對數字、每個表單的儲存／修改／刪除與修改紀錄、CSV 匯入、規則引擎與常駐警示、推播到本機 HTTPS 的替身推播服務、深色模式、每頁的手機寬度檢查、導覽、玻璃分頁列、啟動畫面與預載、iOS 外殼替身，最後登出。每一步印出一行 `ok` 或 `FAIL`（順序見 tests/e2e/drive.mjs），最後列出瀏覽器錯誤。除非設定 `E2E_NIGHTLY=0`，之後會對替身執行真實的波動與新聞排程並檢查存下的資料；環境中有 `FINMIND_TOKEN` 時，也會執行兩次真實的每夜排程（第二次如同在 GitHub Actions 上），並檢查每一項即時資料與 App 顯示的結果。

## Timing the tab switches 量測換頁速度

`E2E_DRIVER=bench.mjs npm run test:e2e` runs the same stand-in but, in place of the walk-through,
times the phone's tab switches: an iPhone-sized screen with the CPU slowed four times, tapping
持倉, 績效, 配置, 回歸 (from the More sheet) and 儀表板 round after round, each until its h1 shows
with no loading placeholder left (settled), until its h1 first shows (title) and until the first
sign the tap was taken (first change). Before the taps it times the opening: a signed-in phone loading the app afresh three times, until the opening screen shows and until it lifts with the pages one tap away fetched (`BENCH_PRELOAD=0` turns the preloading off, to compare). `BENCH_NET_MS` adds that many milliseconds to every request between the phone and the app, as a mobile network does. `GATEWAY_DELAY_MS` adds that many milliseconds to every
Supabase request (150 ≈ Vercel in Washington to a Tokyo project; 5 ≈ both in Tokyo),
`BENCH_COLD=1` reloads before each tap so none is answered from the router cache, `BENCH_ROUNDS`
sets the rounds (4) and `BENCH_REPORT=file` writes the times as JSON. `GATEWAY_LOG=1` prints each
Supabase request with its time in the gateway log, to see a page's queries in sequence.

以 `E2E_DRIVER=bench.mjs` 執行時改為量測手機換頁時間；`GATEWAY_DELAY_MS` 模擬每次資料庫連線的延遲。

## What the stand-in is 替身的組成

Hosted Supabase is PostgreSQL behind an API gateway. The stand-in runs the same open-source parts
on the machine, without Docker:

| Part | Here |
| --- | --- |
| Database | PostgreSQL 16, with `stand-in/bootstrap.sql` creating the roles a Supabase project starts with |
| Auth | Supabase Auth (GoTrue) `v2.177.0`, the release binary |
| Data API | PostgREST `v12.2.3`, the release binary |
| Gateway | `stand-in/gateway.mjs`: routes `/auth/v1` and `/rest/v1`, and turns the publishable key into the anon role and the secret key into service_role |

Every run uses a fresh database, a new random JWT secret, publishable and secret key and owner
password, and deletes the database at the end. Nothing touches the hosted project. The database
also gets the seed's newest USD/TWD rate dated today, so the trade form's trade-date rate reads the
same whatever day the check runs.

每次執行都使用全新的資料庫與隨機產生的金鑰與密碼，結束時刪除資料庫；完全不會碰到雲端的 Supabase 專案。

## Where it runs 執行環境

Claude Code cloud sessions: Linux x86-64 as root, with PostgreSQL 16 (`/usr/lib/postgresql/16`),
`psql`, `iconv`, `openssl` (the stand-in push service's throwaway certificate) and Playwright's
Chromium (`/opt/pw-browsers`). It downloads the two release
binaries from GitHub on the first run. It is not meant for a Mac; Hugo does not need to run it.

此檢查供 Claude Code 雲端環境使用（Linux），Hugo 不需要在 Mac 上執行。

Screenshots of each screen and the service logs are kept in `/tmp/invest-e2e` (set `E2E_HOME` to
change it). The run leaves a `.next` build pointing at the stand-in; run `npm run build` again
before `npm start` against the real project.

Two optional outputs: `DOCS_SHOTS=dir` saves the README images into `dir`, and `TEXT_REPORT=file`
writes each page's visible text as JSON: the characters of prose (paragraphs, list items, hints and
banners outside tables, legends and tiles), of summary tiles, and the prose lines themselves, so a
change that adds sentences shows up. What sits folded behind ⓘ is not counted.

另有兩個選用輸出：`DOCS_SHOTS=資料夾` 會存下 README 用的截圖；`TEXT_REPORT=檔案` 會把每頁可見文字的字數（段落、提示與摘要小卡分開計算）與段落內容寫成 JSON，方便檢查文字量是否又變多。收在 ⓘ 內的說明不計入。
