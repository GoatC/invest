-- Outcomes of the scheduled jobs (Phase 1, step 4). The nightly price and FX job records one row
-- per run, so the app can show how fresh its data is, and the DATA_FAILURE rule can tell when a
-- job has failed several runs in a row. Only the jobs write (service role); the owner reads.

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null check (job ~ '^[a-z][a-z0-9_]*$'),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('ok', 'partial', 'failed')),
  detail jsonb not null default '{}'::jsonb
);
comment on table public.job_runs is 'One row per run of a scheduled job, such as the nightly price and FX job 排程工作的執行紀錄';
comment on column public.job_runs.status is 'ok: everything loaded; partial: some feeds failed; failed: nothing usable loaded 執行結果';
comment on column public.job_runs.detail is 'What each feed returned, per security and FX pair, with any errors 各資料來源的結果與錯誤';
create index job_runs_job_finished_at_idx on public.job_runs (job, finished_at desc);

alter table public.job_runs enable row level security;
revoke all on table public.job_runs from anon, authenticated, service_role;
grant select on table public.job_runs to authenticated;
grant select, insert on table public.job_runs to service_role;
create policy owner_read_only on public.job_runs for select to authenticated using ((select private.is_owner()));
