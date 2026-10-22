/**
 * What to push, and when (PRD Sections 4 and 5, Phase 1 step 10). Every push names a decision,
 * never a price move (design principle 2): a proposal a rule drafted, the weekly review's three
 * lines, or the data-failure alert. Pushes wait out the quiet hours (config quiet_hours), and each
 * is planned once: a notification's kind and key are unique, so a proposal, a week or a failure
 * streak is pushed once however often the job runs. Pure functions; scripts/notify.ts plans and
 * sends them.
 */
import { money, percent, points, signedPercent, signedTwd, twd } from '../format';
import type { Bilingual } from '../i18n';
import { stateText } from '../proposal-text';
import type { DataHealth } from './data-health';
import { dcaDate, firstSaturday, type ProposalDetail } from './engine';
import type { ClassWeight } from './rules';

// ---------------------------------------------------------------------------
// Time in a time zone (Taipei has no daylight saving, but the setting names its zone)
// ---------------------------------------------------------------------------

export interface LocalTime {
  /** YYYY-MM-DD. */
  date: string;
  /** Minutes since midnight. */
  minutes: number;
  /** 0 is Sunday. */
  weekday: number;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export function localTime(at: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hourCycle: 'h23' })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    minutes: Number(parts['hour']) * 60 + Number(parts['minute']),
    weekday: WEEKDAYS.indexOf(String(parts['weekday']).toLowerCase() as (typeof WEEKDAYS)[number]),
  };
}

/** The instant a local date and minute of the day fall on in a time zone. */
export function instantOf(date: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  // The zone's offset at that moment: the local reading of the guess, less the guess.
  const local = localTime(new Date(guess), timeZone);
  const [ly, lm, ld] = local.date.split('-').map(Number) as [number, number, number];
  const offset = Date.UTC(ly, lm - 1, ld, Math.floor(local.minutes / 60), local.minutes % 60) - guess;
  return new Date(guess - offset);
}

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function clock(value: unknown): number | undefined {
  const match = typeof value === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function zone(value: unknown): string {
  if (typeof value !== 'string') return 'Asia/Taipei';
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return 'Asia/Taipei';
  }
}

// ---------------------------------------------------------------------------
// Quiet hours and the weekly review time (config quiet_hours, weekly_review)
// ---------------------------------------------------------------------------

export interface QuietHours {
  /** Minutes since midnight; the quiet hours may run past midnight (23:00 to 08:00). */
  start: number;
  end: number;
  timeZone: string;
}

export function readQuietHours(value: unknown): QuietHours | null {
  const row = record(value);
  const [start, end] = [clock(row['start']), clock(row['end'])];
  return start === undefined || end === undefined || start === end ? null : { start, end, timeZone: zone(row['time_zone']) };
}

/** When the quiet hours `at` falls in end; null outside them. */
export function quietUntil(at: Date, quiet: QuietHours | null): Date | null {
  if (!quiet) return null;
  const local = localTime(at, quiet.timeZone);
  const wraps = quiet.start > quiet.end;
  const inside = wraps ? local.minutes >= quiet.start || local.minutes < quiet.end : local.minutes >= quiet.start && local.minutes < quiet.end;
  if (!inside) return null;
  // Past midnight, or before a same-day end, they end today; otherwise tomorrow.
  const endsToday = local.minutes < quiet.end;
  return instantOf(endsToday ? local.date : addDays(local.date, 1), quiet.end, quiet.timeZone);
}

export interface WeeklyReview {
  /** 0 is Sunday. */
  weekday: number;
  minutes: number;
  timeZone: string;
}

export function readWeeklyReview(value: unknown): WeeklyReview | null {
  const row = record(value);
  const weekday = WEEKDAYS.indexOf(String(row['day']).toLowerCase() as (typeof WEEKDAYS)[number]);
  const minutes = clock(row['time']);
  return weekday < 0 || minutes === undefined ? null : { weekday, minutes, timeZone: zone(row['time_zone']) };
}

