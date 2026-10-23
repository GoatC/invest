-- Phase 2, step 1 (F3): the windfall tranche planner.
--
-- market_series: monthly market-level series the planner reads, loaded by the nightly job with the
--   secret key: us_cape (Shiller's CAPE, the valuation gauge), sp500_price (the month's average
--   close) and sp500_yield (the year's dividends over that price), from Shiller's online data with
--   multpl.com as the fallback. The owner reads them; only the job writes them. The backtest of
--   lump sum vs this rule runs on them.
-- ACWI: the iShares MSCI ACWI ETF, the free proxy for MSCI ACWI whose fall from its 52-week high
--   accelerates the tranches (the source check, step 1, found it on FinMind and Alpha Vantage). As
--   a security the nightly job loads its daily closes with the others.
-- windfall: the planner's settings, edited on the Windfall page and logged: the fund each core
--   class is bought through with windfall money (empty: the class's benchmark ETF; an Irish one
--   keeps it out of US estate tax, F15), the yearly return the waiting cash earns in the backtest
--   (a TWD money-market fund), and the backtest's horizon and first year.
-- The two F3 rules start evaluating; the plan and its tranches are logged like every entry.

create table public.market_series (
  series text not null check (series ~ '^[a-z0-9_]+$'),
  obs_month date not null check (extract(day from obs_month) = 1),
  value numeric not null,
  source text not null,
  updated_at timestamptz not null default now(),
  primary key (series, obs_month)
);
comment on table public.market_series is 'Monthly market series (F3): CAPE, the S&P 500 price and dividend yield 每月市場資料';
comment on column public.market_series.obs_month is 'The month, as its first day 月份（以當月 1 日表示）';

alter table public.market_series enable row level security;
revoke all on table public.market_series from anon, authenticated, service_role;
grant select on table public.market_series to authenticated;
grant select, insert, update, delete on table public.market_series to service_role;
create policy owner_read_only on public.market_series for select to authenticated using ((select private.is_owner()));

insert into public.securities (ticker, name, market, product_type, asset_class_id, currency, domicile) values
  ('ACWI', 'iShares MSCI ACWI ETF', 'US', 'equity_etf', 'us_global_equity', 'USD', 'US');

insert into public.config (key, value, desc_en, desc_zh) values
  ('windfall', '{"vehicles": {}, "cash_return": 0.015, "backtest": {"from_year": 1900, "horizon_months": 60}}',
   'Windfall planner (F3): the fund each core class is bought through with windfall money (empty: the class benchmark), the yearly return of the waiting cash in the backtest, and the backtest''s first year and horizon in months.',
   '大額資金分批（F3）：大額資金買進各核心類別所用的基金（留空為類別基準 ETF）、回測中等待資金的年報酬，以及回測的起始年份與期間（月）。');

update public.rules set enabled = true where id in ('WINDFALL_TRANCHE_DUE', 'WINDFALL_ACCELERATION');

comment on column public.windfall_plan.cape_percentile is 'CAPE percentile over its history at the plan''s start month; sets the tranche count 起始月的 CAPE 歷史百分位';
comment on column public.windfall_plan.tiers_fired is 'Acceleration tiers fired: {drawdown, peak_date, fired_on}, once per drawdown, which a 52-week peak names 已觸發的加速級距';
comment on column public.windfall_plan.current_drawdown_peak is 'ACWI''s 52-week high the current drawdown is measured from ACWI 52 週高點';
comment on column public.windfall_tranches.amount_twd is 'Planned at the start: the total over the tranche count; a proposal deploys the waiting cash over the tranches left 起始時規劃的金額';

create trigger windfall_plan_audit after update or delete on public.windfall_plan
  for each row execute function private.write_audit_log('id');
create trigger windfall_tranches_audit after update or delete on public.windfall_tranches
  for each row execute function private.write_audit_log('id');
