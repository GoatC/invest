-- Asked by Hugo on 2026-11-12: the cash-flow book counts each buy by itself, the app looks up each
-- holding's dividend dates and asks whether to record the cash, and a banner inside the app says
-- what to do next.
--
-- The cash-flow book needs no table: a buy or a sell is read from transactions (lib/models/
-- cash-flows), so a trade is recorded once, on the holdings page, and cash_flows keeps what no
-- trade tells: the windfall arriving, dividends and withdrawals.
--
-- securities.dividends_reinvested: a fund that keeps its income (an accumulating class) or a
--   holding whose broker reinvests it; the app never asks about its dividends.
-- securities.dividends_checked_on: the day Alpha Vantage last answered for a US security Nasdaq
--   does not carry; the job asks again a week on (FinMind's adjusted closes took over ten days to
--   show a dividend when checked on 2026-11-12, so they alone would ask late).
-- dividend_events: one row per security and ex-dividend date, written by the nightly job: the
--   cash a share, the day it is paid when the feed tells, and the pools Hugo answered "skip" for.
--   Taiwan from FinMind's TaiwanStockDividend; US from Nasdaq's dividend history, else read from
--   the adjusted closes with Alpha Vantage's DIVIDENDS for the payment date.
-- banner_dismissals: a banner closed with ✕ stays away until this day, on every device.
-- notifications: a new kind, dividend, for the push on the day a dividend is paid, once.
-- config dividends, banners: the settings of both.

alter table public.securities add column dividends_reinvested boolean not null default false;
comment on column public.securities.dividends_reinvested is 'Income kept in the fund or reinvested by the broker: no dividend is asked about 配息自動再投入，不詢問';
alter table public.securities add column dividends_checked_on date;
comment on column public.securities.dividends_checked_on is 'The day Alpha Vantage last answered for its dividends: asked again a week on, as the free key allows 25 requests a day 上次向 Alpha Vantage 查詢配息的日期';
-- The accumulating Irish classes named in the reference data and the costs page.
update public.securities set dividends_reinvested = true where ticker in ('AGGU', 'CSPX', 'IB01', 'VWRA');

create table public.dividend_events (
  id bigint generated always as identity primary key,
  ticker text not null references public.securities (ticker) on update cascade on delete cascade,
  ex_date date not null,
  pay_date date,
  amount numeric not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  skipped_pools text[] not null default '{}' check (skipped_pools <@ array['regular', 'windfall']),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dividend_events_ticker_ex_date_key unique (ticker, ex_date),
  constraint dividend_events_pay_after_ex_check check (pay_date is null or pay_date >= ex_date)
);
comment on table public.dividend_events is 'Cash dividends of the securities held, by ex-dividend date, from the nightly job 持有標的的現金配息';
comment on column public.dividend_events.amount is 'Cash a share before any tax withheld, in the currency 每股現金配息（稅前）';
comment on column public.dividend_events.pay_date is 'The day it is paid, when the feed tells; else the app estimates it (config dividends.pay_lag_days) 發放日';
comment on column public.dividend_events.skipped_pools is 'The pools Hugo answered "skip" for: not asked again 已略過的資金池';
create index dividend_events_ex_date_idx on public.dividend_events (ex_date);

alter table public.dividend_events enable row level security;
revoke all on table public.dividend_events from anon, authenticated, service_role;
grant select, insert, update, delete on table public.dividend_events to authenticated, service_role;
create policy owner_full_access on public.dividend_events for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create trigger dividend_events_touch before update on public.dividend_events
  for each row execute function private.touch_updated_at();

create table public.banner_dismissals (
  key text primary key check (length(key) between 1 and 120),
  until date not null,
  created_at timestamptz not null default now()
);
comment on table public.banner_dismissals is 'In-app banners closed with ✕: not shown again until the day given 已關閉的 App 內橫幅';

alter table public.banner_dismissals enable row level security;
revoke all on table public.banner_dismissals from anon, authenticated, service_role;
grant select, insert, update, delete on table public.banner_dismissals to authenticated, service_role;
create policy owner_full_access on public.banner_dismissals for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('proposal', 'weekly', 'data_failure', 'test', 'event', 'news', 'dividend'));

insert into public.config (key, value, desc_en, desc_zh) values
  ('dividends', '{
     "lookback_days": 60,
     "match_days": 30,
     "pay_lag_days": {"US": 7, "TW": 30, "UK": 14},
     "withholding": {"US": 0.30},
     "push": true,
     "push_days": 3
   }',
   'Dividend prompts: a dividend is asked about from the day it is paid (or, without that date, pay_lag_days after the ex-dividend date, by market) for lookback_days; a dividend cash flow of the same security and pool dated from the ex-dividend date to match_days after the payment answers it; the estimate takes withholding off by the security''s domicile; push sends one push on the day, for dividends due within the last push_days.',
   '配息提醒：自發放日起詢問（沒有發放日時，以除息日加上各市場的 pay_lag_days 估算），持續 lookback_days 天；同一標的、同一資金池，日期在除息日到發放日後 match_days 天內的股利現金流視為已登錄；估計金額依標的註冊地扣除 withholding 預扣稅；push 為是否在當天推播一次（只推播最近 push_days 天內到期的配息）。'),
  ('banners', '{
     "enabled": true,
     "snooze_days": 7,
     "balance_stale_days": 45,
     "kinds": {"dividend": true, "proposals": true, "windfall_balance": true, "windfall_plan": true, "stale_balance": true, "first_trade": true, "push": true}
   }',
   'In-app banner: shown under the header when something waits on Hugo (a dividend to record, a proposal, a windfall without its balance or plan, a cash balance not updated for balance_stale_days, no trade yet, no device with push); ✕ hides one for snooze_days; kinds turns each off.',
   'App 內橫幅：有事情等你處理時顯示在頁首下方（待登錄的配息、提案、大額資金尚未建立餘額或分批計畫、現金餘額超過 balance_stale_days 天未更新、尚無交易、沒有裝置開啟推播）；按 ✕ 後 snooze_days 天內不再顯示；kinds 可分別關閉。');
