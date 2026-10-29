-- Phase 2, step 5 (N3): the red-flag indicator, beside F12's watchlist.
--
-- red_flags: one row per company, indicator and weekly scan, saved by the nightly job, and by the
--   app when the owner adds or deletes an entry for the company: the level, or none (no data covers it) or na (it does not apply), the company's
--   coverage, and in detail what the indicator read (the scores' parts, the events, the quarter).
-- company_profiles: what the job knows of each single stock held or watched besides its filings:
--   its industry (TWSE 產業別 or SEC SIC) for Altman's manufacturer test and the exclusion list, a
--   Taiwan company's audit firm and business ID (統一編號), and in checked the newest check of each
--   event indicator's feed, with the first one where a feed reaches forward only.
-- red_flag_events: the events the feeds find: SEC 8-K Items 4.01 (auditor change) and 4.02
--   (restatement), a going-concern paragraph in a 10-K (EDGAR full-text search), a TWSE material
--   announcement (重大訊息) of a restatement or going-concern doubt, a change of a Taiwan company's
--   audit firm in its TWSE profile, and Ministry of Environment penalties by business ID. Written
--   by the job only.
-- red_flag_entries: the owner's own entries where no feed reaches: as of a date, the number of
--   events found in the lookback window (0: checked, none), or the TWSE governance evaluation tier
--   (the bottom edge of its band, 5 to 100). Edits and deletions are logged.
-- red_flags (config): the lookback years, the scan interval, each score's thresholds, the
--   industries that count as manufacturers (Altman Z) and as financial (no Beneish or Altman), and
--   the owner's exclusion list (empty until set: PRD Section 9).
-- RED_FLAG_WORSENS and RED_FLAG_RED start evaluating; RED_FLAG_RED drafts the exit, selling
--   sell_share (all) of the stock.

alter table public.red_flags drop constraint red_flags_level_check;
alter table public.red_flags add constraint red_flags_level_check check (level in ('green', 'amber', 'red', 'none', 'na'));
alter table public.red_flags add column detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object');
comment on column public.red_flags.level is 'green, amber or red; none when no data covers the indicator, na when it does not apply 燈號（none 無資料、na 不適用）';
comment on column public.red_flags.coverage_pct is 'The company''s share of applicable indicators covered at this scan 資料覆蓋率';
comment on column public.red_flags.detail is 'What the indicator read: the score''s parts, the quarter, the events, the owner''s entry 指標明細';
create index red_flags_ticker_date_idx on public.red_flags (ticker, flag_date desc);


create table public.company_profiles (
  ticker text primary key references public.securities (ticker) on update cascade,
  industry_code text,
  industry text,
  sic integer check (sic between 100 and 9999),
  auditor text,
  business_id text check (business_id ~ '^[0-9]{8}$'),
  checked jsonb not null default '{}'::jsonb check (jsonb_typeof(checked) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  updated_at timestamptz not null default now()
);
comment on table public.company_profiles is 'A single stock''s industry, audit firm and business ID, and when each red-flag feed last checked it (N3) 公司基本資料';
comment on column public.company_profiles.checked is '{indicator: {on, since}}: the newest check of each event indicator''s feed, and the first where it reaches forward only 各指標最後檢查日';

create table public.red_flag_events (
  id bigint generated always as identity primary key,
  ticker text not null references public.securities (ticker) on update cascade,
  indicator text not null check (indicator in ('auditor_change', 'going_concern', 'restatement', 'environmental_penalties')),
  event_date date not null,
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  ref text not null check (length(ref) between 1 and 200),
  title text not null check (length(title) <= 500),
  url text check (url ~ '^https://'),
  value numeric,
  created_at timestamptz not null default now(),
  unique (ticker, indicator, source, ref)
);
comment on table public.red_flag_events is 'Events the feeds found: auditor changes, going-concern opinions, restatements, environmental penalties (N3) 紅旗事件';
comment on column public.red_flag_events.ref is 'The filing''s accession number, the announcement or the penalty''s document number 文件編號';
comment on column public.red_flag_events.value is 'A penalty''s amount 裁罰金額';
create index red_flag_events_ticker_idx on public.red_flag_events (ticker, event_date desc);

do $$
declare
  t text;
begin
  foreach t in array array['company_profiles', 'red_flag_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('create policy owner_read_only on public.%I for select to authenticated using ((select private.is_owner()))', t);
  end loop;
end;
$$;

create table public.red_flag_entries (
  id bigint generated always as identity primary key,
  ticker text not null references public.securities (ticker) on update cascade,
  indicator text not null check (indicator in ('auditor_change', 'going_concern', 'restatement', 'environmental_penalties', 'governance_rating')),
  as_of date not null,
  value numeric not null check (value >= 0),
  note text not null default '' check (length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint red_flag_entries_value_kind_check check (
    case when indicator = 'governance_rating' then value in (5, 20, 35, 50, 65, 80, 100) else value = trunc(value) end
  )
);
comment on table public.red_flag_entries is 'The owner''s own red-flag entries where no feed reaches (N3) 自行登錄的紅旗資料';
comment on column public.red_flag_entries.value is 'Events found in the lookback window as of as_of (0: checked, none); for governance_rating the tier''s bottom edge, % from the top 事件數或治理評鑑級距';
create index red_flag_entries_ticker_idx on public.red_flag_entries (ticker, as_of desc);
alter table public.red_flag_entries enable row level security;
revoke all on table public.red_flag_entries from anon, authenticated, service_role;
grant select, insert, update, delete on table public.red_flag_entries to authenticated, service_role;
create policy owner_full_access on public.red_flag_entries for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create trigger red_flag_entries_touch before update on public.red_flag_entries
  for each row execute function private.touch_updated_at();
create trigger red_flag_entries_audit after update or delete on public.red_flag_entries
  for each row execute function private.write_audit_log('id');

insert into public.config (key, value, desc_en, desc_zh) values
  ('red_flags', '{
     "lookback_years": 3,
     "scan_days": 7,
     "beneish": {"red_above": -1.78},
     "altman": {"z": {"red_below": 1.81, "amber_below": 2.99}, "z2": {"red_below": 1.10, "amber_below": 2.60}},
     "cash_flow_years": 3,
     "governance": {"bottom_share": 0.35},
     "manufacturing": {"sic": [[2000, 3999]], "tw_industries": ["01", "02", "03", "04", "05", "06", "08", "09", "10", "11", "12", "21", "22", "24", "25", "26", "27", "28", "31"]},
     "financial": {"sic": [[6000, 6799]], "tw_industries": ["17"]},
     "excluded": {"industries": [], "tickers": []},
     "last_verified": null
   }',
   'Red-flag indicator (N3): the years events count for, the days between scans, the Beneish and Altman thresholds (Z for manufacturers, Z″ for others), the years of cash flow below earnings, the bottom share of the governance evaluation, the industries counted as manufacturers and as financial (SIC ranges, TWSE industry codes), and the exclusion list.',
   '紅旗指標（N3）：事件計入的年數、掃描間隔天數、Beneish 與 Altman 門檻（製造業用 Z、其他用 Z″）、現金流低於盈餘的年數、公司治理評鑑後段比例、視為製造業與金融業的產業（SIC 範圍、證交所產業別代碼），以及排除清單。');

update public.rules set enabled = true where id = 'RED_FLAG_WORSENS';
update public.rules set enabled = true, threshold = '{"sell_share": 1}',
  desc_en = 'Red flag turns red: a satellite holding moves to red; prompt a re-review, with the exit drafted (selling sell_share of it).',
  desc_zh = '紅旗轉紅：衛星持股燈號轉紅；提示重新檢視，並附出場清單（賣出持股的 sell_share 比例）。'
  where id = 'RED_FLAG_RED';
