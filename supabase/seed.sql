-- Demo data for local development and the public repo (CLAUDE.md: demo seed data only).
-- Every figure is invented for demonstration; none is Hugo's real holdings or windfall.
-- `supabase db reset` loads this file after the migrations; `supabase db push` never sends it
-- to the hosted project.
--
-- The rows belong to no user: the app's single owner sees them once claimed. To try the app
-- locally, sign up in local Studio and run, with your local user's email:
--   insert into private.app_owner (user_id) select id from auth.users where email = 'you@example.com';

-- Two satellite stand-ins (the PRD N1 examples), since the satellite names no tickers yet.
insert into public.securities (ticker, name, market, product_type, asset_class_id, currency, domicile) values
  ('AAPL', 'Apple Inc.', 'US', 'stock', 'us_stocks', 'USD', 'US'),
  ('2330', '台積電', 'TW', 'stock', 'tw_stocks', 'TWD', 'TW');

-- Six monthly contributions and one dividend.
insert into public.cash_flows (flow_date, type, amount, currency, fx_rate, pool, ticker, note) values
  ('2026-05-06', 'contribution', 10000, 'TWD', 1, 'regular', null, 'demo'),
  ('2026-06-05', 'contribution', 10000, 'TWD', 1, 'regular', null, 'demo'),
  ('2026-07-06', 'contribution', 10000, 'TWD', 1, 'regular', null, 'demo'),
  ('2026-08-06', 'contribution', 10000, 'TWD', 1, 'regular', null, 'demo'),
  ('2026-09-07', 'contribution', 10000, 'TWD', 1, 'regular', null, 'demo'),
  ('2026-10-06', 'contribution', 10000, 'TWD', 1, 'regular', null, 'demo'),
  ('2026-09-15', 'dividend', 0.62, 'USD', 32.20, 'regular', 'VT', 'demo');

insert into public.transactions (trade_date, ticker, side, qty, price, currency, fee, tax, fx_rate, source, pool, note) values
  ('2026-05-07', 'VT', 'buy', 2, 150.00, 'USD', 1.00, 0, 31.80, 'manual', 'regular', 'demo'),
  ('2026-06-08', '00692', 'buy', 100, 88.00, 'TWD', 20, 0, 1, 'manual', 'regular', 'demo'),
  ('2026-07-07', 'BNDW', 'buy', 4, 68.00, 'USD', 1.00, 0, 32.10, 'manual', 'regular', 'demo'),
  ('2026-08-07', 'GLDM', 'buy', 3, 90.00, 'USD', 1.00, 0, 32.00, 'manual', 'regular', 'demo'),
  ('2026-09-08', 'BIL', 'buy', 3, 91.50, 'USD', 1.00, 0, 32.20, 'manual', 'regular', 'demo'),
  ('2026-10-07', '2330', 'buy', 3, 2300, 'TWD', 20, 0, 1, 'manual', 'regular', 'demo'),
  ('2026-10-08', 'AAPL', 'buy', 1, 230.00, 'USD', 1.00, 0, 32.30, 'manual', 'regular', 'demo'),
  ('2026-10-15', '00692', 'sell', 20, 92.00, 'TWD', 20, 1.84, 1, 'manual', 'regular', 'demo');

insert into public.manual_assets (name, asset_class_id, product_type, unit, quantity, valuation_method, last_value_twd, valued_on, pool) values
  ('Gold bar (demo) 金條（示範）', 'real_assets', 'gold', 'grams', 5, 'twd_gold_price', null, null, 'regular'),
  ('High-yield savings (demo) 高利活存（示範）', 'strategic_cash', 'cash_mmf', 'TWD', 20000, 'balance', 20000, '2026-10-20', 'regular');

