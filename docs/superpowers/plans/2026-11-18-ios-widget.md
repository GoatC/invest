# iOS Home-Screen Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A medium iPhone widget in the iOS shell showing the portfolio's total value (both pools), the 7-day change in percent and the poster's line, from last night's close, behind a read-only key.

**Architecture:** The nightly job (which the refresh button also runs) derives a small figure set from the same daily series the dashboard draws (`buildSeries` → `valueLine`) and saves it in a single-row table. A `security definer` Postgres function hands that row to `anon` only for the right key (stored as a SHA-256 hash); a thin Next.js route `/shell/widget` calls it with the publishable key and the widget's `Authorization: Bearer` key. A WidgetKit extension in the iOS shell fetches the route and draws the figures; the key is typed into the widget's own configuration (no App Group: free signing).

**Tech Stack:** TypeScript (Node test runner via `tsx --test`), Next.js App Router route handler, Supabase Postgres (PGlite in tests), Swift / WidgetKit / App Intents / Swift Charts, xcodeproj Ruby gem.

**Spec:** `docs/superpowers/specs/2026-11-18-ios-widget-design.md`

## Global Constraints

- Free signing only: no App Groups, no Keychain Sharing, no push, no capability a paid Apple account needs; the extension asks for no entitlement.
- Widget bundle identifier `$(BUNDLE_ID).widget`; deployment target iOS `26.0`; iPhone only (`TARGETED_DEVICE_FAMILY = 1`).
- Public repo: no key, figure or holding in git; demo values only in tests, look screenshots and docs.
- Row-level security on every new table, owner policy as in `supabase/migrations/20261118100000_dividends_and_banners.sql`; nothing granted to `anon` except `execute` on `public.widget_figures`.
- The key: 32 random bytes, base64url (43 characters); only its lowercase hex SHA-256 is stored; the original is shown once.
- Thresholds in config: `widget.stale_days` = `3` (new config row), never in code.
- Widget figures: `weekChange` is `valueLine(days).week?.change ?? null`; the line is `valueLine(days).points`, re-sampled to at most `40` values, each rounded to 4 decimals.
- Colours follow config `sectors.colour` (`red_up` by default), always beside ▲ / ▼.
- Widget look: poster blue `#34689c` (dark mode `#1f4f86`), white text, value in SF Rounded with tabular digits, the 7-day chip white with `#c8102e` up / `#1f7a35` down in red-up (swapped in green-up), Swift Charts `LineMark` in white; figures `.privacySensitive()`; `widgetAccentable()` on the value and line.
- Widget text Chinese only (native UI, like the shell's own strings). Web page strings English + 繁體中文 via `<Bi>` per CLAUDE.md; the settings part folds under `<details>`, explanation behind `<Info>`.
- Tap opens `longview://open?path=%2F` (existing `Router`, site paths only).
- Every model function ships with unit tests whose values are added to PRD Section 11.

## Review Focus

- A widget whose key was replaced: the route answers 401 and the widget says the key is no longer valid, not a blank or a crash. (Task 4 test `rejects a replaced key`; Task 6 error state.)
- A database with no snapshot yet (fresh install, fewer than two closes): the route answers 200 with `figures: null` and the widget shows "尚無資料", never 0 or NaN. (Task 2 test `returns figures null`; Task 4 test `passes an empty snapshot through`.)
- A long holiday (Lunar New Year): `asOf` five days back is stale and the date shows ⚠︎; a normal weekend (Friday close read Monday) is not. (Task 1 `isStale` tests.)
- The phone offline or the site down: the widget keeps the last figures it drew and marks the date ⚠︎ instead of replacing them with an error. (Task 6 Step 3 provider behaviour.)
- A malformed `Authorization` header (missing, `Basic …`, empty bearer, a 2 KB string): 401 with no figures and no database call for anything shorter than 43 characters or longer than 128. (Task 4 `readBearer` tests.)

---

### Task 1: Widget figures model

**Files:**
- Create: `lib/models/widget.ts`
- Test: `lib/models/widget.test.ts`
- Modify: `docs/PRD.md` (Section 11 acceptance table: two rows after the N8 rows)

**Interfaces:**
- Consumes: `valueLine`, `sample` from `lib/models/value-line.ts`; `DayPoint` from `lib/models/performance.ts`; `addDays` from `lib/dates.ts`.
- Produces:
  - `export interface WidgetFigures { asOf: string; totalTwd: number; weekChange: number | null; points: number[]; redUp: boolean }`
  - `export function widgetFigures(days: readonly DayPoint[], redUp: boolean): WidgetFigures | null`
  - `export function isStale(asOf: string, today: string, staleDays: number): boolean` (true when `asOf < addDays(today, -staleDays)`)
  - `export const WIDGET_POINTS = 40`

- [ ] **Step 1: Write the failing tests** (reuse the F18 fixture from `lib/models/value-line.test.ts`: 1 share of 0050 at 100 with fee 1 on 2026-01-01, 9 more at 120 in the windfall pool on 2026-04-01, closes 100 / 120 / 120 on 06-27 / 108 on 07-01, `end: '2026-07-01'`)

```ts
describe('widgetFigures', () => {
  it('takes the last close of both pools, the poster\'s 7-day change and its line', () => {
    const figures = widgetFigures(days, true);
    assert.equal(figures?.asOf, '2026-07-01');
    assert.equal(figures?.totalTwd, 1080);
    near(figures?.weekChange, 1080 / 1200 - 1); // −10%, as the poster's chip
    assert.equal(figures?.weekChange, valueLine(days)?.week?.change);
    assert.equal(figures?.redUp, true);
  });
  it('keeps at most 40 points, first 0 and last the cumulative return, 4 decimals', () => {
    const figures = widgetFigures(days, false);
    assert.ok(figures && figures.points.length <= WIDGET_POINTS);
    assert.equal(figures?.points[0], 0);
    assert.equal(figures?.points.at(-1), Math.round((1.2 * 0.9 - 1) * 1e4) / 1e4);
  });
  it('is null until two closes hold a value', () => {
    assert.equal(widgetFigures([], true), null);
  });
  it('has no 7-day change while the series is younger than a week', () => { /* series 2026-01-01..2026-01-03 → weekChange null */ });
});
describe('isStale', () => {
  it('reads a Friday close on Monday as fresh, on Tuesday as stale (3 days)', () => {
    assert.equal(isStale('2026-11-13', '2026-11-16', 3), false);
    assert.equal(isStale('2026-11-13', '2026-11-17', 3), true);
  });
  it('reads a close five days back over a long holiday as stale', () => {
    assert.equal(isStale('2027-02-05', '2027-02-10', 3), true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx --test lib/models/widget.test.ts`
Expected: FAIL, cannot find module `./widget`.

- [ ] **Step 3: Implement `widgetFigures` and `isStale` in `lib/models/widget.ts`**

`totalTwd` is `days.at(-1).value.all` rounded to 2 decimals (the same rounding as `snapshots()` in `lib/models/performance.ts:753`); `points` is `sample(line.points, WIDGET_POINTS)` mapped to `change` rounded to 4 decimals. Header comment: what it is for, citing the spec.

- [ ] **Step 4: Run to verify they pass**

Run: `npx tsx --test lib/models/widget.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the acceptance rows to PRD Section 11**

```
| Widget figures (2026-11-18) | The F18 case: 1 at 100 (fee 1), 9 more at 120 on 04-01 (windfall), 120 on 06-24, 108 on 07-01 | As of 07-01: NT$1,080, 7 days −10.00% (as the poster), at most 40 points from 0 to +8% |
| Widget stale | Close of Friday 2026-11-13, stale after 3 days | Fresh on Monday 11-16, stale on Tuesday 11-17 |
```

- [ ] **Step 6: Commit**

```bash
git add lib/models/widget.ts lib/models/widget.test.ts docs/PRD.md
git commit -m "Widget figures model: last close, the poster's 7-day change and line"
```

---

### Task 2: Database: snapshot, key and the key-checked function

**Files:**
- Create: `supabase/migrations/20261120100000_widget.sql`
- Modify: `tests/db/schema.test.ts` (the table-count test at line 67 and its list at line ~43; a new `describe('widget')`)

**Interfaces:**
- Produces (SQL):
  - `public.widget_snapshot (singleton boolean primary key default true check (singleton), as_of date not null, total_twd numeric not null check (total_twd >= 0), week_change numeric, points jsonb not null check (jsonb_typeof(points) = 'array'), red_up boolean not null, updated_at timestamptz not null default now())`
  - `public.widget_key (singleton boolean primary key default true check (singleton), key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'), created_at timestamptz not null default now())`
  - `public.widget_figures(key text) returns jsonb`, `security definer`, `set search_path = ''`, `stable`: NULL unless `length(key) between 43 and 128` and `encode(sha256(convert_to(key, 'UTF8')), 'hex')` equals `widget_key.key_hash`; otherwise `jsonb_build_object('figures', <snapshot as {as_of,total_twd,week_change,points,red_up}> or null, 'stale_days', (config widget ->> 'stale_days')::int)`. `revoke execute … from public; grant execute … to anon, authenticated, service_role`.
  - Config row `('widget', '{"stale_days": 3}', 'Home-screen widget: a close older than this many days shows ⚠︎', '主畫面小工具：收盤日期早於幾天即標示 ⚠︎')`.
  - Both tables: RLS on, `revoke all … from anon, authenticated, service_role`, `grant select, insert, update, delete … to authenticated, service_role`, policy `owner_full_access` as the dividends migration; table and column comments in English + 中文.

- [ ] **Step 1: Write the failing db tests** (in `tests/db/schema.test.ts`, using `freshDatabase`, `as`, `scalar`)

```ts
describe('widget', () => {
  const KEY = 'a'.repeat(43);
  const HASH = createHash('sha256').update(KEY).digest('hex');
  it('hands anon the figures for the right key only', async () => { /* owner inserts key hash + snapshot; as anon: select public.widget_figures(KEY) -> figures.total_twd equals inserted; widget_figures('b'.repeat(43)) is null; widget_figures('short') is null */ });
  it('returns figures null and the stale days when the key is right but nothing is saved yet', async () => { /* -> {"figures": null, "stale_days": 3} */ });
  it('keeps both tables out of anon\'s reach', async () => { /* select from widget_snapshot / widget_key as anon -> permission denied */ });
  it('lets the nightly job write the snapshot with the service role', async () => { /* upsert as service_role succeeds */ });
});
```

Update the table-count test's name and list with `widget_snapshot` and `widget_key`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx --test tests/db/schema.test.ts`
Expected: FAIL (function / tables missing; count off by 2).

- [ ] **Step 3: Write `supabase/migrations/20261120100000_widget.sql`** as the Interfaces block says, with a header comment in the style of the dividends migration (asked by Hugo on 2026-11-18, what each object is for).

- [ ] **Step 4: Run to verify they pass**

Run: `npx tsx --test tests/db/schema.test.ts`
Expected: PASS, including the existing "refuses anon on every table" and "gives every public table a policy" tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261120100000_widget.sql tests/db/schema.test.ts
git commit -m "Widget tables and the key-checked figures function"
```

---

### Task 3: The nightly job saves the figures

**Files:**
- Modify: `scripts/lib/nightly/job.ts` (`Store` interface near line 143; the snapshot block at lines ~864-886; `JobDetail` near line 192)
- Modify: `scripts/lib/nightly/store.ts` (next to `saveSnapshots`, line ~200)
- Test: `scripts/lib/nightly/job.test.ts` (the fake store near line 373; new tests beside "keeps the prices and reports a partial run when the snapshots fail", line ~764)

**Interfaces:**
- Consumes: `widgetFigures`, `WidgetFigures` (Task 1); the tables (Task 2); `loadSectorSettings` from `lib/data.ts`.
- Produces:
  - `Store.widgetRedUp(): Promise<boolean>` (true unless config `sectors.colour` is `green_up`)
  - `Store.saveWidgetSnapshot(figures: WidgetFigures | null): Promise<void>` (upsert the single row; `null` deletes it)
  - `detail.widget?: { asOf: string } ` on success; on failure push `` `${WIDGET_ERROR}: ${message}` `` to `detail.errors`, with `const WIDGET_ERROR = 'Widget figures 小工具數字'`.

- [ ] **Step 1: Write the failing tests**

```ts
it('saves the widget figures from the same series as the snapshots', async () => {
  // run as the existing snapshot test does
  assert.equal(store.widget?.asOf, '2026-10-21');
  assert.equal(store.widget?.totalTwd, store.snapshots.at(-1)?.totalTwd);
  assert.deepEqual(run.detail.widget, { asOf: '2026-10-21' });
});
it('keeps the snapshots and reports a partial run when the widget figures fail', async () => {
  // FakeStore option failWidget
  assert.deepEqual(run.detail.errors, ['Widget figures 小工具數字: widget_snapshot: permission denied']);
  assert.equal(store.snapshots.length, 2);
});
```

Fake store: `widget: WidgetFigures | null | undefined`, `widgetRedUp()` returns `true`, `saveWidgetSnapshot` throws `widget_snapshot: permission denied` when `options.failWidget`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx --test scripts/lib/nightly/job.test.ts`
Expected: FAIL (`saveWidgetSnapshot` missing).

- [ ] **Step 3: Implement**

In `job.ts`, right after `await store.saveSnapshots(rows)` and inside the same outer `try`, a nested `try` that calls `store.saveWidgetSnapshot(widgetFigures(days, await store.widgetRedUp()))`, so a widget failure never drops the snapshots. In `store.ts`, `saveWidgetSnapshot` upserts `{ singleton: true, as_of, total_twd, week_change, points, red_up, updated_at: new Date().toISOString() }` with `onConflict: 'singleton'`, or deletes `where singleton = true` for `null`, and uses `check('widget_snapshot', error)`. Add `widget` to the run summary only if `summary.ts` lists every detail key (check `scripts/lib/nightly/summary.test.ts`; keep `publicSummary` free of figures, just "Widget figures saved as of <date>").

- [ ] **Step 4: Run to verify they pass**

Run: `npx tsx --test scripts/lib/nightly/job.test.ts scripts/lib/nightly/summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/nightly/job.ts scripts/lib/nightly/store.ts scripts/lib/nightly/job.test.ts scripts/lib/nightly/summary.ts scripts/lib/nightly/summary.test.ts
git commit -m "Nightly job saves the widget figures after the NAV snapshots"
```

---

### Task 4: The `/shell/widget` route

**Files:**
- Create: `lib/widget-api.ts`
- Test: `lib/widget-api.test.ts`
- Create: `app/shell/widget/route.ts`
- Modify: `proxy.ts` (the matcher's negative lookahead: add `shell/widget`)

**Interfaces:**
- Consumes: `isStale` (Task 1); `public.widget_figures` (Task 2); `supabaseEnv()` from `lib/env.ts`; `createClient` from `@supabase/supabase-js`.
- Produces (the JSON the widget reads, Task 6 decodes exactly these names):
  - 200 `{ "figures": { "asOf": "YYYY-MM-DD", "totalTwd": number, "weekChange": number | null, "points": number[], "redUp": boolean, "stale": boolean } | null }`
  - 401 `{ "error": "key" }`, with no figures
  - 502 `{ "error": "database" }`
  - All with `cache-control: no-store`.
- `export function readBearer(header: string | null): string | null` (the token when the header is `Bearer <43–128 chars of [A-Za-z0-9_-]>`, else null)
- `export function widgetReply(row: unknown, today: string): { status: 200 | 401; body: object }` (row is the RPC result: null → 401; `{figures: null}` → 200 `{figures: null}`; otherwise camel-cased figures plus `stale: isStale(asOf, today, stale_days)`)

- [ ] **Step 1: Write the failing tests**

```ts
describe('readBearer', () => {
  it('takes a 43-character base64url key', () => assert.equal(readBearer(`Bearer ${'A_-9'.repeat(10)}abc`), `${'A_-9'.repeat(10)}abc`));
  it('refuses a missing header, Basic, an empty bearer, a short or a 2 KB key', () => {
    for (const header of [null, 'Basic abc', 'Bearer ', `Bearer ${'a'.repeat(42)}`, `Bearer ${'a'.repeat(2048)}`, `Bearer ${'a'.repeat(42)}!`]) assert.equal(readBearer(header), null);
  });
});
describe('widgetReply', () => {
  it('rejects a replaced key', () => assert.deepEqual(widgetReply(null, '2026-11-18'), { status: 401, body: { error: 'key' } }));
  it('passes an empty snapshot through', () => assert.deepEqual(widgetReply({ figures: null, stale_days: 3 }, '2026-11-18'), { status: 200, body: { figures: null } }));
  it('camel-cases the figures and marks a close older than the stale days', () => {
    const reply = widgetReply({ figures: { as_of: '2026-11-13', total_twd: 1080, week_change: -0.1, points: [0, 0.08], red_up: true }, stale_days: 3 }, '2026-11-17');
    assert.deepEqual(reply.body, { figures: { asOf: '2026-11-13', totalTwd: 1080, weekChange: -0.1, points: [0, 0.08], redUp: true, stale: true } });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx --test lib/widget-api.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `lib/widget-api.ts` and `app/shell/widget/route.ts`**

The route: `export const dynamic = 'force-dynamic'`; `GET(request)` → `readBearer(request.headers.get('authorization'))`; null → 401 without touching the database; else `createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } }).rpc('widget_figures', { key })`; an error → 502; otherwise `widgetReply(data, taipeiToday)`. Today in Taipei as `scripts/nightly.ts:22` computes it. Add `shell/widget` to the matcher in `proxy.ts` so the login redirect never runs for it, with a comment saying why (the widget has no session; the key is checked by the database).

- [ ] **Step 4: Run to verify they pass, and that the rest still builds**

Run: `npx tsx --test lib/widget-api.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/widget-api.ts lib/widget-api.test.ts app/shell/widget/route.ts proxy.ts
git commit -m "Route /shell/widget: the figures for the widget's key, no session"
```

---

### Task 5: Making the key on the push page

**Files:**
- Modify: `app/notifications/actions.ts` (new action)
- Create: `app/notifications/widget-key.tsx` (client component)
- Modify: `app/notifications/page.tsx` (load `widget_key.created_at`; render the part after `<ShellReminders />`)
- Modify: `lib/data.ts` only if a loader is the house pattern for a single read (`loadWidgetKeyDate(supabase): Promise<string | null>`), else read inline as the page reads config.

**Interfaces:**
- Consumes: `public.widget_key` (Task 2).
- Produces:
  - `export interface WidgetKeyState { key: string | null; message: Bilingual | null; ok: boolean }`
  - `export async function makeWidgetKey(_previous: WidgetKeyState): Promise<WidgetKeyState>` (`requireSession()`; `randomBytes(32).toString('base64url')`; upsert `{ singleton: true, key_hash: sha256 hex, created_at: now }` on `singleton`; returns the key once; a save error → `saveFailed(error.message)`)
  - `<WidgetKey createdAt={string | null} />` using `useActionState(makeWidgetKey, …)`

- [ ] **Step 1: Build the part**

A `<section className="card form">` with `<h2><Bi en="Home-screen widget" zh="主畫面小工具" /></h2>`, an `<Info>` holding the steps (long-press the widget → Edit Widget → paste; a new key ends the old one), and a `<details>` holding: the created date when there is one (`<Bi en="Key made" zh="鑰匙建立於" />` + `TaipeiTime`), the button (`Make a key 產生鑰匙` with none, `Replace the key 換一把鑰匙` with one; replacing asks `window.confirm` in Chinese, "舊鑰匙會立刻失效"), and after a success the key in a read-only `<input>` with a Copy 拷貝 button (`navigator.clipboard.writeText`) and one line `只顯示這一次`. Every tap target at least 44px.

- [ ] **Step 2: Check it**

Run: `npm run typecheck && npm test`
Expected: clean, all tests pass.
Then look at `/notifications` at 390px wide and run the e2e TEXT_REPORT (`npm run test:e2e`, see `tests/e2e/README.md`): the new part adds a heading, a folded summary and at most two short lines when open.

- [ ] **Step 3: Commit**

```bash
git add app/notifications lib/data.ts
git commit -m "Push page: make or replace the widget's key, shown once"
```

---

### Task 6: The WidgetKit extension

**Files:**
- Create: `ios/Widget/LongViewWidget.swift` (`@main` widget bundle, the widget, its `AppIntent` and timeline provider)
- Create: `ios/Widget/WidgetFigures.swift` (the `Codable` reply and the fetch)
- Create: `ios/Widget/FiguresView.swift` (the SwiftUI view; compiled into both targets)
- Create: `ios/Widget/Info.plist`
- Modify: `ios/project.rb` (new target, embed, dependency, shared file)
- Regenerate: `ios/LongView.xcodeproj` with `ruby ios/project.rb`
- Modify: `ios/Shell/AppDelegate.swift` (`SceneDelegate.sceneDidBecomeActive` → `WidgetCenter.shared.reloadAllTimelines()`)
- Modify: `ios/Shell/ShellViewController.swift` (`runLookScript`: a `widget` step) and `ios/tests/look.sh` (`14-widget` in `NAMES`, `widget` at the end of `SCRIPT`)
- Modify: `.github/workflows/ios.yml` ("What was built": `test -d "$app/PlugIns/LongViewWidget.appex"`)

**Interfaces:**
- Consumes: the route's JSON (Task 4) exactly as named there; `Router.handle(_:)` via the `longview://open?path=%2F` URL.
- Produces:
  - `struct Figures: Codable { let asOf: String; let totalTwd: Double; let weekChange: Double?; let points: [Double]; let redUp: Bool; let stale: Bool }`
  - `enum WidgetState { case figures(Figures, offline: Bool), empty, noKey, badKey }`
  - `struct FiguresView: View { let state: WidgetState }` (medium-family layout)
  - `struct KeyIntent: WidgetConfigurationIntent` with one `@Parameter(title: "鑰匙") var key: String?`

