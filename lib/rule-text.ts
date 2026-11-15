import type { AlertItem, AlertTone } from './alerts';
import { percent, points, twd } from './format';
import type { Bilingual } from './i18n';
import { satelliteCheck, type ClassDrift, type DriftStatus } from './models/allocation';
import type { PoolFigures } from './models/portfolio';
import { capBreaches, largestStock, regularPool, type CapBreach, type Caps } from './models/rules';
import type { Holding } from './models/valuation';

/**
 * An R1 or R2 breach as a tile that reads at a glance: the weight against its limit on a gauge, the
 * limit, and the trim that brings it back (to the cap for R1, to the target for R2).
 */
export function breachAlert(breach: CapBreach, caps: Caps, tone: AlertTone = 'alert'): AlertItem {
  const trim = twd(breach.trimTwd);
  const limit = percent(breach.limit, 0);
  if (breach.rule === 'R1') {
    return {
      key: `R1:${breach.subject}`,
      tone,
      code: 'R1',
      title: { en: breach.subject, zh: breach.subject },
      value: percent(breach.weight),
      gauge: { value: breach.weight, limit: breach.limit },
      chips: [
        { label: { en: 'Cap', zh: '上限' }, value: limit },
        { label: { en: 'Sell', zh: '賣出' }, value: `≈${trim}` },
      ],
    };
  }
  const target = caps.satellite?.targetWeight;
  return {
    key: 'R2:satellite',
    tone,
    code: 'R2',
    title: { en: 'Satellite', zh: '衛星部位' },
    value: percent(breach.weight),
    gauge: { value: breach.weight, limit: breach.limit, ...(target === undefined ? {} : { target }) },
    chips: [
      { label: { en: 'Trigger', zh: '觸發' }, value: limit },
      { label: { en: 'Trim', zh: '減碼' }, value: `≈${trim}${target === undefined ? '' : ` → ${percent(target, 0)}`}` },
    ],
  };
}

/**
 * How R1 and R2 are worked out, with the figures in play (PRD design principle 4: explain every
 * number). Without figures it states the formulas alone.
 */
export function ruleMath(caps: Caps, pool?: PoolFigures): Bilingual[] {
  const lines: Bilingual[] = [
    {
      en: `Regular pool = the TWD market value of every regular-pool holding${pool ? `: ${twd(pool.totalTwd)}` : ''}. Windfall money and holdings without a value yet are left out.`,
      zh: `一般投入資金池 = 所有一般資金池持股的台幣市值${pool ? `：${twd(pool.totalTwd)}` : ''}。大額資金與尚未估值的持股不計入。`,
    },
  ];
  if (caps.singleStock) {
    const cap = percent(caps.singleStock.maxWeight, 0);
    const most = pool ? twd(caps.singleStock.maxWeight * pool.totalTwd) : undefined;
    lines.push({
      en: `R1: a stock's weight = its value ÷ regular pool; above ${cap}, trim = its value − ${cap} × regular pool.${most ? ` One stock may hold up to ${most}.` : ''}`,
      zh: `R1：個股權重 = 該股市值 ÷ 一般投入資金池；超過 ${cap} 時，減碼金額 = 該股市值 − ${cap} × 一般投入資金池。${most ? `單一個股最多可持有 ${most}。` : ''}`,
    });
  }
  if (caps.satellite) {
    const trigger = percent(caps.satellite.triggerWeight, 0);
    const target = percent(caps.satellite.targetWeight, 0);
    const now =
      pool && pool.totalTwd > 0 ? ` = ${twd(pool.satelliteTwd)} ÷ ${twd(pool.totalTwd)} = ${percent(pool.satelliteTwd / pool.totalTwd)}` : '';
    lines.push({
      en: `R2: satellite weight = satellite value ÷ regular pool${now}; above ${trigger}, trim = satellite value − ${target} × regular pool, back to ${target}.`,
      zh: `R2：衛星部位權重 = 衛星部位市值 ÷ 一般投入資金池${now}；超過 ${trigger} 時，減碼金額 = 衛星部位市值 − ${target} × 一般投入資金池，回到 ${target}。`,
    });
  }
  lines.push({
    en: 'Sale proceeds stay in the regular pool, so a trim leaves its total unchanged. The limits come from the rules table.',
    zh: '賣出所得留在一般投入資金池，所以減碼不改變資金池總額。上限數值來自規則表。',
  });
  return lines;
}