insert into public.prices (ticker, price_date, close, adj_close, source) values
  ('VT', '2026-10-20', 157.80, 157.80, 'demo'),
  ('00692', '2026-10-20', 92.45, 92.45, 'demo'),
  ('BNDW', '2026-10-20', 68.40, 68.40, 'demo'),
  ('GLDM', '2026-10-20', 92.10, 92.10, 'demo'),
  ('BIL', '2026-10-20', 91.60, 91.60, 'demo'),
  ('2330', '2026-10-20', 2405.00, 2405.00, 'demo'),
  ('AAPL', '2026-10-20', 236.00, 236.00, 'demo'),
  ('0050', '2026-10-20', 107.25, 107.25, 'demo'),
  ('VOO', '2026-10-20', 595.00, 595.00, 'demo');

-- Month-end closes since the first demo trade, and the closes on the trade dates, so the
-- performance page (F18) has a history to draw; VOO and 0050 are SAA benchmark proxies.
insert into public.prices (ticker, price_date, close, adj_close, source)
select ticker, price_date::date, close, close, 'demo'
from (values
  ('VT', '2026-05-07', 150.20), ('VT', '2026-05-29', 151.90), ('VT', '2026-06-30', 153.40), ('VT', '2026-07-31', 152.10), ('VT', '2026-08-31', 154.80), ('VT', '2026-09-30', 156.30),
  ('00692', '2026-05-07', 86.10), ('00692', '2026-05-29', 87.20), ('00692', '2026-06-08', 88.00), ('00692', '2026-06-30', 88.90), ('00692', '2026-07-31', 89.60),
  ('00692', '2026-08-31', 90.40), ('00692', '2026-09-30', 91.20), ('00692', '2026-10-15', 92.00),
  ('BNDW', '2026-05-07', 67.60), ('BNDW', '2026-05-29', 67.80), ('BNDW', '2026-06-30', 67.95), ('BNDW', '2026-07-07', 68.00), ('BNDW', '2026-07-31', 68.10),
  ('BNDW', '2026-08-31', 68.25), ('BNDW', '2026-09-30', 68.30),
  ('GLDM', '2026-05-07', 84.00), ('GLDM', '2026-05-29', 85.30), ('GLDM', '2026-06-30', 86.90), ('GLDM', '2026-07-31', 88.40), ('GLDM', '2026-08-07', 90.00),
  ('GLDM', '2026-08-31', 89.70), ('GLDM', '2026-09-30', 91.20),
  ('BIL', '2026-05-07', 91.40), ('BIL', '2026-05-29', 91.45), ('BIL', '2026-06-30', 91.50), ('BIL', '2026-07-31', 91.48), ('BIL', '2026-08-31', 91.52),
  ('BIL', '2026-09-08', 91.50), ('BIL', '2026-09-30', 91.55),
  ('2330', '2026-05-07', 2150), ('2330', '2026-05-29', 2190), ('2330', '2026-06-30', 2240), ('2330', '2026-07-31', 2210), ('2330', '2026-08-31', 2260),
  ('2330', '2026-09-30', 2290), ('2330', '2026-10-07', 2300),
  ('AAPL', '2026-05-07', 212.00), ('AAPL', '2026-05-29', 218.00), ('AAPL', '2026-06-30', 222.00), ('AAPL', '2026-07-31', 219.00), ('AAPL', '2026-08-31', 226.00),
  ('AAPL', '2026-09-30', 228.00), ('AAPL', '2026-10-08', 230.00),
  ('0050', '2026-05-07', 98.50), ('0050', '2026-05-29', 100.20), ('0050', '2026-06-30', 102.40), ('0050', '2026-07-31', 101.30), ('0050', '2026-08-31', 103.90),
  ('0050', '2026-09-30', 105.60),
  ('VOO', '2026-05-07', 560.00), ('VOO', '2026-05-29', 568.00), ('VOO', '2026-06-30', 575.00), ('VOO', '2026-07-31', 571.00), ('VOO', '2026-08-31', 582.00),
  ('VOO', '2026-09-30', 588.00)
) as demo (ticker, price_date, close);

