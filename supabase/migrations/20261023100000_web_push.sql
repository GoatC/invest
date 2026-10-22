-- Phase 1, step 10: Web Push. Every push is a row here before it goes out: the outbox and the log
-- in one. A proposal, a week's review or a failure streak is pushed once, however often the jobs
-- run, as a notification's kind and key are unique; one planned in the quiet hours (config
-- quiet_hours) waits until send_after. The jobs plan and send with the secret key; the owner reads
-- the log, and plans the test push the app sends from the notifications page.
--
-- push_subscriptions (core schema) holds each device the owner turned notifications on for; a
-- device now also records when it was last sent to and why the last send failed.

create table public.notifications (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('proposal', 'weekly', 'data_failure', 'test')),
  key text not null,
  title text not null,
  body text not null,
  url text not null default '/' check (url ~ '^/'),
  created_at timestamptz not null default now(),
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  delivered integer check (delivered >= 0),
  error text,
  unique (kind, key)
);
comment on table public.notifications is 'Web Push outbox and log: each push once per kind and key, held through the quiet hours 推播待送與紀錄';
comment on column public.notifications.key is 'With the kind, what makes it once only: a proposal id, a week''s date, a failure streak 唯一識別';
comment on column public.notifications.send_after is 'Not sent before this: the end of the quiet hours when planned inside them 最早發送時間（安靜時段後）';
comment on column public.notifications.delivered is 'Devices the push services accepted it for 送達的裝置數';
create index notifications_unsent_idx on public.notifications (send_after) where sent_at is null;

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated, service_role;
grant select, insert, update on table public.notifications to authenticated;
grant select, insert, update on table public.notifications to service_role;
create policy owner_full_access on public.notifications for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

alter table public.push_subscriptions
  add column last_error text;
comment on column public.push_subscriptions.last_error is 'Why the last push to this device was refused, if it was 最近一次推播失敗的原因';
