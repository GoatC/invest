-- Newest close per ticker and newest rate per FX pair, so the holdings view (N5) and later the
-- dashboard read one row each instead of the whole price history (Phase 1, step 3).
--
-- security_invoker makes each view run with the caller's rights, so the row-level security of
-- prices and fx_rates still applies; the grants match those tables: nothing for anon.

create view public.latest_prices with (security_invoker = true) as
  select distinct on (ticker) ticker, price_date, close, source
  from public.prices
  order by ticker, price_date desc;
comment on view public.latest_prices is 'Newest close per ticker 每檔證券的最新收盤價';

create view public.latest_fx_rates with (security_invoker = true) as
  select distinct on (pair) pair, rate_date, rate, source
  from public.fx_rates
  order by pair, rate_date desc;
comment on view public.latest_fx_rates is 'Newest rate per FX pair 每個匯率組合的最新匯率';

revoke all on public.latest_prices, public.latest_fx_rates from anon, authenticated, service_role;
grant select on public.latest_prices, public.latest_fx_rates to authenticated, service_role;
