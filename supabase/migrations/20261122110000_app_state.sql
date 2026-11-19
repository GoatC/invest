-- Small pieces of state the app keeps on the server rather than on one phone (docs/design-handoff/04-motion.md):
-- the last NT$100,000 milestone celebrated on the dashboard poster ({"step": 1200000} under key 'milestone'), so a new
-- phone does not celebrate it again, and a fall below a step and a rise past it again celebrates nothing.
create table public.app_state (
  key text primary key check (length(key) between 1 and 60),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.app_state is 'Small state the app keeps on the server, e.g. the last milestone celebrated App 在伺服器保存的小狀態（如最後慶祝的里程碑）';

alter table public.app_state enable row level security;
revoke all on table public.app_state from anon, authenticated, service_role;
grant select, insert, update, delete on table public.app_state to authenticated, service_role;
create policy owner_full_access on public.app_state for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create trigger app_state_touch before update on public.app_state
  for each row execute function private.touch_updated_at();
