# Code map

Where things live, so a task opens the right files without a search. Feature IDs (F2, N5…) are the PRD's ([docs/PRD.md](PRD.md)); each has its spec section in [docs/prd/](prd/).

## Layers

| Folder | What it holds | Rule of thumb |
| --- | --- | --- |
| `app/<route>/` | `page.tsx` (server component: loads, works out, renders), `forms.tsx` / `*-form.tsx` (`'use client'`, checked as typed with the server's own parser), `actions.ts` (server actions: parse, save, redirect) | A page reads through `lib/data`, computes through `lib/models`, never queries Supabase itself |
| `lib/models/<feature>.ts` | Pure functions, one file per feature, each with its `.test.ts` holding the PRD's acceptance values | No I/O; config is read with the model's own `read…Settings` (defensive) |
| `lib/data/<feature>.ts` | Supabase reads and writes per feature; `core.ts` has `DataError`, `rows` / `allRows` (paged) and why loaders are wrapped in React `cache` | One read per render; a failed read throws `DataError` (pages show `<DataProblem>`) |
| `lib/validation.ts` | Form parsers shared by browser and server, a section per feature (`MESSAGES` and the helpers first) | One file on purpose: the browser's forms share it as one chunk, preloaded once; split into modules, the bundler copied the messages into every form page. The server action parses again: it never trusts the browser |
| `lib/*.ts` | Cross-cutting: `i18n.ts` (`textMode`, `LABELS`), `format.ts`, `dates.ts` (Taipei dates), `auth.ts` (`requireSession`), `action-redirect.ts` (save → clear the preload → redirect), `shell.ts` (iOS shell contract), `native-chart.ts`, `proposal-text.ts` / `rule-text.ts` (warning words), `push.ts`, `csv/` (statement import), `search-index.ts`, `theme.ts` | |
| `components/` | Shared UI: `bi.tsx` (bilingual text), `facts.tsx` (figure tiles), `info.tsx` (ⓘ, method notes), `alert-tiles.tsx` (warnings as tiles), `table-cards.tsx` (row cards on a phone), `history.tsx` (edit history), `edit-foot.tsx` (an edit page's delete and history), `use-fields.tsx` / `use-field-inputs.tsx` (a form checked as typed), `echarts.tsx` + `echarts-core.ts` (charts, fetched apart), charts per feature (`*-charts.tsx`) | A client component lives in its own file, so a page carries only the scripts it uses |
| Navigation | `components/nav-pages.ts` is the one list of pages and tabs; `site-nav.tsx` (pills, sub-tabs), `tab-bar.tsx` (glass bar), `preload.tsx` (fetches every listed page on open), `splash.tsx`, `shell-bridge.tsx` (tells the iOS shell where the page is) | A new page reached from a tab, sub-tab or More goes in `nav-pages.ts` |
| `app/globals.css` | All styles, by section: tokens first (light "ink", dark), phone rules under `@media (max-width: 759px)`, shell-only rules under `html[data-shell]` | |
| `scripts/` | Jobs GitHub Actions runs: `nightly.ts` (prices, FX, filings, scans → rules → pushes), `volatility.ts`, `news.ts`, `notify.ts`; their logic in `scripts/lib/<job>/`, feeds in `scripts/lib/feeds/`. Tools: `check_sources.ts`, `check_supabase.ts`, `vapid_keys.ts`, `splash_images.ts`, `ios_images.ts` | Scripts import `lib/` with relative `.ts` paths (no `@/`) |
| `supabase/` | `migrations/` (the schema, in order; never edit an applied one, add a new file), `seed.sql` (demo data only) | RLS on every table |
| `ios/` | The native shell (Swift): one web view under the system tab bar ([docs/ios-app.md](ios-app.md)) | Built by the "iOS shell build" workflow |
| `tests/` | `db/` (schema and RLS on PGlite), `e2e/` (`run.sh` stands up Supabase locally and `drive.mjs` walks every page; `bench.mjs` times tab switches) | |

## Feature → files

| Feature | Page | Model (`lib/models/`) | Data (`lib/data/`) | Parser (`lib/validation.ts`) |
| --- | --- | --- | --- | --- |
| Dashboard, poster | `app/page.tsx`, `app/banner.tsx` | `value-line`, `glow`, `banners` | `poster`, `banners` | |
| N5 holdings, trades, cash flows | `app/holdings/`, `app/securities/`, `app/assets/`, `app/cash-flows/`, `app/import/`, `app/history/` | `positions`, `portfolio`, `valuation`, `cash-flows`, `holding-view`, `splits`, `fx`, `price-history`, `manual-history` | `holdings`, `audit` | parseTrade, parseSecurity, parseManualAsset, parseCashFlow, parseSplitForm |
| Dividends | `app/dividends/`, `app/cash-flows/new/` | `dividends` | `dividends` | parseCashFlow |
| N4 Value at Risk | `components/risk-card.tsx`, `components/risk-details.tsx`, `app/risk/` | `risk` | `risk` | |
| F6 targets, N6 donuts, F8 drift | `app/allocation/` | `allocation`, `cma`, `auto-cma` | `allocation`, `auto-cma` | parseTargets, parseAssumptionForm, parseAutoCmaForm |
| F7 frontier · F10 stress | `app/frontier/` · `app/stress/` | `frontier` · `stress` | `frontier` · `stress` | parseFrontierForm · — |
| F14 look-through · N7 sectors | `app/look-through/` · `app/sectors/` | `look-through` · `sectors` | `look-through` · `sectors` | parseLookThroughForm · parseSectorForm |
| F18 performance · N2 attribution | `app/performance/` · `app/attribution/` | `performance`, `market` · `attribution` | `performance`, `market` · `attribution` | |
| F15 costs and tax | `app/costs/` | `costs`, `tax` | `costs` | parseFeeForm, parseTaxForm, parseBrokerForm, parseFundForm |
| F2 · F5 · F1 · F3 (life planning) | `app/plan/` · `app/monte-carlo/` · `app/timeline/` · `app/windfall/` | `projection` · `monte-carlo` · `timeline` · `windfall` | `planning`, `windfall` | parsePlanForm · parseMonteCarloForm · parseTimelineForm · parsePlanStart, parseWindfallSettingsForm, parsePaceForm |
| N1 regression · F11 cost of equity | `app/regression/` · `app/capm/` | `regression`, `five-factor` · `capm` | `regression` · `capm` | parseRegressionForm · parseCapmForm |
| F12 valuation | `app/valuation/` | `intrinsic`, `workbench`, `valuation`, `forward-pe`, `fundamentals` | `valuation` | parseAssumptionsForm, parseValuationSettingsForm, parseEstimatesForm |
| N3 red flags | `app/red-flags/` | `red-flags` | `red-flags` | parseFlagEntryForm, parseFlagSettingsForm |
| N8 volatility, events, news | `app/volatility/` | `volatility`, `events`, `news`, `shadow` | `volatility` | parseVolatilityForm, parseEventForm, parseNewsForm |
| Rules engine, warnings | `app/rules/`, `app/proposals/`, `components/warnings-panel.tsx` | `engine`, `rules` | `rules`, `engine` | parseRuleForm, parseEngineSettings |
| Web Push, weekly review, reminders | `app/notifications/`, `app/shell/reminders/`, `public/sw.js` | `notify`, `local-reminders` | `notify` | parseSubscription, parseSchedule |
| Data status | `app/data/`, `components/data-toast.tsx` | `data-health` | `status` | |
| Widget | `app/shell/widget/`, `lib/widget-api.ts` | `widget` | | |
| Account, search, theme | `app/account/`, `app/search/` | | | |

## Checks

- `npm test` (unit and schema tests) and `npm run typecheck` (refuses unused locals) after every change.
- `npm run test:e2e` builds the app and walks it in Chromium against a local Supabase stand-in (`E2E_NIGHTLY=0` skips the live feeds; `TEXT_REPORT=<file>` writes each page's visible text length; screenshots land in `$E2E_HOME/shots`). In an agent session Next 16.4 stops the first `next build` to show an upgrade notice and lets the next one within five minutes through: build once, then run the check.
- Open work: the Ink handoff's last step (names in Chinese alone, docs/design-handoff/05-tasks.md step 10) is not built yet.
