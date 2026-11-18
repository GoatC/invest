-- F12's forward P/E check (added 2026-11-04): the analysts' consensus beside each single stock's
-- valuation, so a buy can be weighed on what the market expects next.
--
-- analyst_estimates: one row per stock, the newest consensus. The nightly job writes US stocks'
--   from Alpha Vantage (EARNINGS_ESTIMATES: each fiscal year's mean, high and low EPS, the analysts
--   behind it and the mean 30 days ago with the revisions up and down; OVERVIEW: the mean target
--   price and the count of each rating), every pe_check.refresh_days days, as the free key allows
--   25 requests a day. Taiwan stocks have no free consensus feed: Hugo types the consensus from a
--   broker's or a news site's page, saved with source typed. Both are logged.
-- pe_check: when the forward P/E reads cheap or rich against the company's own five-year median
--   P/E (or its peers'), the PEG bands, the band within which a 30-day move of the consensus reads
--   flat, the fewest analysts for a verdict, the score that leans the verdict, when estimates are
--   stale and how often the job loads them. Display only: no rule reads it.

create table public.analyst_estimates (
  ticker text primary key references public.securities (ticker) on update cascade on delete cascade,
  as_of date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  estimates jsonb not null check (jsonb_typeof(estimates) = 'object' and jsonb_typeof(estimates -> 'years') = 'array'),
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  updated_at timestamptz not null default now()
);
comment on table public.analyst_estimates is 'The analysts'' newest consensus for a single stock (F12 forward P/E) 分析師共識預估';
comment on column public.analyst_estimates.estimates is 'years: [{periodEnd, mean, high, low, analysts, mean30, up30, down30}] EPS by fiscal year; targetPrice; ratings {strongBuy, buy, hold, sell, strongSell} 各會計年度 EPS 預估、目標價與評等';

alter table public.analyst_estimates enable row level security;
revoke all on table public.analyst_estimates from anon, authenticated, service_role;
grant select, insert, update, delete on table public.analyst_estimates to authenticated, service_role;
create policy owner_full_access on public.analyst_estimates for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create trigger analyst_estimates_touch before update on public.analyst_estimates
  for each row execute function private.touch_updated_at();
create trigger analyst_estimates_audit after update or delete on public.analyst_estimates
  for each row execute function private.write_audit_log('ticker');

insert into public.config (key, value, desc_en, desc_zh) values
  ('pe_check', '{
     "cheap_discount": 0.15,
     "rich_premium": 0.15,
     "peg_cheap": 1.0,
     "peg_rich": 2.0,
     "revision_band": 0.01,
     "min_analysts": 3,
     "score": 2,
     "stale_days": 45,
     "refresh_days": 7
   }',
   'Forward P/E check (F12): the forward P/E reads cheap this far below the own five-year median P/E (cheap_discount) and rich this far above (rich_premium); PEG at or below peg_cheap reads cheap for its growth, at or above peg_rich rich; a 30-day move of the consensus within revision_band reads flat; below min_analysts, or estimates older than stale_days, the verdict stays neutral; score signals lean it; the nightly job loads US estimates every refresh_days days.',
   '本益比診斷（F12）：預估本益比低於自身五年中位數 cheap_discount 以上為偏便宜、高於 rich_premium 以上為偏貴；PEG 不高於 peg_cheap 為成長相對便宜、不低於 peg_rich 為偏貴；共識 30 天變動在 revision_band 以內視為持平；分析師少於 min_analysts 位或預估超過 stale_days 天時結論維持中性；score 個訊號決定傾向；每夜排程每 refresh_days 天載入一次美股預估。');
