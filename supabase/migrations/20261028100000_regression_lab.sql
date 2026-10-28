-- Phase 2, step 2 (N1): the Regression Lab.
--
-- index_prices: daily closes of the market indices N1 regresses on, loaded by the nightly job with
--   the secret key: SPX, the S&P 500 (FinMind's ^GSPC, FRED's SP500 as fallback), and TAIEX, the
--   TWSE capitalisation-weighted total return index 發行量加權股價報酬指數 (FinMind, TWSE's daily
--   index report as fallback), so Taiwan's dividends are in it as they are in the stocks' adjusted
--   closes. An index is not a security, so it has its own table. The owner reads them; only the
--   job writes them.
-- regression: the lab's settings, edited on the Regression page and logged: the benchmarks, the
--   default frequency, window and currency, the windows offered, the confidence, Blume's weight
--   and prior, the rolling window in weeks, the fewest observations for a β, the most tickers
--   compared, and the yearly risk-free rate per currency when no monthly series covers a month.
--   TWD always takes it (no free monthly series; a starting value from the Bank of Taiwan's
--   one-year time deposit, to be checked); USD takes FRED's 3-month bill (TB3MS, market_series
--   us_tbill_3m) once the nightly job has loaded it.
-- beta_results: each holding's β against both benchmarks at the default settings, written by the
--   nightly job once a month, for F11 (step 3).

create table public.index_prices (
  index_id text not null check (index_id ~ '^[A-Z0-9][A-Z0-9_]*$'),
  price_date date not null,
  close numeric not null check (close > 0),
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  updated_at timestamptz not null default now(),
  primary key (index_id, price_date)
);
comment on table public.index_prices is 'Daily index closes (N1): the S&P 500 and TAIEX total return 指數每日收盤';

alter table public.index_prices enable row level security;
revoke all on table public.index_prices from anon, authenticated, service_role;
grant select on table public.index_prices to authenticated;
grant select, insert, update, delete on table public.index_prices to service_role;
create policy owner_read_only on public.index_prices for select to authenticated using ((select private.is_owner()));

insert into public.config (key, value, desc_en, desc_zh) values
  ('regression', '{
     "benchmarks": {
       "SPX": {"name_en": "S&P 500", "name_zh": "標普 500", "market": "US", "currency": "USD"},
       "TAIEX": {"name_en": "TAIEX (total return)", "name_zh": "加權報酬指數", "market": "TW", "currency": "TWD"}
     },
     "defaults": {"freq": "weekly", "window_years": 2, "currency": "local"},
     "windows": [1, 2, 3, 5],
     "confidence": 0.95,
     "blume": {"weight": 0.67, "prior": 1},
     "rolling_weeks": 52,
     "min_observations": 12,
     "compare_max": 5,
     "risk_free": {"TWD": 0.017, "USD": 0.04, "last_verified": null, "source": "TWD: Bank of Taiwan one-year time deposit 臺灣銀行一年期定存; USD: until FRED TB3MS is loaded 載入 FRED TB3MS 前使用"}
   }',
   'Regression Lab (N1): the benchmarks, the default frequency, window and currency, the windows offered, the confidence, Blume''s weight and prior, the rolling window in weeks, the fewest observations, the most tickers compared, and the yearly risk-free rate per currency when no monthly series covers a month.',
   '回歸分析（N1）：基準指數、預設頻率、期間與幣別、可選期間、信賴水準、Blume 權重、滾動期間（週）、最少觀察值、最多比較檔數，以及沒有每月資料時各幣別的年化無風險利率。');

comment on column public.beta_results.alpha is 'Annualised α: α per period × periods a year 年化 α';
comment on column public.beta_results.std_err is 'Standard error of β (of the summed β with a Dimson term) β 的標準誤';
comment on column public.beta_results.factor_loadings is 'For 1F: adjusted (Blume), ci_low, ci_high, n, adjacent (none / previous / next), slopes, from, to 調整後 β、信賴區間、觀察值數等';