-- Three years of weekly demo closes before the first demo trade for the VaR proxies (N4), ACWI
-- (the F3 drawdown gauge) and the dollar, so the VaR card has a covariance to read. Invented by a
-- fixed recipe: a random walk backwards from each 2026-05-07 close, every Friday; each week's move
-- is the proxy's drift, plus a shared market shock times its beta, plus a shock of its own, both
-- drawn from an md5 hash of the date (Box–Muller), so every load gives the same numbers.
with fridays as (
  select day::date as friday from generate_series(date '2023-01-06', date '2026-05-01', interval '7 days') as day
),
shocks as (
  select f.friday, h.name,
         sqrt(-2 * ln((('x' || substr(h.hash, 1, 8))::bit(32)::bigint + 0.5) / 4294967296.0))
           * cos(2 * pi() * (('x' || substr(h.hash, 9, 8))::bit(32)::bigint + 0.5) / 4294967296.0) as z
  from fridays f
  cross join lateral (
    select name, md5(name || f.friday::text) as hash from unnest(array['market', 'VT', 'VOO', '0050', 'BNDW', 'GLDM', 'BIL', 'ACWI', 'USD']) as name
  ) as h
),
walks (name, anchor, weekly_vol, beta, drift) as (values
  ('VT', 150.20, 0.022, 0.95, 0.0015),
  ('VOO', 560.00, 0.024, 0.93, 0.0018),
  ('0050', 98.50, 0.026, 0.75, 0.0018),
  ('BNDW', 67.60, 0.008, 0.20, 0.0004),
  ('GLDM', 84.00, 0.020, 0.10, 0.0025),
  ('BIL', 91.40, 0.0003, 0.00, 0.0008),
  ('ACWI', 128.40, 0.021, 0.97, 0.0015),
  -- TWD per dollar: the dollar tends to rise against TWD when shares fall.
  ('USD', 31.80, 0.006, -0.35, 0.0000)
),
walked as (
  select w.name, s.friday,
         w.anchor * exp(-sum(w.drift + w.weekly_vol * (w.beta * m.z + sqrt(1 - w.beta * w.beta) * s.z)) over (partition by w.name order by s.friday desc)) as level
  from walks w
  join shocks s on s.name = w.name
  join shocks m on m.name = 'market' and m.friday = s.friday
),
demo_prices as (
  insert into public.prices (ticker, price_date, close, adj_close, source)
  select name, friday, round(level::numeric, 4), round(level::numeric, 4), 'demo' from walked where name <> 'USD'
)
insert into public.fx_rates (pair, rate_date, rate, source)
select 'USD/TWD', friday, round(level::numeric, 4), 'demo' from walked where name = 'USD';

insert into public.fx_rates (pair, rate_date, rate, source) values
  ('USD/TWD', '2026-05-07', 31.80, 'demo'),
  ('USD/TWD', '2026-07-07', 32.10, 'demo'),
  ('USD/TWD', '2026-08-07', 32.00, 'demo'),
  ('USD/TWD', '2026-09-08', 32.20, 'demo'),
  ('USD/TWD', '2026-09-15', 32.20, 'demo'),
  ('USD/TWD', '2026-10-08', 32.30, 'demo'),
  ('USD/TWD', '2026-10-20', 32.40, 'demo');

-- ACWI's daily closes from 2026-05-07 to the newest demo date, so the windfall planner's 52-week
-- drawdown gauge (F3) has days to read: a walk forward from the 2026-05-07 close on every weekday,
-- the same hashed shocks. It peaks at 137.95 on 2026-09-17 and ends 5.6% below it, short of the
-- first acceleration tier (15%).
with days as (
  select day::date as day from generate_series(date '2026-05-07', date '2026-10-20', interval '1 day') as day
  where extract(isodow from day) < 6
),
shocks as (
  select d.day,
         sqrt(-2 * ln((('x' || substr(h.hash, 1, 8))::bit(32)::bigint + 0.5) / 4294967296.0))
           * cos(2 * pi() * (('x' || substr(h.hash, 9, 8))::bit(32)::bigint + 0.5) / 4294967296.0) as z
  from days d
  cross join lateral (select md5('ACWI close' || d.day::text) as hash) as h
),
walked as (
  select day, round((128.40 * exp(sum(case when day = date '2026-05-07' then 0 else 0.0003 + 0.007 * z end) over (order by day)))::numeric, 2) as close
  from shocks
)
insert into public.prices (ticker, price_date, close, adj_close, source)
select 'ACWI', day, close, close, 'demo' from walked;

