-- Phase 1, step 9: the rules engine (PRD Section 4) evaluates R1, R2, F8_DRIFT,
-- MONTHLY_CONTRIBUTION and ANNUAL_REVIEW after each nightly refresh, or when the owner asks, and
-- drafts a proposal when one fires. The proposals table gains what that needs:
--
-- state: what the rule fired on, e.g. the stock over R1's cap or the classes past F8's band, or
--   the month of a contribution. A rule fires at most once per cooldown_days unless this changes.
-- detail: the figures behind the proposal (weights, limits, the pool), so the page can explain it.
-- closed_reason: why the engine closed an open proposal: it timed out (config proposal_expiry_days),
--   the rule no longer fires, or a newer state superseded it.
-- filled_at: when the owner marked the approved orders as traded.
--
-- At most one open proposal per rule and state, so two runs at once cannot draft it twice. Every
-- change to a proposal (approve, edit, dismiss, fill, expire) lands in audit_log.
alter table public.proposals
  add column state text not null default '',
  add column detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  add column closed_reason text check (closed_reason in ('timed_out', 'cleared', 'superseded')),
  add column filled_at timestamptz;

comment on column public.proposals.state is 'What the rule fired on; a rule fires at most once per cooldown_days unless this changes 觸發時的狀態';
comment on column public.proposals.detail is 'The figures behind the proposal, for its explanation 提案依據的數字';
comment on column public.proposals.closed_reason is 'Why the engine closed it: timed_out, cleared (the rule no longer fires) or superseded 系統關閉提案的原因';
comment on column public.proposals.filled_at is 'When the approved orders were marked as traded 標記成交的時間';

create unique index proposals_one_open_per_state_idx on public.proposals (rule_id, state) where status = 'open';
create index proposals_rule_id_created_at_idx on public.proposals (rule_id, created_at);

create trigger proposals_audit after update or delete on public.proposals
  for each row execute function private.write_audit_log('id');