/** The latest weekly review time at or before `at`: its local date (the week's key) and instant. */
export function lastWeeklyReview(at: Date, review: WeeklyReview): { key: string; at: Date } {
  const local = localTime(at, review.timeZone);
  let back = (local.weekday - review.weekday + 7) % 7;
  if (back === 0 && local.minutes < review.minutes) back = 7;
  const date = addDays(local.date, -back);
  return { key: date, at: instantOf(date, review.minutes, review.timeZone) };
}

// ---------------------------------------------------------------------------
// The messages
// ---------------------------------------------------------------------------

export type NotificationKind = 'proposal' | 'weekly' | 'data_failure' | 'test';

/** A push: title and body in both languages, and the page it opens. */
export interface Message {
  kind: NotificationKind;
  /** With the kind, what makes it once only: a proposal's id, a week's date, a failure streak. */
  key: string;
  title: string;
  body: string;
  url: string;
}

function both(text: Bilingual): string {
  return text.en === text.zh ? text.en : `${text.en}\n${text.zh}`;
}

/** What a proposal asks for, in a line each language. */
function proposalAction(condition: string, state: string, detail: ProposalDetail, names: ReadonlyMap<string, Bilingual>): Bilingual {
  switch (condition) {
    case 'single_stock_weight_above': {
      const cap = percent(detail.limit ?? 0, 0);
      return { en: `Trim ${stateText(state)} back to the ${cap} cap.`, zh: `${stateText(state)} 減碼回 ${cap} 上限。` };
    }
    case 'satellite_weight_above': {
      const from = percent(detail.weight ?? 0);
      const to = percent(detail.target ?? 0, 0);
      return { en: `Trim the satellite from ${from} back to ${to}.`, zh: `衛星部位由 ${from} 減碼回 ${to}。` };
    }
    case 'class_drift_exceeds': {
      const classes = (detail.classes ?? []).map((row) => ({ name: names.get(row.id) ?? { en: row.id, zh: row.id }, drift: points(row.weight - row.target) }));
      return {
        en: `Rebalance: ${classes.map((row) => `${row.name.en} ${row.drift}`).join(', ')}.`,
        zh: `再平衡：${classes.map((row) => `${row.name.zh} ${row.drift}`).join('、')}。`,
      };
    }
    case 'day_after_dca':
      return {
        en: `Invest the ${twd(detail.contributionTwd ?? 0)} debited on ${detail.dcaDate ?? '—'} in the most underweight classes.`,
        zh: `把 ${detail.dcaDate ?? '—'} 扣款的 ${twd(detail.contributionTwd ?? 0)} 投入最低配的類別。`,
      };
    case 'first_weekend_of_month':
      return { en: 'The yearly review: rebalance the core to its targets and look over the rules.', zh: '年度檢查：核心類別回到目標，並檢視規則。' };
    case 'us_situs_value_above': {
      const total = money(detail.situsUsd ?? 0, 'USD', 0);
      const limit = money(detail.limitUsd ?? 0, 'USD', 0);
      return { en: `US assets ${total}, above the ${limit} exemption: consider Irish-domiciled ETFs.`, zh: `美國資產 ${total}，超過 ${limit} 免稅額：可考慮愛爾蘭註冊 ETF。` };
    }
    default:
      return { en: 'A rule fired.', zh: '有規則觸發。' };
  }
}

export interface ProposalForPush {
  id: number;
  ruleId: string;
  condition: string;
  /** "R1 · Single-stock trim". */
  title: Bilingual;
  state: string;
  detail: ProposalDetail;
}

/** A new proposal: the rule that fired and what it proposes; it opens the proposal. */
export function proposalMessage(proposal: ProposalForPush, names: ReadonlyMap<string, Bilingual>): Message {
  return {
    kind: 'proposal',
    key: String(proposal.id),
    title: `${proposal.title.en} ${proposal.title.zh.replace(`${proposal.ruleId} · `, '')}`,
    body: both(proposalAction(proposal.condition, proposal.state, proposal.detail, names)),
    url: `/proposals#proposal-${proposal.id}`,
  };
}