- [ ] **Step 1: Target and plist**

`ios/Widget/Info.plist`: `CFBundleDisplayName` 長期投資, `CFBundleExecutable`/`CFBundleIdentifier`/`CFBundleVersion`/`CFBundleShortVersionString` from build settings as in `ios/Shell/Info.plist`, `SiteHost` = `$(SITE_HOST)`, `NSExtension` → `NSExtensionPointIdentifier` = `com.apple.widgetkit-extension`. In `project.rb`: `project.new_target(:app_extension, 'LongViewWidget', :ios, '26.0')` with the `ios/Widget/*.swift` files; settings `INFOPLIST_FILE = Widget/Info.plist`, `GENERATE_INFOPLIST_FILE = NO`, `PRODUCT_BUNDLE_IDENTIFIER = $(BUNDLE_ID).widget`, `PRODUCT_NAME = LongViewWidget`, `SWIFT_VERSION = 5.0`, `TARGETED_DEVICE_FAMILY = 1`, `CODE_SIGN_STYLE = Automatic`, `SKIP_INSTALL = YES`, `APPLICATION_EXTENSION_API_ONLY = YES`, no `DEVELOPMENT_TEAM`; the app target depends on it and embeds it in a copy-files phase to `PlugIns` (`dst_subfolder_spec = '13'`); `FiguresView.swift` also added to the app target. Run `ruby ios/project.rb`.

