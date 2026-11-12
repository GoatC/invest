# Long-View Investment App
Read docs/PRD.md before any task. Build phase by phase; never start a phase before its gate passes.

Stack: Next.js (App Router) PWA on Vercel; Supabase (Postgres, Auth, Edge Functions);
GitHub Actions cron for nightly jobs; Web Push (VAPID); Apache ECharts.

Rules:
- Single user. Row-level security on every table.
- L2 only: never place trades, never store broker credentials.
- Public repo: no secrets, holdings or windfall figures in git; demo seed data only.
- Keep all API keys in .env.local (git-ignored) and in each service's secret settings.
- Store money in trade currency plus the day's FX rate; report in TWD.
- Thresholds live in the rules / config tables, never hard-coded.
- Chinese first (asked by Hugo on 2026-11-09): every UI string is still written in English + 繁體中文, but a page shows both only for a name — a field, a column, a figure's label, a button, a link (e.g. "Regular pool 一般投入資金池", "FX rate (TWD per 1 unit) 匯率（每 1 單位兌台幣）"). Sentences, notes, messages and lines carrying figures show in Chinese alone. lib/i18n.ts `textMode` decides it for every page (`<Bi>`, `bi()`); pass `label` to keep a long label bilingual. The navigation buttons and page titles (h1) show Chinese only; their accessible names keep the English. On a phone (under 760px) every name shows Chinese alone too (Hugo, 2026-11-10); the English stays for wider screens.
- Phone first (Hugo uses the app mostly on a phone; decided 2026-11-10, PRD Section 5 "Phone redesign"): a page's first screen shows figures, not a form; tiles sit two to a row; a row of choices stays on one line and slides sideways; a table of more than three columns shows as a card per row (globals.css "Row cards", components/table-cards.tsx); nothing to tap is smaller than 44px. Look at a new or changed page at 390px wide before opening its pull request.
- Warnings are tiles, not sentences: an R1/R2 breach, a shortfall, a left-out class or a data problem shows as an alert tile (components/alert-tiles.tsx: icon, code, name, figure, a gauge against the limit, a few short chips), never as a paragraph.
- Few words (PRD design principle 6, the 2026-10-28 cut of about 85%): a page shows labelled figures as tiles with a status icon and short lines, never paragraphs; explanations, methods, sources and footnotes go behind ⓘ (components/info.tsx); settings forms, edit histories and long lists fold under a <details>. Tables keep short column names and short row labels. A new or changed page shows about a fifth of the text a paragraph-style page would: check it with the e2e TEXT_REPORT before opening its pull request. Push texts: a title and one line, in Chinese.
- One entry per fact (Hugo, 2026-11-12): a buy or a sell is recorded once, as a trade, and the cash-flow book reads it (lib/models/cash-flows.ts); cash_flows holds only what no trade tells: the windfall arriving, dividends, withdrawals. Never ask Hugo to type the same money twice.
- The app leads the next step (Hugo, 2026-11-12): something that waits on Hugo (a dividend to record, a rule warning, a setup step) also shows as the in-app banner under the header, one line with a button to where it is done; lib/models/banners.ts decides when, config `banners` holds its thresholds. A new thing to act on gets its banner there, not a sentence on some page.
- Every model function ships with unit tests using the acceptance values in PRD Section 11.
- Explain each setup step to Hugo in plain Traditional Chinese before running it; he is new to deployment.
- When a build step is finished, tested and pushed, open a pull request to main without asking; Hugo merges it.