/** Where each row of the rule board opens: the holdings' rule section, or the allocation's bars. */
export const BOARD_HREF = { rules: '/holdings#rules-status', drift: '/allocation' } as const;

const TONE: Record<DriftStatus, AlertTone> = { ok: 'ok', watch: 'watch', rebalance: 'alert', unchecked: 'ok' };

/** A rule that is turned off: its code and name, and the word for it. */
function off(code: string, title: Bilingual, href: string): AlertItem {
  return { key: code, tone: 'watch', code, title, value: '停用', href };
}

/**
 * The rules at a glance, as a line's service board (Liquid Glass proposal C05, the dashboard under
 * the poster): R1, R2 and F8's drift, each always there with its status, whether or not it fires.
 * A rule that fires shows as its warning tile (a stock over the cap, each); one that does not shows
 * how near it is: the largest stock against the cap, the satellite sleeve against its trigger, the
 * core class furthest into its band. The words are the app's own (Hugo, 2026-11-15: the design,
 * every word as it is).
 */
export function ruleBoard(holdings: readonly Holding[], caps: Caps, drifts: readonly ClassDrift[]): AlertItem[] {
  const pool = regularPool(holdings);
  const breaches = capBreaches(holdings, caps);
  const items: AlertItem[] = [];

  const stockCap = caps.singleStock?.maxWeight;
  const overCap = breaches.filter((breach) => breach.rule === 'R1');
  if (stockCap === undefined) items.push(off('R1', { en: 'Single stock', zh: '單一個股' }, BOARD_HREF.rules));
  else if (overCap.length > 0) items.push(...overCap.map((breach) => ({ ...breachAlert(breach, caps), href: BOARD_HREF.rules })));
  else {
    const top = largestStock(pool);
    items.push({
      key: 'R1',
      tone: 'ok',
      code: 'R1',
      title: top ? { en: top.subject, zh: top.subject } : { en: 'Single stock', zh: '單一個股' },
      value: percent(top?.weight),
      ...(top ? { gauge: { value: top.weight, limit: stockCap } } : {}),
      chips: [{ label: { en: 'Cap', zh: '上限' }, value: percent(stockCap, 0) }],
      href: BOARD_HREF.rules,
    });
  }

  const satellite = breaches.find((breach) => breach.rule === 'R2');
  const check = satelliteCheck(pool, caps);
  if (!check) items.push(off('R2', { en: 'Satellite', zh: '衛星部位' }, BOARD_HREF.rules));
  else if (satellite) items.push({ ...breachAlert(satellite, caps), href: BOARD_HREF.rules });
  else {
    items.push({
      key: 'R2',
      tone: TONE[check.status],
      code: 'R2',
      title: { en: 'Satellite', zh: '衛星部位' },
      value: percent(check.weight),
      gauge: { value: check.weight, limit: check.trigger, target: check.target },
      chips: [{ label: { en: 'Trigger', zh: '觸發' }, value: percent(check.trigger, 0) }],
      href: BOARD_HREF.rules,
    });
  }

  // The core class furthest into its band (the share of the band its drift takes), as F8 checks them.
  const checked = drifts.filter((row): row is ClassDrift & { band: number } => row.band !== null && row.status !== 'unchecked');
  const furthest = checked.reduce<(ClassDrift & { band: number }) | undefined>((best, row) => (!best || Math.abs(row.drift) / row.band > Math.abs(best.drift) / best.band ? row : best), undefined);
  if (!furthest) {
    if (!drifts.some((row) => row.band !== null)) items.push(off('F8', { en: 'Drift', zh: '偏離' }, BOARD_HREF.drift));
  } else {
    items.push({
      key: 'F8',
      tone: TONE[furthest.status],
      code: 'F8',
      title: { en: furthest.assetClass.nameEn, zh: furthest.assetClass.nameZh },
      value: points(furthest.drift),
      gauge: { value: Math.abs(furthest.drift), limit: furthest.band },
      chips: [{ label: { en: 'F8 band', zh: 'F8 門檻' }, value: `${(furthest.band * 100).toFixed(1)} pp` }],
      href: BOARD_HREF.drift,
    });
  }
  return items;
}
