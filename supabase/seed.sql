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
  ('0050', '2026-10-20', 107.25, 107.25, 'demo');

insert into public.fx_rates (pair, rate_date, rate, source) values
  ('USD/TWD', '2026-05-07', 31.80, 'demo'),
  ('USD/TWD', '2026-07-07', 32.10, 'demo'),
  ('USD/TWD', '2026-08-07', 32.00, 'demo'),
  ('USD/TWD', '2026-09-08', 32.20, 'demo'),
  ('USD/TWD', '2026-09-15', 32.20, 'demo'),
  ('USD/TWD', '2026-10-08', 32.30, 'demo'),
  ('USD/TWD', '2026-10-20', 32.40, 'demo');

insert into public.watchlist (ticker, added_on) values ('AAPL', '2026-10-08');
