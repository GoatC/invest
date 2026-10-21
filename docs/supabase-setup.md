# Supabase 設定 Supabase setup

第一階段第 2 步（PRD 第 11 節）：在 Supabase 建立資料庫，套用 `supabase/migrations/` 裡的資料庫結構，再從外面確認陌生人讀不到任何資料。

Phase 1, step 2: create the Supabase project, apply the migrations in `supabase/migrations/`, and confirm from the outside that a stranger can read nothing.

## 會建立什麼 What gets created

- **21 張資料表**：PRD 第 7 節的 19 張，加上推播訂閱 `push_subscriptions` 和修改紀錄 `audit_log`（N5 要求每筆修改與刪除都留紀錄）。
- **預設資料**，全部來自 PRD、不含個人資料：8 個資產類別與目標權重、10 檔核心證券、第 4 節的 14 條規則（第二階段的規則先停用）、6 項設定。
- **權限**：只有「擁有者」，也就是你的帳號，能讀寫資料；沒登入的人和其他帳號什麼都看不到。每夜排程之後會用 secret key，它不受這個限制。
- **示範資料** `supabase/seed.sql` 只用在本機測試，`db push` 不會把它送到你的專案。

Tables: the 19 from PRD Section 7 plus `push_subscriptions` and `audit_log`. Reference data comes from the PRD only. Only the owner can read or write; the demo seed never leaves your machine.

## 1. 建立專案 Create the project（只需一次）

1. 登入 <https://supabase.com/dashboard>，按 **New project**。
2. 填寫：
   - **Organization**：你的個人組織（Free 方案）。
   - **GitHub (optional)**：先不要連。連上後，每次合併到 main，Supabase 會自動套用資料庫變更；第一次部署先用指令手動做，每一步都看得到。之後想自動化，可以在專案的 Integrations 設定再連，不必重建專案。
   - **Project name**：`long-view-invest`。
   - **Database password**：按 **Generate a password** 產生，再按 **Copy**，**存進密碼管理器**（例如 Mac／iPhone 的「密碼」App）。不要用生日之類的日期。第 3 步會用到一次；它不放進任何檔案。
   - **Region**：選 **Northeast Asia (Tokyo)**，離台灣最近；如果選單只有 **Asia-Pacific** 這種大區，選它也可以。
   - **Security**：
     - **Enable Data API**：保持勾選。網頁 App 透過它讀寫資料，仍受 row-level security 保護。
     - **Automatically expose new tables**：**取消勾選**。每張資料表的存取權限由 migration 明確設定。
     - **Enable automatic RLS**：**勾選**。之後新建的資料表都會自動開啟 row-level security，多一層保險；已實測與這裡的 migration 相容。
3. 按 **Create new project**，等一兩分鐘建立完成。

## 2. 記下專案網址與 publishable key

- **Project ref（專案代碼）**：瀏覽器網址 `https://supabase.com/dashboard/project/<project-ref>` 裡的那串英數字。
- **Project URL 與 publishable key**：按儀表板上方的 **Connect**，或到 **Project Settings → API Keys**。publishable key 以 `sb_publishable_` 開頭。
- 在 `invest` 資料夾執行 `open -e .env.local`，填入：

  ```bash
  NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
  ```

- 這兩個值本來就是公開的，之後網頁也會用到。**secret key（`sb_secret_` 開頭）現在不要複製**：第 4 步每夜排程才需要，而且只放在 GitHub 的 secret 設定裡。

## 3. 套用資料庫結構 Apply the schema

在 `invest` 資料夾先取得最新程式，再套用：

```bash
git checkout -- reports/source-check   # 丟掉本機跑出的報告變更（GitHub 上已有正式版本）
git checkout main && git pull           # 第 2 步合併前改用 git checkout claude/peaceful-knuth-gzi48q
npm install
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

- `npm install`：安裝這一步新增的工具（Supabase CLI 與測試用的 PGlite），只裝在專案資料夾裡。
- `npx supabase login`：開瀏覽器授權這台 Mac 使用你的 Supabase 帳號。授權碼存在 Mac 的鑰匙圈，不會進 git。
- `npx supabase link`：把這個資料夾連到你的專案，會要你輸入第 1 步的資料庫密碼。
- `npx supabase db push`：列出 4 個 migration，輸入 `Y` 後依序套用。之後再執行會顯示已是最新，不會重複套用。

`db push` applies the four migrations in order and records them, so a second run changes nothing.

## 4. 建立你的帳號並關閉註冊 Create your account, close sign-ups

1. **Authentication → Users → Add user → Create new user**：填你的 email 與一組新密碼（存進密碼管理器），勾選 **Auto Confirm User**。
2. **Authentication → Sign In / Providers**：關閉 **Allow new users to sign up**。之後別人就無法自己註冊帳號。

## 5. 設定擁有者 Make yourself the owner（只需一次）

在 **SQL Editor → New query** 貼上下面的 SQL，把 email 換成你的，按 **Run**：

```sql
insert into private.app_owner (user_id)
select id from auth.users where email = 'you@example.com';

select count(*) as owners from private.app_owner;
```

結果應該顯示 `owners` 為 `1`。這個 email 只存在你的專案裡，不會進 git。

## 6. 從外面驗證 Verify from the outside

```bash
npm run check:supabase
```

它只用第 2 步的公開網址和 publishable key，模擬陌生人去讀每一張資料表。應該看到 22 項全部 ✅：21 張資料表都拒絕存取，私有的 `private` schema 也沒有對外開放。有任何 ❌ 都要先修正，才能輸入真實持股。

The check sees exactly what a stranger sees; every table must refuse and the private schema must stay hidden.

全部 ✅ 之後，請接著看 [執行 App](running-the-app.md)。 Next: [Running the app](running-the-app.md).

## 補充 Notes

- 儀表板的 **Table Editor** 看得到所有資料：它用資料庫管理員身分，不受 row-level security 限制。陌生人走的是 Data API，會被擋下。
- 之後要改資料庫結構時，會新增一個 migration 檔，再執行一次 `npx supabase db push`。
- `npm test` 會在記憶體裡的 PostgreSQL（PGlite）從零重建整個資料庫，並檢查每一條權限，不需要 Docker。
- 在 Claude 雲端環境執行 `npm run check:supabase` 時，前面要加 `NODE_USE_ENV_PROXY=1`。
