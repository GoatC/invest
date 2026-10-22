-- Phase 1, step 7 (N4 VaR): the VaR card works out a covariance from three years of weekly closes
-- of each class proxy (config var.lookback_years). This view gives the last close of every week,
-- Saturday to Friday, per ticker, so a page reads about 160 rows per proxy instead of 750 daily
-- ones. security_invoker makes it run with the caller's rights, so the row-level security of
-- prices still applies; the grants match that table: nothing for anon.

create view public.weekly_prices with (security_invoker = true) as
  select distinct on (ticker, week_ending) ticker, week_ending, price_date, close, adj_close
  from (
    select ticker, price_date, close, adj_close,
           price_date + (12 - extract(isodow from price_date)::integer) % 7 as week_ending
    from public.prices
  ) as dated
  order by ticker, week_ending, price_date desc;
comment on view public.weekly_prices is 'Last close of each week to Friday, per ticker (N4 VaR) 每檔證券每週（至週五）最後一筆收盤價';

revoke all on public.weekly_prices from anon, authenticated, service_role;
grant select on public.weekly_prices to authenticated, service_role;

-- The nightly job now fills var_95_1w for every snapshot day.
comment on column public.nav_snapshots.var_95_1w is 'N4: the 1-week Value at Risk in TWD at config var.confidence (95%), both pools; null when a holding lacks three years of proxy prices 一週風險值（台幣）';
