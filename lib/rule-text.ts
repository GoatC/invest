import type { AlertItem, AlertTone } from './alerts';
import { percent, twd } from './format';
import type { Bilingual } from './i18n';
import type { PoolFigures } from './models/portfolio';
import type { CapBreach, Caps } from './models/rules';

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