-- The monthly market series of the windfall planner (F3), as Shiller's data has them: the S&P
-- 500's price and dividend yield from 1871, its CAPE from 1881, to 2026-09. Invented by a fixed
-- recipe, like the weekly closes: earnings grow 0.33% a month with a business cycle; CAPE swings
-- around a level that drifts from 13 to 24 over the years; the price is CAPE × the ten-year
-- average of earnings, and the yield the share of earnings paid out (65% falling to 38%) over the
-- price. The cycle and the swing are AR(1) in logs, written in closed form, x(m) = φ^m · Σ φ^−k ·
-- σ · z(k), with z from an md5 hash of the month. CAPE ends at 24.04, the 74th percentile of its
-- 1,749 months, so a plan started now takes 24 tranches.
with months as (
  select m, (date '1861-01-01' + make_interval(months => m))::date as month
  from generate_series(0, 1988) as m
),
shocks as (
  select mo.m, h.name,
         sqrt(-2 * ln((('x' || substr(h.hash, 1, 8))::bit(32)::bigint + 0.5) / 4294967296.0))
           * cos(2 * pi() * (('x' || substr(h.hash, 9, 8))::bit(32)::bigint + 0.5) / 4294967296.0) as z
  from months mo
  cross join lateral (select name, md5(name || mo.month::text) as hash from unnest(array['earnings', 'valuation']) as name) as h
),
paths as (
  select mo.m, mo.month,
         ln(0.30) + 0.0033 * mo.m + power(0.97, mo.m) * sum(power(0.97, -mo.m) * 0.03 * e.z) over (order by mo.m) as log_earnings,
         ln(13) + ln(24.0 / 13) * mo.m / 1988.0 + power(0.99, mo.m) * sum(power(0.99, -mo.m) * 0.04 * v.z) over (order by mo.m) as log_cape
  from months mo
  join shocks e on e.m = mo.m and e.name = 'earnings'
  join shocks v on v.m = mo.m and v.name = 'valuation'
),
priced as (
  select m, month, exp(log_cape) as cape, exp(log_earnings) as earnings,
         exp(log_cape) * avg(exp(log_earnings)) over (order by m rows between 119 preceding and current row) as price,
         0.65 - 0.27 * m / 1988.0 as payout
  from paths
)
insert into public.market_series (series, obs_month, value, source)
select series, month, value, 'demo'
from priced
cross join lateral (values
  ('sp500_price', round(price::numeric, 2), m >= 120),
  ('sp500_yield', round((payout * earnings / price)::numeric, 5), m >= 120),
  ('us_cape', round(cape::numeric, 2), m >= 240)
) as v (series, value, shown)
where shown;

-- The Regression Lab's indices (N1): the demo S&P 500 follows VOO's demo closes and TAIEX's total
-- return index 0050's, on the same days, at the indices' own levels; the US 3-month bill rate
-- eases from 4.52% to 3.94% a year over the months the weekly closes span.
insert into public.index_prices (index_id, price_date, close, source)
select case ticker when 'VOO' then 'SPX' else 'TAIEX' end, price_date, round(adj_close * case ticker when 'VOO' then 10.93 else 1003.2 end, 2), 'demo'
from public.prices
where ticker in ('VOO', '0050');

insert into public.market_series (series, obs_month, value, source)
select 'us_tbill_3m', (date '2023-01-01' + make_interval(months => i))::date, round((0.0452 - 0.0058 * i / 44.0)::numeric, 4), 'demo'
from generate_series(0, 44) as i;

insert into public.watchlist (ticker, added_on) values ('AAPL', '2026-10-08');
