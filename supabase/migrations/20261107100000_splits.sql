-- Stock splits (N5; PRD Section 9 open question, raised in Phase 1, step 7): a split multiplies the
-- units held, and N5 had no way to record one, so a split security's quantity, value and R1 / R2
-- stayed wrong until a trade was edited. Each row is one split, entered on the security's page:
-- from ex_date on, every share held before it is ratio shares (4 for a 1-into-4 split, 0.1 for a
-- 1-for-10 reverse split). Trades stay as traded; the models read them in today's units
-- (lib/models/splits). Edits and deletes are logged like every holding.

create table public.splits (
  id bigint generated always as identity primary key,
  ticker text not null references public.securities (ticker) on update cascade,
  ex_date date not null,
  ratio numeric not null check (ratio > 0 and ratio <> 1),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint splits_ticker_ex_date_key unique (ticker, ex_date)
);
comment on table public.splits is 'Stock splits: from ex_date on, each share held before it is ratio shares (N5) 股票分割';
comment on column public.splits.ratio is 'New shares per old share: 4 for 1-into-4, 0.1 for a 1-for-10 reverse split 每 1 股舊股換得的新股數';
alter table public.splits enable row level security;
revoke all on table public.splits from anon, authenticated, service_role;
grant select, insert, update, delete on table public.splits to authenticated, service_role;
create policy owner_full_access on public.splits for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create trigger splits_touch before update on public.splits
  for each row execute function private.touch_updated_at();
create trigger splits_audit after update or delete on public.splits
  for each row execute function private.write_audit_log('id');
