# End-to-end check 端對端檢查

`npm run test:e2e` builds the app, runs it against a local stand-in for Supabase loaded with the
migrations and the demo seed, and walks through it in Chromium: the web app manifest, icons and
security headers, sign-in, the holdings view and its
R1 / R2 figures, adding, editing and deleting a trade, a refused oversized sell, gold and cash
balances, cash flows (a USD dividend, the windfall arriving, an edit and a delete), adding a
security, a Big5 broker-statement import (including a dividend row, an unknown ticker and a
second import of the same file), trade-date FX rates, the performance page (TWR against the SAA
benchmark, XIRR, the monthly and per-holding FX split, a chart tooltip, the windfall pool alone,
dark mode), the data status page, a phone-width check of every page, and sign-out. With a
`FINMIND_TOKEN` in the environment it then runs the real nightly job (`scripts/nightly.ts`, live
feeds) against the stand-in twice, the second time as on GitHub Actions, and checks what the app
shows, the NAV snapshots included; `E2E_NIGHTLY=0` skips that part.

`npm run test:e2e` 會建置 App，連到載入資料庫遷移與示範資料的本機 Supabase 替身，並以 Chromium 實際操作一遍：App 安裝設定檔、圖示與安全標頭、登入、持倉總覽與 R1／R2 數字、新增／修改／刪除交易、拒絕超賣、黃金與現金餘額、現金流（美元股利、大額資金入帳、修改與刪除）、新增證券、Big5 券商對帳單匯入（含股利列、未知代號與重複匯入）、交易日匯率、績效頁（時間加權報酬與 SAA 基準、XIRR、每月與各持股的匯率拆解、圖表提示框、只看大額資金池、深色模式）、資料狀態頁，以及手機寬度檢查與登出。環境變數有 `FINMIND_TOKEN` 時，接著以真實資料對替身執行兩次每夜排程（第二次模擬 GitHub Actions），並檢查 App 顯示的結果（含淨值快照）；設 `E2E_NIGHTLY=0` 可略過。

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
`psql`, `iconv` and Playwright's Chromium (`/opt/pw-browsers`). It downloads the two release
binaries from GitHub on the first run. It is not meant for a Mac; Hugo does not need to run it.

此檢查供 Claude Code 雲端環境使用（Linux），Hugo 不需要在 Mac 上執行。

Screenshots of each screen and the service logs are kept in `/tmp/invest-e2e` (set `E2E_HOME` to
change it). The run leaves a `.next` build pointing at the stand-in; run `npm run build` again
before `npm start` against the real project.
