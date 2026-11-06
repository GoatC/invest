-- N8 volatility alert (added 2026-11-06), step 1: the score.
--
-- A score of 1 (calm) to 10 (panic) from free daily series, which the volatility job
-- (scripts/volatility.ts, twice a day) loads into index_prices under these ids:
--   VIX, VIX3M  CBOE's daily history files (FRED VIXCLS / VXVCLS as fallback)
--   TWVIX       Taiwan's VIX 臺指選擇權波動率指數, TAIFEX's monthly files (three months only)
--   EPU         the US daily economic policy uncertainty index (policyuncertainty.com; FRED USEPUINDXD)
--   HY_OAS      the ICE BofA US high-yield spread, percent (FRED BAMLH0A0HYM2)
-- and the S&P 500 and TAIEX the nightly job already keeps (SPX, TAIEX), their last two weeks also
-- loaded by the volatility job so a score after Taiwan's close sees the session.
--
-- config volatility: each component's calm figure (sub-score 0) and panic figure (sub-score 10),
--   and its weight; the age past which a figure is left out, the share of the weight needed for a
--   score, the 52-week high's window, the sessions of TAIEX's short fall, the days the policy
--   index is averaged over, and the days of each series kept loading. Edited on the Volatility
--   page and logged, like every setting.
-- volatility_scores: the day's score (Taipei date), its weighted mean, the share of the weight
--   counted and each component's figure, written by the job only; the alert rule (step 3) reads
--   the days before to push only when the score crosses its threshold.

insert into public.config (key, value, desc_en, desc_zh) values
  ('volatility', '{
     "components": {
       "vix": {"calm": 12, "panic": 40, "weight": 2},
       "vix_term": {"calm": 0.85, "panic": 1.15, "weight": 2},
       "tw_vix": {"calm": 15, "panic": 45, "weight": 2},
       "spx_drawdown": {"calm": 0.02, "panic": 0.2, "weight": 1},
       "taiex_drawdown": {"calm": 0.03, "panic": 0.25, "weight": 1},
       "taiex_fall": {"calm": 0, "panic": 0.1, "weight": 1},
       "hy_spread": {"calm": 3, "panic": 7, "weight": 1},
       "epu": {"calm": 100, "panic": 500, "weight": 0.5}
     },
     "max_age_days": 5,
     "min_coverage": 0.5,
     "drawdown_days": 365,
     "fall_sessions": 5,
     "epu_days": 7,
     "history_days": 400,
     "last_verified": null
   }',
   'Volatility score (N8): for each component the figure that scores 0 (calm) and 10 (panic) and its weight; figures older than max_age_days are left out, and below min_coverage of the weight there is no score.',
   '波動分數（N8）：各成分得 0 分（平靜）與 10 分（恐慌）的數值及權重；超過 max_age_days 天的數值不計入，涵蓋權重低於 min_coverage 時不計分。');

create table public.volatility_scores (
  score_date date primary key,
  score numeric(3, 1) not null check (score >= 1 and score <= 10),
  mean numeric not null check (mean >= 0 and mean <= 10),
  coverage numeric not null check (coverage > 0 and coverage <= 1),
  components jsonb not null check (jsonb_typeof(components) = 'array'),
  computed_at timestamptz not null default now()
);
comment on table public.volatility_scores is 'The volatility score of each day (N8), 1 calm to 10 panic, written by the volatility job 每日波動分數';
comment on column public.volatility_scores.components is 'Each component: id, value, date of its newest close, sub_score 0–10, weight, status (ok / stale / missing) 各成分數值與分數';

alter table public.volatility_scores enable row level security;
revoke all on table public.volatility_scores from anon, authenticated, service_role;
grant select on table public.volatility_scores to authenticated;
grant select, insert, update, delete on table public.volatility_scores to service_role;
create policy owner_read_only on public.volatility_scores for select to authenticated using ((select private.is_owner()));
