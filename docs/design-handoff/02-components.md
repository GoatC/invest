# 02 Web components

Paths are on `main` as of 2026-11-18. Keep behaviour, data and copy; change only what is listed. Each item
names what the final screen shows on the design canvas page 「甲 定稿方向」.

## Dashboard (`app/page.tsx`)

**Poster (`<section className="hero">`)**
- Ground: `--hero-bg` is now `--surface`; add one `.glow` layer (`data-tone` = up / down / flat from the 7-day move, `--glow-k` from the strength function in 01-tokens) as the poster's first child, plus a near-invisible grain overlay (SVG `feTurbulence`, `mix-blend-mode: overlay`, ~6 % opacity) so the gradient never bands.
- Content, top to bottom: date line 「總市值 · 11/18 收盤」; the value as ONE text run: `NT$` 18 px / 700 / muted, integer 46 px / 800 / tabular / −0.02em, decimals 30 px / 700 / muted; ONE capsule for the 7-day move (`--*-soft` ground, `--*-on-soft` text, ▲ ▼ or 「持平」); the existing edge-to-edge line.
- Remove from the poster: the pools line (一般／大額) and the 累計 chip. The pools move to Holdings (they are already there) and the all-time figure stays in the line's aria-label.
- The line: unchanged geometry (132 px, 3 pt round, dashed zero line); add today's dot at its end in `--up` / `--down` / `--flat` with a 2.5 px ring in `--surface`.

**Rules (`RuleBoard`)**
- Becomes one disclosure row, closed by default: the worst item's badge (red ✕ when anything is 需處理, else amber !), 「規則」, 「N 項需處理」 in `--danger-text` (or 「N 項注意」 in `--warn-text`), one muted summary line naming the rules that fire (「R1 單一個股上限 · 5/25 債券偏離」), a chevron. Use `<details>`/`<summary>` or a button with `aria-expanded`.
- Open: the existing rows (code, name, note, gauge, value) with the app's tones: alert = red ✕ and `--status-critical` gauge, watch = amber ! and `--status-warning`, ok = forget-me-not ✓.
- With nothing firing: ✓ badge, 「全部正常」, still closed.

**Value at Risk (`components/risk-card.tsx`)**: format unchanged (Hugo: keep the app's format). Only the tokens change.

**Order** stays: poster → rules → VaR → watchlist → coming week → donut → windfall → against plan.

## Holdings (`app/holdings/page.tsx`, `app/holdings/overview.tsx`)

- `Summary` stays above the views, two to a row at phone width, drawn as one hairline-ruled block (no card shadows): 一般投入資金池, 大額資金池, 衛星部位占比 (with 「R2 觸發點 25%」), 上市持股未實現損益 (`--up` / `--down` with ▲ ▼).
- The view switch (卡片／排行／買點／板塊／訊號) becomes chips under the summary; the section tabs (總覽／交易／現金流／觀察清單) are the shell's segmented control (see 03).
- Page headline wash: `.glow.page` with the tone of 「昨日」, k fixed at 0.45.

## Performance (`app/performance/page.tsx`)

- Headline 「8.42%」 at 46 px / 800 with the difference against the benchmark beside it (▲ 0.7 pt 對基準).
- Page wash: `.glow.page` toned by the difference against the benchmark, k 0.5.
- Charts: unchanged design; in the shell they are Swift Charts (03).

## Allocation (`app/allocation/page.tsx`)

- `BandRow`: watch = amber outline !, 「留意」 in `--warn-text`; rebalance keeps the red ✕, 「需再平衡」 in `--danger-text`. Fill colours: ok `--accent`, watch `--status-warning`, rebalance `--status-critical`. Band stripe `--accent-soft`, target tick `--text`. Legend: 「超過一半為留意（!），超過容許帶需再平衡（紅色 ✕）」.
- No page wash on Allocation (its headline has no direction).
- 資本市場假設 becomes one row with 「MM/DD 檢視」 and a chevron to `/allocation/assumptions`.
- Donut (`components/allocation-charts.tsx`): no change.

## Account (new: `app/account/page.tsx`)

Opened by the dashboard's person button, in a sheet in the shell (the G05 sheet a glass button opens), as a page in the PWA.

- Head: initial avatar (84 px, `--accent-soft` / `--accent`), display name, signed-in email (from Supabase Auth, never stored in git), a chip 「擁有者 · 單人帳號」.
- 帳號: 顯示名稱, 登入方式 (「Email 登入連結」), 這台裝置 (last sign-in time).
- 偏好: 外觀 (自動／淺色／深色), 漲跌顏色 (紅漲綠跌／綠漲紅跌; sets `data-move` on `<html>`), 推播設定 → `/notifications`.
- 家人共用: one dimmed row 「邀請家人」 with a chip 「尚未開放」 and the note 「目前是單人帳號。開放後每位家人有自己的帳號與資料，彼此看不到。」 No invite flow yet: sharing is a later phase that changes CLAUDE.md's single-user rule and needs per-person rows under RLS.
- 資料: 資料狀態 (✓ last nightly run), 匯入 CSV.
- 登出 as a full-width row in `--danger-text`.
- Where 外觀 and 漲跌顏色 live today (More sheet), link to here instead of duplicating.

## Search (new: `app/search/page.tsx`, `lib/search-index.ts`)

Opened by the search button. Like pulling down on the iPhone home screen: the field is focused and the keyboard is up at once.

- Field: `<input type="search" enterkeyhint="search" autofocus>` styled as the iOS search field (placeholder 「搜尋功能、持股、設定」), 「取消」 closes the sheet. In the shell the field sits where the bar is; the page draws it only in the PWA if a native field is used later.
- Empty: 最近搜尋 (chips, kept in `localStorage`), 建議 (four common destinations), 持股 (holdings that have something to act on first).
- Typing: results grouped 功能 / 持股 / 設定 / 說明, each row an icon, the name with the matched characters in `--accent` bold, and where it lives (「儀表板 › 本週」). Tapping opens the page, the sub-tab, or the ⓘ.
- `lib/search-index.ts`: a pure function building the index from `components/nav-pages.ts` (pages, sub-tabs, groups), holdings (ticker and name), settings rows, and ⓘ titles; each entry has Chinese and English keywords. Unit-test the matcher (e.g. 「風險」 finds 風險值 and 壓力測試; 「VaR」 finds 風險值; 「2330」 finds 台積電).

## More sheet and navigation

- `components/nav-pages.ts`: unchanged structure. Label fix: the timeline row reads 「人生時間軸」.
- `components/tab-bar.tsx` (PWA only): tokens only; the shell's tab bar is native.

## Shared

- Direction text everywhere (holdings rows, performance, summary): `--up` / `--down` plus ▲ ▼; never colour alone.
- Rule and data states keep the app's three icons: red ✕ `--status-critical` (需處理), amber ! `--warn-badge` + `--warn-badge-ink` (留意, data problems), forget-me-not ✓ (正常). Red here always comes with ✕ and words, so it never reads as 漲.
- Numbers: a figure is one text node; never split digits into separate boxes (it breaks when a viewer falls back to a wider font).
- Remove card shadows (`--shadow-soft: none`); lists are hairline-ruled, edge to edge at phone width.
