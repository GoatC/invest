-- Single-owner row-level security (CLAUDE.md: single user, row-level security on every table).
--
-- The app has exactly one owner: the Supabase Auth user recorded in private.app_owner. Every
-- table in public has row-level security on, with policies that let only that user in.
-- Supabase projects created after 2026-05-30 grant no table privileges by default, so the grants
-- here are explicit: nothing for anon, owner-checked access for authenticated, and full access
-- for service_role, which the nightly jobs use and which bypasses row-level security. Revoking
-- first also strips the broader defaults that older projects grant.

create table private.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table private.app_owner is 'The one Supabase Auth user who owns all data; set once in the SQL Editor 唯一擁有者（在 SQL Editor 設定一次）';
-- No grants and no policies: only the postgres role (SQL Editor, migrations) reads or sets it.
alter table private.app_owner enable row level security;

create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.app_owner o where o.user_id = (select auth.uid()));
$$;
comment on function private.is_owner() is 'True when the caller is the app owner; every policy uses it 呼叫者是否為擁有者';
revoke execute on function private.is_owner() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_owner() to authenticated;

-- Tables the owner reads and changes through the app.
do $$
declare
  t text;
begin
  foreach t in array array[
    'asset_classes', 'securities', 'transactions', 'cash_flows', 'manual_assets', 'prices', 'fx_rates',
    'nav_snapshots', 'rules', 'proposals', 'windfall_plan', 'windfall_tranches', 'valuations',
    'beta_results', 'red_flags', 'attribution', 'watchlist', 'config', 'push_subscriptions'
  ] loop
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

-- Change logs are written only by triggers: the owner and the jobs can read them, nobody rewrites them.
do $$
declare
  t text;
begin
  foreach t in array array['rule_changes', 'audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated, service_role', t);
    execute format('create policy owner_read_only on public.%I for select to authenticated using ((select private.is_owner()))', t);
  end loop;
end;
$$;