- [ ] **Step 2: The view** (`FiguresView.swift`)

Layout as the spec's sketch: top row 總市值 on the left, `M/d 收盤` on the right (plus ⚠︎ when `stale` or `offline`); the value `NT$ 1,234,567` (`Locale(identifier: "zh_Hant_TW")`, no decimals) in `.system(size: 30, weight: .bold, design: .rounded).monospacedDigit()`; under it the chip `▲ 1.23%` / `▼ 1.23%` (2 decimals, `—` when `weekChange` is nil) with 近 7 天 beside it; the line on the right half as a Swift Charts `LineMark` over `points` (white, 2 pt, no axes). `.containerBackground(for: .widget) { Color("poster") }`, where the poster colour is defined in code as the two values in Global Constraints by `colorScheme`. Value, chip and chart get `.privacySensitive()`; value and line get `.widgetAccentable()`. One line for each other state: `.empty` 尚無資料, `.noKey` 長按 → 編輯小工具，貼上鑰匙, `.badKey` 鑰匙已失效，請到 更多 → 推播 換一把.

- [ ] **Step 3: Provider and fetch** (`LongViewWidget.swift`, `WidgetFigures.swift`)

`AppIntentTimelineProvider`: no key → `.noKey`; fetch `https://<SiteHost>/shell/widget` with `Authorization: Bearer <key>` and a 15 s timeout; 401 → `.badKey`; 200 with `figures: null` → `.empty`; network or 5xx failure → the last figures kept by the provider for this key (an in-memory/`UserDefaults` copy inside the extension's own container is fine: it is the extension's, no App Group) with `offline: true`, else `.empty`. Policy `.after(min(next 23:30 Asia/Taipei, now + 3 h))`. `placeholder` and the gallery snapshot use demo figures (`totalTwd: 1_234_567`, `weekChange: 0.0123`, a gentle rising line) — never a real figure. Widget: `AppIntentConfiguration(kind: "LongViewTotal", intent: KeyIntent.self, provider:)`, `.configurationDisplayName("總市值")`, `.description("總市值與近 7 天漲跌")`, `.supportedFamilies([.systemMedium])`, `.widgetURL(URL(string: "longview://open?path=%2F"))`.