/** The weekly review's figures (PRD Section 5). */
export interface WeeklySummary {
  openProposals: number;
  approvedProposals: number;
  /** The core class furthest from its target in the regular pool; null with nothing held. */
  largestDrift: { name: Bilingual; drift: number } | null;
  /** Both pools, TWD, at the newest NAV snapshot and the one a week before it. */
  valueTwd: number | null;
  weekAgoTwd: number | null;
}

/**
 * The figures from what the app holds: proposals by status, the regular pool's class weights, and
 * both pools' value at the newest NAV snapshot and the one a week before.
 */
export function weeklySummary(input: {
  statuses: readonly string[];
  classes: readonly ClassWeight[];
  poolTwd: number;
  valueTwd: number | null;
  weekAgoTwd: number | null;
}): WeeklySummary {
  const core = input.poolTwd > 0 ? input.classes.filter((row) => row.assetClass.sleeve === 'core') : [];
  const furthest = core.reduce<ClassWeight | undefined>((top, row) => (!top || Math.abs(row.drift) > Math.abs(top.drift) ? row : top), undefined);
  return {
    openProposals: input.statuses.filter((status) => status === 'open').length,
    approvedProposals: input.statuses.filter((status) => status === 'approved').length,
    largestDrift: furthest ? { name: { en: furthest.assetClass.nameEn, zh: furthest.assetClass.nameZh }, drift: furthest.drift } : null,
    valueTwd: input.valueTwd,
    weekAgoTwd: input.weekAgoTwd,
  };
}

/** The three lines: rules, allocation, value (PRD Section 5); the dashboard shows the same. */
export function summaryLines(summary: WeeklySummary): Bilingual[] {
  const waiting = summary.openProposals + summary.approvedProposals;
  const rules: Bilingual =
    waiting === 0
      ? { en: 'Rules: all on track.', zh: '規則：全部正常。' }
      : {
          en: `Rules: ${waiting} proposal${waiting === 1 ? '' : 's'} waiting${summary.approvedProposals > 0 ? ` (${summary.approvedProposals} approved, to trade)` : ''}.`,
          zh: `規則：${waiting} 份提案待處理${summary.approvedProposals > 0 ? `（其中 ${summary.approvedProposals} 份已核准、待下單）` : ''}。`,
        };
  const drift: Bilingual = summary.largestDrift
    ? { en: `Allocation: largest drift ${summary.largestDrift.name.en} ${points(summary.largestDrift.drift)}.`, zh: `配置：最大偏離為${summary.largestDrift.name.zh} ${points(summary.largestDrift.drift)}。` }
    : { en: 'Allocation: nothing held yet.', zh: '配置：尚無持股。' };
  let value: Bilingual;
  if (summary.valueTwd === null) {
    value = { en: 'Value: no NAV snapshot yet.', zh: '市值：尚無淨值快照。' };
  } else if (summary.weekAgoTwd === null || summary.weekAgoTwd <= 0) {
    value = { en: `Value: ${twd(summary.valueTwd)}.`, zh: `市值：${twd(summary.valueTwd)}。` };
  } else {
    const change = summary.valueTwd - summary.weekAgoTwd;
    const share = signedPercent(change / summary.weekAgoTwd);
    value = { en: `Value: ${twd(summary.valueTwd)}, ${signedTwd(change)} (${share}) this week.`, zh: `市值：${twd(summary.valueTwd)}，本週 ${signedTwd(change)}（${share}）。` };
  }
  return [rules, drift, value];
}

/** The weekly review push: three lines, each in English then Chinese; it opens the dashboard. */
export function weeklyMessage(summary: WeeklySummary, key: string): Message {
  const lines = summaryLines(summary);
  return {
    kind: 'weekly',
    key,
    title: 'Weekly review 每週檢視',
    body: lines.map((line) => `${line.en} ${line.zh}`).join('\n'),
    url: '/',
  };
}

