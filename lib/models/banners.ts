/**
 * The in-app banner (asked by Hugo on 2026-11-12): one line under the header that says what waits
 * on him and takes him there, so the app leads the next step instead of leaving it to be found.
 * Pure: given what is saved, it decides which banners are needed, in order of urgency.
 *
 * A banner shows when:
 * - dividend: a dividend's payment day has come and no cash flow records it (lib/models/dividends);
 * - proposals: a rule warning stands (an open proposal), until Hugo dismisses it or the rule clears;
 * - windfall_balance: the windfall arrived (a cash flow) but the windfall pool holds no TWD balance
 *   and nothing was bought from it, so the planner has no cash to split;
 * - windfall_plan: the windfall pool holds cash and no plan has been started;
 * - stale_balance: a TWD balance was last updated more than balance_stale_days ago;
 * - first_trade: nothing is recorded yet;
 * - push: no device has push turned on, so no warning or dividend would reach Hugo.
 *
 * ✕ hides a banner for snooze_days (banner_dismissals); its key changes when its subject does (a
 * new warning, another dividend), so the next one shows at once. A banner never shows on the page
 * it leads to.
 */
import { daysBetween } from '../dates';
import { twd } from '../format';
import type { Bilingual } from '../i18n';
import { dueKey, estimateText, recordHref, type DividendDue } from './dividends';
import type { Pool } from './types';

export const BANNER_KINDS = ['dividend', 'proposals', 'windfall_balance', 'windfall_plan', 'stale_balance', 'first_trade', 'push'] as const;
export type BannerKind = (typeof BANNER_KINDS)[number];

export interface BannerSettings {
  enabled: boolean;
  /** How long ✕ hides a banner. */
  snoozeDays: number;
  /** A TWD balance older than this is asked about. */
  balanceStaleDays: number;
  kinds: Record<BannerKind, boolean>;
}

/** config banners; undefined before its migration or when malformed. */
export function readBannerSettings(value: unknown): BannerSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const whole = (found: unknown, max: number) => (typeof found === 'number' && Number.isInteger(found) && found >= 1 && found <= max ? found : undefined);
  const snoozeDays = whole(row['snooze_days'], 365);
  const balanceStaleDays = whole(row['balance_stale_days'], 3650);
  if (snoozeDays === undefined || balanceStaleDays === undefined) return undefined;
  const kinds = typeof row['kinds'] === 'object' && row['kinds'] !== null ? (row['kinds'] as Record<string, unknown>) : {};
  return {
    enabled: row['enabled'] !== false,
    snoozeDays,
    balanceStaleDays,
    kinds: Object.fromEntries(BANNER_KINDS.map((kind) => [kind, kinds[kind] !== false])) as Record<BannerKind, boolean>,
  };
}

export interface Banner {
  /** What ✕ remembers; it changes with the banner's subject. */
  key: string;
  kind: BannerKind;
  /** act: something to record or decide; info: a step worth taking. */
  tone: 'act' | 'info';
  /** One short line. */
  text: Bilingual;
  action: { label: Bilingual; href: string };
  /** The pages it does not show on: where it leads, or where the same thing already shows. */
  hideOn: string[];
  /** A dividend's "skip": answers it for good, unlike ✕. */
  skip?: { eventId: number; pool: Pool };
}

export interface BannerInput {
  /** The dividends to ask about, the newest first. */
  dividends: readonly DividendDue[];
  /** The standing rule warnings (open proposals). */
  proposals: ReadonlyArray<{ id: number }>;
  windfall: {
    /** What the windfall cash flows add up to, and the newest one's date. */
    arrivedTwd: number;
    lastArrival: string | null;
    /** TWD balances in the windfall pool. */
    cashTwd: number;
    /** Whether anything was ever bought in the windfall pool. */
    traded: boolean;
    hasPlan: boolean;
  };
  /** TWD balances (savings, money-market funds) with the day each was last valued. */
  balances: ReadonlyArray<{ id: number; name: string; valuedOn: string | null }>;
  trades: number;
  assets: number;
  /** Devices with push on; null when unknown (then no banner). */
  devices: number | null;
  /** banner_dismissals: key → the day it may show again. */
  dismissed: ReadonlyMap<string, string>;
}

