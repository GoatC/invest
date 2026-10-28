-- Phase 2, step 4 (F12): the valuation workbench, and the buy-zone and trim alerts.
--
-- fundamentals: a single stock's figures at each quarter end, loaded by the nightly job with the
--   secret key for the stocks held or on the watchlist and their peers: the flows over the twelve
--   months to it (revenue, EBIT, pre-tax income, tax, net income, D&A, CapEx, operating cash flow,
--   dividends paid and a share, interest) and the balances at it (current assets and liabilities,
--   cash, debt and its current part, equity, diluted shares), in the reporting currency. US stocks
--   from SEC EDGAR's XBRL company facts (10-K and 10-Q), Taiwan stocks from FinMind's three
--   statements; filed_on is the filing that first reported the quarter (SEC only). The owner reads
--   them; only the job writes them.
-- watchlist.assumptions: what Hugo sets for one stock on its Valuation page: the model its alerts
--   use, the forecast years, each scenario's growth and terminal rate, figures typed in place of
--   the filings', and its peers. Anything left out takes config valuation.
-- valuations: each model's bear / base / bull value a share, saved when Hugo saves a stock's
--   assumptions and by the nightly job when a new quarter is filed; inputs keeps what it was worked
--   out from, with the trigger (edit or filing) and the quarter end.
-- valuation: the defaults and settings, edited on the Valuation page and logged: the model, the
--   years, each scenario's growth and terminal rate, the spread over R_f a company without
--   reported interest pays on its debt, the tax rate by market when the filings give none, and the
--   years and fewest quarter ends of a company's own multiples range.
-- The three F12 rules start evaluating: BUY_ZONE and TRIM_ZONE read the newest saved base value of
--   each watched stock's model; TRIM_ZONE sells sell_share of the holding; VALUATION_UPDATED
--   prompts a review when a filing moves that value by more than `change`.

create table public.fundamentals (
  ticker text not null references public.securities (ticker) on update cascade,
  period_end date not null,
  figures jsonb not null check (jsonb_typeof(figures) = 'object'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  filed_on date,
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  updated_at timestamptz not null default now(),
  primary key (ticker, period_end)
);
comment on table public.fundamentals is 'A single stock''s figures at each quarter end: flows over the twelve months to it, balances at it (F12) 每季財報數字';
comment on column public.fundamentals.figures is 'revenue, ebit, pretax, tax, netIncome, da, capex, ocf, dividendsPaid, dps, interest (TTM); currentAssets, currentLiabilities, cash, debt, shortDebt, equity, shares (at the quarter end) 近四季流量與季末餘額';
comment on column public.fundamentals.filed_on is 'The filing that first reported the quarter (SEC); null for FinMind 首次申報日';

alter table public.fundamentals enable row level security;
revoke all on table public.fundamentals from anon, authenticated, service_role;
grant select on table public.fundamentals to authenticated;
grant select, insert, update, delete on table public.fundamentals to service_role;
create policy owner_read_only on public.fundamentals for select to authenticated using ((select private.is_owner()));

alter table public.watchlist add column assumptions jsonb not null default '{}'::jsonb check (jsonb_typeof(assumptions) = 'object');
comment on column public.watchlist.assumptions is 'model (dcf / ddm / multiples), years, growth and terminal by scenario, overrides (fcff, netDebt, shares, taxRate, costOfDebt), peers; config valuation fills the rest 估值假設';
comment on column public.valuations.inputs is 'What the value was worked out from: price, cost of equity, WACC, FCFF or dividend, the assumptions, the quarter end, and the trigger (edit / filing) 估值輸入';

insert into public.config (key, value, desc_en, desc_zh) values
  ('valuation', '{
     "model": "dcf",
     "years": 5,
     "growth": {"bear": 0.02, "base": 0.06, "bull": 0.10},
     "terminal": {"bear": 0.015, "base": 0.025, "bull": 0.03},
     "debt_spread": 0.015,
     "tax_rate": {"US": 0.21, "TW": 0.20},
     "history_years": 5,
     "min_quarters": 8,
     "last_verified": null
   }',
   'Valuation workbench (F12): the model a stock''s alerts use, the forecast years, each scenario''s FCFF growth and terminal growth, the spread over R_f for a company that reports no interest, the tax rate by market when the filings give none, and the years and fewest quarter ends of a company''s own multiples range.',
   '估值工作台（F12）：警報採用的模型、預測年數、各情境的 FCFF 成長率與永續成長率、未揭露利息的公司以 R_f 加上的利差、財報沒有稅率時各市場的稅率，以及自身倍數區間的年數與最少季數。');

update public.rules set enabled = true where id in ('BUY_ZONE', 'TRIM_ZONE', 'VALUATION_UPDATED');
update public.rules set threshold = '{"multiple": 1.25, "sell_share": 0.5}', cooldown_days = 30,
  desc_en = 'Trim zone: price at or above 125% of the base intrinsic value; propose selling half the holding (sell_share).',
  desc_zh = '進入減碼區：股價高於或等於基本情境內在價值的 125%；提出賣出持股一半（sell_share）的減碼提案。'
  where id = 'TRIM_ZONE';
update public.rules set
  desc_en = 'Buy zone: price at or below 75% of the base intrinsic value of a watched stock; draft a buy of the month''s contribution share (MONTHLY_CONTRIBUTION satellite_share_with_buy_alert), within R1 and R2.',
  desc_zh = '進入買入區：觀察清單個股股價低於或等於基本情境內在價值的 75%；以當月投入的衛星比例（MONTHLY_CONTRIBUTION 的 satellite_share_with_buy_alert）產生建議買單，受 R1／R2 限制。'
  where id = 'BUY_ZONE';
