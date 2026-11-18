-- F6 auto-scored capital market assumptions (asked by Hugo on 2026-11-09): a satellite class with
-- no assumption of the owner's gets one scored from the stocks and ETFs it holds, so F2, F5 and F7
-- count it instead of leaving it out; one the owner types always wins (lib/models/auto-cma.ts).
--
-- cma_auto (config): whether to score; where a market's premium comes from ('cma': the owner's
--   assumption for the class standing for that market, less the market's 10-year yield, so a
--   holding with β 1 expects what the owner expects of its market; 'erp': F11's ERP + CRP); which
--   class stands for each market; the years of monthly returns the volatility reads; the fewest
--   months a line needs to be scored. Edited on the assumptions page and logged, like every setting.
-- cma_estimates: each satellite class's estimate from its holdings, one row per class: the
--   expected return and volatility, the months its basket covers, and in detail each line's β,
--   index, R², expected return, volatility and weight, the lines left out and the markets' lines.
--   A class that holds lines none of which can be scored yet (too few months, no β) keeps a row
--   with no figures, naming the lines left out, so the page can say why. Written by the nightly job
--   and, after a trade in a satellite class or a change of assumptions, by the owner's own save; a
--   figure worked out from the holdings, so not audited.

insert into public.config (key, value, desc_en, desc_zh) values
  ('cma_auto', '{
     "enabled": true,
     "premium": "cma",
     "anchors": {"US": "us_global_equity", "TW": "tw_market_cap"},
     "lookback_years": 5,
     "min_months": 36
   }',
   'Auto-scored assumptions (F6): a satellite class without an assumption of yours is scored from its holdings by CAPM. premium cma takes each market''s premium from your assumption for its anchor class less the 10-year yield, erp from F11''s ERP + CRP; volatility from lookback_years of monthly TWD returns; a line needs min_months of them.',
   '自動評分的資本市場假設（F6）：未設定假設的衛星類別，依持股以 CAPM 評分。premium 為 cma 時，各市場溢酬取你對其代表類別的假設減 10 年期殖利率；為 erp 時取 F11 的風險溢酬加國家風險溢酬；波動度取 lookback_years 年的台幣月報酬，每檔至少需 min_months 個月。');

create table public.cma_estimates (
  class_id text primary key references public.asset_classes (id) on update cascade on delete cascade,
  as_of date not null,
  expected_return numeric check (expected_return > -1 and expected_return < 1),
  volatility numeric check (volatility >= 0 and volatility < 5),
  months integer not null check (months >= 0),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  updated_at timestamptz not null default now(),
  -- Scored (both figures) or held but not scorable yet (neither).
  check ((expected_return is null) = (volatility is null))
);
comment on table public.cma_estimates is 'Each satellite class''s capital market assumption scored from its holdings (F6 auto) 依持股自動評分的衛星類別資本市場假設';
comment on column public.cma_estimates.expected_return is 'Expected yearly return of the class, null while nothing it holds can be scored 類別預期年報酬（無可評分持股時為空）';
comment on column public.cma_estimates.detail is 'from, to (YYYY-MM); lines: ticker, weight, benchmark, market, beta, r2, expected_return, volatility, months; left: ticker, reason (history / beta); markets: market, benchmark, risk_free, premium, source, anchor 評分明細';

create trigger cma_estimates_touch before update on public.cma_estimates
  for each row execute function private.touch_updated_at();

alter table public.cma_estimates enable row level security;
revoke all on table public.cma_estimates from anon, authenticated, service_role;
grant select, insert, update, delete on table public.cma_estimates to authenticated, service_role;
create policy owner_full_access on public.cma_estimates for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
