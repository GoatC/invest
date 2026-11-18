-- Asked by Hugo on 2026-11-18: an iPhone home-screen widget with the portfolio's value at the last
-- close (both pools), the dashboard poster's 7-day change and its line, read at a glance
-- (docs/superpowers/specs/2026-11-18-ios-widget-design.md).
--
-- A widget cannot share the app's sign-in under free signing (no App Group), so it carries a key of
-- its own that reads these figures and nothing else:
--
-- widget_snapshot: the one row the widget shows, written by the nightly job (lib/models/widget.ts)
--   from the same daily series the dashboard draws; the refresh button runs that job too.
-- widget_key: the SHA-256 of the key made on the push page; the key itself is shown once and never
--   stored. Making a new one replaces it, and the old key stops at once.
-- widget_figures(key): the only thing anon may call. It answers null unless the key matches, so a
--   wrong or replaced key learns nothing; with the right key it answers the row (or null before the
--   first night) and the config's stale days.
-- config widget: stale_days, how old a close may be before the widget marks its date ⚠︎.

create table public.widget_snapshot (
  singleton boolean primary key default true check (singleton),
  as_of date not null,
  total_twd numeric not null check (total_twd >= 0),
  week_change numeric,
  points jsonb not null check (jsonb_typeof(points) = 'array'),
  red_up boolean not null,
  updated_at timestamptz not null default now()
);
comment on table public.widget_snapshot is 'The home-screen widget''s figures at the last close, from the nightly job 主畫面小工具的數字（最近收盤）';
comment on column public.widget_snapshot.total_twd is 'Both pools at the close, TWD (nav_snapshots.total_twd) 兩個資金池合計';
comment on column public.widget_snapshot.week_change is 'The poster''s 7-day time-weighted return, 0.01 is +1%; null while younger than a week 近 7 天漲跌';
comment on column public.widget_snapshot.points is 'The poster''s line: cumulative returns since the first day, oldest first, at most 40 走勢線';
comment on column public.widget_snapshot.red_up is 'config sectors colour: red up (Taiwan) or green up 紅漲綠跌與否';

create table public.widget_key (
  singleton boolean primary key default true check (singleton),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
comment on table public.widget_key is 'SHA-256 of the widget''s read-only key; the key itself is never stored 小工具鑰匙的雜湊（不存原文）';

do $$
declare
  t text;
begin
  foreach t in array array['widget_snapshot', 'widget_key'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated, service_role', t);
    execute format(
      'create policy owner_full_access on public.%I for all to authenticated '
      'using ((select private.is_owner())) with check ((select private.is_owner()))',
      t
    );
  end loop;
end;
$$;

create function public.widget_figures(key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'figures', (
      select jsonb_build_object('as_of', s.as_of, 'total_twd', s.total_twd, 'week_change', s.week_change, 'points', s.points, 'red_up', s.red_up)
      from public.widget_snapshot s
    ),
    'stale_days', (select (c.value ->> 'stale_days')::int from public.config c where c.key = 'widget')
  )
  from public.widget_key k
  where length(key) between 43 and 128
    and k.key_hash = encode(sha256(convert_to(key, 'UTF8')), 'hex');
$$;
comment on function public.widget_figures(text) is 'The widget''s figures for its key, else null; the only thing anon may call 依鑰匙回傳小工具數字';
revoke execute on function public.widget_figures(text) from public;
grant execute on function public.widget_figures(text) to anon, authenticated, service_role;

insert into public.config (key, value, desc_en, desc_zh) values
  ('widget', '{"stale_days": 3}', 'Home-screen widget: a close older than this many days shows ⚠︎ beside its date', '主畫面小工具：收盤日期早於幾天即在日期旁標示 ⚠︎');