- [ ] **Step 4: The app reloads the widget and the look test shows it**

`SceneDelegate.sceneDidBecomeActive(_:)` calls `WidgetCenter.shared.reloadAllTimelines()` (import WidgetKit). In `runLookScript`, a step `widget` presents a `UIHostingController(rootView: FiguresView(state: .figures(demo, offline: false)).frame(width: 364, height: 170))` centred on a grey ground, light then dark not required; add `14-widget` / `widget` to `look.sh`.

- [ ] **Step 5: Build on GitHub Actions**

Push the branch, then wait for the "iOS shell build" workflow (both Xcodes and `look`) to pass. Read `14-widget` from the `look` job's log and check it against Step 2. Run `bash ios/tests/scripts.sh` locally first (bash 3.2 rules for any script change).
Expected: `BUILD SUCCEEDED` on both runners, the `.appex` present, the widget screenshot matching the layout.

- [ ] **Step 6: Commit**

```bash
git add ios .github/workflows/ios.yml
git commit -m "iOS widget: total value, 7-day change and the line, behind the widget key"
```

---

### Task 7: Docs and pull request

**Files:**
- Modify: `docs/ios-app.md` (new section 「主畫面小工具」 after section 9; three items appended to section 10's checklist; the maintainers' notes)
- Modify: `docs/PRD.md` (Section 5 "Phone redesign" step 8: a sub-item "Widget 主畫面小工具 (2026-11-18)"; Section 7 data model: `widget_snapshot`, `widget_key`)

