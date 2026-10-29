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
- All UI text bilingual: English + 繁體中文.
- Every model function ships with unit tests using the acceptance values in PRD Section 11.
- Explain each setup step to Hugo in plain Traditional Chinese before running it; he is new to deployment.
- When a build step is finished, tested and pushed, open a pull request to main without asking; Hugo merges it.
