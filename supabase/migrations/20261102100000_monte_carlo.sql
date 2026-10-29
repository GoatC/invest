-- Phase 3, step 1 (F5): the Monte Carlo simulation.
--
-- monte_carlo (config): 10,000 paths bootstrapped from the last lookback_years of the classes'
--   benchmark ETFs' monthly TWD returns, block_months consecutive months at a time; scale_to_cma
--   scales each class's swings to its CMA volatility (its mean is always its CMA expected return);
--   min_months is the least history a run needs; band is the fan's outer percentiles; mark_years
--   are the years the figures are read at (10, 20, 30); target_twd is the goal in today's money,
--   set on the page; windfall is an expected windfall (amount, the month it arrives, tranches) for
--   when no F3 plan is saved yet. Both stay null here: no windfall figures in git.
--
-- simulation_runs: one row per model and run date, written by the nightly job once a month (the
--   monthly re-run) and read by the weekly dashboard in the week it updates. The summary holds
--   the inputs and the marks' figures, so a later run can be compared with an earlier one.

insert into public.config (key, value, desc_en, desc_zh) values
  ('monte_carlo', '{
     "paths": 10000,
     "lookback_years": 5,
     "block_months": 3,
     "min_months": 36,
     "scale_to_cma": true,
     "band": [0.1, 0.9],
     "mark_years": [10, 20, 30],
     "target_twd": null,
     "windfall": {"amount_twd": null, "month": null, "tranches": 12}
   }',
   'Monte Carlo (F5): paths, the years of history the months are drawn from, the block of consecutive months drawn at a time, the fewest months a run needs, whether swings are scaled to the CMA volatility, the fan''s outer percentiles, the years the figures are read at, the goal in today''s money, and an expected windfall (amount, month it arrives, tranches) used until an F3 plan is saved.',
   '蒙地卡羅（F5）：路徑數、抽樣月報酬的歷史年數、每次連續抽取的月數、執行所需的最少月數、是否把波動縮放到資本市場假設的波動度、扇形圖外緣百分位、讀取數字的年數、以今天幣值計的目標，以及尚未儲存 F3 計畫前使用的預期大額資金（金額、入帳月份、分批數）。');

create table public.simulation_runs (
  id bigint generated always as identity primary key,
  model text not null check (model ~ '^[a-z][a-z0-9_]*$'),
  run_date date not null,
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  unique (model, run_date)
);
comment on table public.simulation_runs is 'Monthly model re-runs (F5): the inputs and the figures at the marks 每月模型重跑結果';
comment on column public.simulation_runs.model is 'monte_carlo for F5 模型代號';

alter table public.simulation_runs enable row level security;
revoke all on table public.simulation_runs from anon, authenticated, service_role;
grant select on table public.simulation_runs to authenticated;
grant select, insert, update, delete on table public.simulation_runs to service_role;
create policy owner_read_only on public.simulation_runs for select to authenticated using ((select private.is_owner()));