- [ ] **Step 1: Write the docs**

`docs/ios-app.md`, in plain Traditional Chinese for Hugo: what the widget shows and that it is last night's close; reinstall once with `./ios/install.sh` (the widget comes with the app; it uses one more of the free account's 10 app identifiers, the first time only); make a key at 更多 → 推播 → 主畫面小工具; add the widget (long-press the home screen → 編輯 → 加入小工具 → 長期投資); long-press it → 編輯小工具 → paste the key; a lost or leaked key is replaced there and the old one stops at once; when locked the figures are hidden. Checklist items: the widget shows figures after pasting the key; locked, the figures are masked; tapping opens the dashboard. Maintainers: the files and the data path (nightly job → `widget_snapshot` → `widget_figures` → `/shell/widget` → `ios/Widget`).

- [ ] **Step 2: Full check**

Run: `npm run typecheck && npm test`
Expected: clean, all tests pass.

- [ ] **Step 3: Commit, push, open the pull request to main**

```bash
git add docs/ios-app.md docs/PRD.md
git commit -m "Docs: the home-screen widget"
git push -u origin claude/determined-lamport-qihdys
```

Open the PR (check for a PR template first) with what only Hugo's phone can show: adding the widget, pasting the key, the locked mask, the tap into the dashboard. Say that the migration must be applied to Supabase (as earlier migrations, per `docs/supabase-setup.md`) and that the widget shows 尚無資料 until the next nightly run or a tap on 更新最新資料.
