-- Asked by Hugo on 2026-11-12: a proposal becomes a standing warning that can be dismissed. A fired
-- rule still drafts a row in proposals, with its figures and the orders it suggests, but there is
-- no approve, edit or mark-filled step any more: the warning stays open until Hugo dismisses it, its
-- rule no longer fires, or a new state supersedes it. It never times out.
--
-- - An approved proposal waiting for its trades goes back to open: it shows as a warning again.
--   Should another open row share its rule and state (impossible while the engine drafted at most
--   one live row a state, but checked to keep the unique index), the approved one is dismissed.
-- - expires_at is cleared on open rows; new rows leave it empty. The column, filled_at and the
--   statuses filled and timed_out stay for the history drafted before this day.
-- - The status check refuses approved from now on.
-- - config proposal_expiry_days keeps one use: how many days after the debit the monthly
--   contribution still fires.

update public.proposals p
set status = 'dismissed', decided_at = coalesce(p.decided_at, now())
where p.status = 'approved'
  and exists (select 1 from public.proposals o where o.status = 'open' and o.rule_id = p.rule_id and o.state = p.state);

update public.proposals set status = 'open' where status = 'approved';

update public.proposals set expires_at = null where status = 'open' and expires_at is not null;

alter table public.proposals drop constraint proposals_status_check;
alter table public.proposals add constraint proposals_status_check check (status in ('open', 'dismissed', 'filled', 'expired'));

comment on table public.proposals is 'Rule warnings (L2): a fired rule drafts one with its figures and suggested orders; it stays open until dismissed or the rule clears 規則警示';
comment on column public.proposals.status is 'open: a standing warning; dismissed: set aside by Hugo; expired: closed by the engine; filled: history before 2026-11-12 狀態';
comment on column public.proposals.expires_at is 'History only: before 2026-11-12 an open proposal closed on this time 歷史欄位';
comment on column public.proposals.filled_at is 'History only: when approved orders were marked traded, before 2026-11-12 歷史欄位';

update public.config
set desc_en = 'Days after the DCA debit the monthly contribution still fires; warnings never time out (since 2026-11-12).',
    desc_zh = '每月投入提醒在扣款後持續的天數；警示不會逾時關閉（2026-11-12 起）。'
where key = 'proposal_expiry_days';
