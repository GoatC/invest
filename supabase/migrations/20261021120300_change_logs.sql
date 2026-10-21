-- Change logs (PRD Section 4 and N5): every rule edit lands in rule_changes with its old and new
-- values, and every edit or delete of holdings, cash flows, securities, targets, settings and the
-- watchlist lands in audit_log. The trigger functions run as their owner, so they can write logs
-- that stay closed to direct writes, the app owner included.

-- The columns whose value differs between two versions of a row, as {column: value in this_row};
-- updated_at alone is not a change.
create function private.changed_columns(this_row jsonb, other_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb)
  from jsonb_each(this_row) c
  where c.key <> 'updated_at' and other_row -> c.key is distinct from c.value;
$$;
revoke execute on function private.changed_columns(jsonb, jsonb) from public;

create function private.log_rule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_values jsonb := private.changed_columns(to_jsonb(old), to_jsonb(new));
begin
  if old_values <> '{}'::jsonb then
    insert into public.rule_changes (rule_id, changed_by, old_value, new_value)
    values (new.id, auth.uid(), old_values, private.changed_columns(to_jsonb(new), to_jsonb(old)));
  end if;
  return null;
end;
$$;
revoke execute on function private.log_rule_change() from public;

create trigger rules_log_change after update on public.rules
  for each row execute function private.log_rule_change();

-- The trigger argument names the key column, so one function serves every audited table.
create function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb := to_jsonb(old);
  after_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and private.changed_columns(before_row, after_row) = '{}'::jsonb then
    return null;
  end if;
  insert into public.audit_log (table_name, row_key, action, old_row, new_row, changed_by)
  values (tg_table_name, before_row ->> tg_argv[0], lower(tg_op), before_row, after_row, auth.uid());
  return null;
end;
$$;
revoke execute on function private.write_audit_log() from public;

create trigger transactions_audit after update or delete on public.transactions
  for each row execute function private.write_audit_log('id');
create trigger cash_flows_audit after update or delete on public.cash_flows
  for each row execute function private.write_audit_log('id');
create trigger manual_assets_audit after update or delete on public.manual_assets
  for each row execute function private.write_audit_log('id');
create trigger securities_audit after update or delete on public.securities
  for each row execute function private.write_audit_log('ticker');
create trigger asset_classes_audit after update or delete on public.asset_classes
  for each row execute function private.write_audit_log('id');
create trigger config_audit after update or delete on public.config
  for each row execute function private.write_audit_log('key');
create trigger watchlist_audit after update or delete on public.watchlist
  for each row execute function private.write_audit_log('ticker');