/** The banners needed today, the most pressing first. */
export function guideBanners(input: BannerInput, settings: BannerSettings, today: string): Banner[] {
  if (!settings.enabled) return [];
  const out: Banner[] = [];

  const [dividend] = input.dividends;
  if (dividend && input.dividends.length === 1) {
    out.push({
      key: `dividend:${dueKey(dividend)}`,
      kind: 'dividend',
      tone: 'act',
      text: { en: `${dividend.event.ticker} dividend, about ${estimateText(dividend)}: record it?`, zh: `${dividend.event.ticker} 配息約 ${estimateText(dividend)}，要記一筆嗎？` },
      action: { label: { en: 'Record', zh: '記一筆' }, href: recordHref(dividend) },
      hideOn: ['/cash-flows'],
      skip: { eventId: dividend.event.id, pool: dividend.pool },
    });
  } else if (dividend) {
    out.push({
      key: `dividend:${input.dividends.map(dueKey).sort().join(',')}`.slice(0, 120),
      kind: 'dividend',
      tone: 'act',
      text: { en: `${input.dividends.length} dividends to confirm.`, zh: `${input.dividends.length} 筆配息待確認。` },
      action: { label: { en: 'See', zh: '查看' }, href: '/holdings#dividends-due' },
      hideOn: ['/cash-flows', '/holdings'],
    });
  }

  const open = input.proposals;
  if (open.length > 0) {
    out.push({
      key: `proposals:open:${Math.max(...open.map((proposal) => proposal.id))}`,
      kind: 'proposals',
      tone: 'act',
      text: { en: `${open.length} rule warning${open.length === 1 ? '' : 's'}.`, zh: `${open.length} 則規則警示。` },
      action: { label: { en: 'See', zh: '查看' }, href: open.length === 1 ? `/#proposal-${open[0]?.id}` : '/#proposals' },
      hideOn: ['/', '/holdings', '/proposals'],
    });
  }

  const { windfall } = input;
  if (windfall.arrivedTwd > 0 && windfall.cashTwd <= 0 && !windfall.traded && !windfall.hasPlan) {
    out.push({
      key: `windfall_balance:${windfall.lastArrival ?? ''}`,
      kind: 'windfall_balance',
      tone: 'info',
      text: { en: `The windfall of ${twd(windfall.arrivedTwd)} arrived: add its TWD balance.`, zh: `大額資金 ${twd(windfall.arrivedTwd)} 已入帳：新增它的台幣餘額。` },
      action: { label: { en: 'Add', zh: '新增' }, href: '/assets/new?pool=windfall' },
      hideOn: ['/assets'],
    });
  } else if (windfall.cashTwd > 0 && !windfall.hasPlan) {
    out.push({
      key: `windfall_plan:${windfall.lastArrival ?? ''}`,
      kind: 'windfall_plan',
      tone: 'info',
      text: { en: `${twd(windfall.cashTwd)} of windfall cash has no tranche plan.`, zh: `大額資金 ${twd(windfall.cashTwd)} 尚未排分批計畫。` },
      action: { label: { en: 'Plan', zh: '去規劃' }, href: '/windfall' },
      hideOn: ['/windfall'],
    });
  }

  // The balance left longest: one banner, not one per account.
  const stale = input.balances
    .flatMap((balance) => (balance.valuedOn ? [{ ...balance, days: daysBetween(balance.valuedOn, today) }] : []))
    .filter((balance) => balance.days > settings.balanceStaleDays)
    .sort((a, b) => b.days - a.days)[0];
  if (stale) {
    out.push({
      key: `stale_balance:${stale.id}:${stale.valuedOn}`,
      kind: 'stale_balance',
      tone: 'info',
      text: { en: `${stale.name}: balance not updated for ${stale.days} days.`, zh: `${stale.name}：餘額已 ${stale.days} 天未更新。` },
      action: { label: { en: 'Update', zh: '更新' }, href: `/assets/${stale.id}` },
      hideOn: ['/assets'],
    });
  }

  if (input.trades === 0 && input.assets === 0) {
    out.push({
      key: 'first_trade',
      kind: 'first_trade',
      tone: 'info',
      text: { en: 'Start with your first buy.', zh: '從第一筆買進開始。' },
      action: { label: { en: 'Add trade', zh: '新增交易' }, href: '/holdings#add-trade' },
      hideOn: ['/holdings', '/import'],
    });
  } else if (input.devices === 0) {
    out.push({
      key: 'push',
      kind: 'push',
      tone: 'info',
      text: { en: 'Push is off: warnings and dividends will not reach you.', zh: '尚未開啟推播：警示與配息不會通知你。' },
      action: { label: { en: 'Turn on', zh: '去開啟' }, href: '/notifications' },
      hideOn: ['/notifications'],
    });
  }

  return out.filter((banner) => settings.kinds[banner.kind] && !((input.dismissed.get(banner.key) ?? '') > today));
}

/** Whether a banner stays off a page: the page it leads to, or one under it. "/" is the dashboard alone. */
export function hiddenOn(banner: Pick<Banner, 'hideOn'>, path: string): boolean {
  return banner.hideOn.some((prefix) => (prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`)));
}