/** The data-failure alert, once per streak of misses: its key is the last good run before the streak. */
export function dataFailureMessage(health: DataHealth, lastGoodRunId: number | null): Message | undefined {
  if (!health.alert) return undefined;
  return {
    kind: 'data_failure',
    key: `after-run-${lastGoodRunId ?? 0}`,
    title: 'Data failure 資料異常',
    body: both({
      en: `The nightly price job has missed ${health.misses} nights in a row; the app shows the last prices it has. Open Data status.`,
      zh: `每夜價格排程已連續 ${health.misses} 晚未成功；App 沿用最後取得的價格。請查看資料狀態。`,
    }),
    url: '/data',
  };
}

/** A weekly review pushed more than this long after its time is stale (the job was down), and is skipped. */
export const WEEKLY_GRACE_HOURS = 24;

export interface PlanInput {
  now: Date;
  /** Open proposals not pushed yet. */
  proposals: readonly ProposalForPush[];
  names: ReadonlyMap<string, Bilingual>;
  weekly: WeeklyReview | null;
  /** The keys of the weekly reviews already planned. */
  weeklyKeys: ReadonlySet<string>;
  summary: WeeklySummary;
  health: DataHealth;
  lastGoodRunId: number | null;
  quiet: QuietHours | null;
}

/** The pushes due now, each with when it may go: now, or the end of the quiet hours. */
export function plan(input: PlanInput): Array<Message & { sendAfter: Date }> {
  const sendAfter = quietUntil(input.now, input.quiet) ?? input.now;
  const out: Array<Message & { sendAfter: Date }> = input.proposals.map((proposal) => ({ ...proposalMessage(proposal, input.names), sendAfter }));
  if (input.weekly) {
    const last = lastWeeklyReview(input.now, input.weekly);
    const fresh = input.now.getTime() - last.at.getTime() < WEEKLY_GRACE_HOURS * 3_600_000;
    if (fresh && !input.weeklyKeys.has(last.key)) out.push({ ...weeklyMessage(input.summary, last.key), sendAfter });
  }
  const failure = dataFailureMessage(input.health, input.lastGoodRunId);
  if (failure) out.push({ ...failure, sendAfter });
  return out;
}

// ---------------------------------------------------------------------------
// The coming week (dashboard item 7)
// ---------------------------------------------------------------------------

export interface WeekEvent {
  /** YYYY-MM-DD, Taipei. */
  date: string;
  /** HH:MM when the event has a time. */
  time?: string;
  what: Bilingual;
}

function nextMonth(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

/**
 * What falls in the next seven days, today included: the DCA debit (config dca.day_of_month) and
 * the monthly-contribution proposal the day after it, the weekly review, and January's review.
 * Tranche dates (F3) and earnings dates come with Phase 2.
 */
export function comingWeek(today: string, dcaDay: number | null, weekly: WeeklyReview | null, annualMonth: number | null): WeekEvent[] {
  const last = addDays(today, 6);
  const inWeek = (date: string) => date >= today && date <= last;
  const events: WeekEvent[] = [];
  if (dcaDay !== null) {
    const month = today.slice(0, 7);
    for (const candidate of [month, nextMonth(month)]) {
      const debit = dcaDate(candidate, dcaDay);
      if (inWeek(debit)) events.push({ date: debit, what: { en: 'DCA debit', zh: '定期定額扣款' } });
      const proposal = addDays(debit, 1);
      if (inWeek(proposal)) events.push({ date: proposal, what: { en: 'Monthly-contribution proposal', zh: '每月投入提案' } });
    }
  }
  if (weekly) {
    const local = localTime(instantOf(today, 0, weekly.timeZone), weekly.timeZone);
    const date = addDays(today, (weekly.weekday - local.weekday + 7) % 7);
    events.push({ date, time: `${String(Math.floor(weekly.minutes / 60)).padStart(2, '0')}:${String(weekly.minutes % 60).padStart(2, '0')}`, what: { en: 'Weekly review push', zh: '每週檢視推播' } });
  }
  if (annualMonth !== null) {
    for (const year of new Set([today.slice(0, 4), last.slice(0, 4)])) {
      const review = firstSaturday(`${year}-${String(annualMonth).padStart(2, '0')}`);
      if (inWeek(review)) events.push({ date: review, what: { en: 'Annual review proposal', zh: '年度檢查提案' } });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
}
