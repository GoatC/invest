-- N8 volatility alert (added 2026-11-06), step 2: the event calendar.
--
-- market_events: the market events known in advance, each at its Taipei date and time:
--   fomc      FOMC rate decisions, from the Fed's calendar (source fed)
--   cpi       US CPI, from FRED's release calendar (source fred)
--   payrolls  the US jobs report (Employment Situation), from FRED's release calendar (source fred)
--   cbc       Taiwan's central bank board meetings, typed in from its yearly press release (typed)
--   other     anything else Hugo types in, such as an election (typed)
--   The volatility job replaces its own sources' events from today on at each run (a rescheduled
--   meeting moves); the owner reads every row and types, edits and deletes the typed ones, logged.
-- notifications: a new kind, event, for the reminder pushed lead_days before each event, once.
-- config volatility.events: the reminder's lead in days (2) and the kinds reminded of.

create table public.market_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('fomc', 'cpi', 'payrolls', 'cbc', 'other')),
  event_date date not null,
  event_time text check (event_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  name_en text not null check (length(trim(name_en)) between 1 and 120),
  name_zh text not null check (length(trim(name_zh)) between 1 and 120),
  source text not null check (source in ('fed', 'fred', 'typed')),
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_events_kind_date_name_key unique (kind, event_date, name_en)
);
comment on table public.market_events is 'Market events known in advance, at their Taipei date and time (N8): FOMC, US CPI and jobs report from the feeds, central bank meetings and elections typed in 市場事件日曆';
comment on column public.market_events.event_time is 'Taipei time HH:MM, when known 台北時間';

alter table public.market_events enable row level security;
revoke all on table public.market_events from anon, authenticated, service_role;
grant select, insert, update, delete on table public.market_events to authenticated, service_role;
create policy owner_reads on public.market_events for select to authenticated using ((select private.is_owner()));
create policy owner_types on public.market_events for all to authenticated
  using ((select private.is_owner()) and source = 'typed') with check ((select private.is_owner()) and source = 'typed');
create trigger market_events_touch before update on public.market_events
  for each row execute function private.touch_updated_at();
-- Only Hugo's own entries are logged: the job replaces its events twice a day.
create trigger market_events_audit after update or delete on public.market_events
  for each row when (old.source = 'typed') execute function private.write_audit_log('id');

-- Taiwan's central bank board meetings in 2026 (its press release (114) no. 213), at 14:00; the
-- decision is announced in the afternoon. Next year's dates are typed in from the next release.
insert into public.market_events (kind, event_date, event_time, name_en, name_zh, source, note) values
  ('cbc', '2026-03-19', '14:00', 'Taiwan''s central bank meeting', '央行理監事會議', 'typed', null),
  ('cbc', '2026-06-18', '14:00', 'Taiwan''s central bank meeting', '央行理監事會議', 'typed', null),
  ('cbc', '2026-09-17', '14:00', 'Taiwan''s central bank meeting', '央行理監事會議', 'typed', null),
  ('cbc', '2026-12-17', '14:00', 'Taiwan''s central bank meeting', '央行理監事會議', 'typed', null);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('proposal', 'weekly', 'data_failure', 'test', 'event'));

update public.config
set value = value || '{"events": {"lead_days": 2, "remind": ["fomc", "cpi", "payrolls", "cbc", "other"]}}'::jsonb
where key = 'volatility';
