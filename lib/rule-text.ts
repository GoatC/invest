import { percent, twd } from './format';
import type { Bilingual } from './i18n';
import type { PoolFigures } from './models/portfolio';
import type { CapBreach, Caps } from './models/rules';

/**
 * The bilingual sentence for an R1 or R2 breach. "now" describes the portfolio as it stands
 * (holdings page); "after" describes it once a trade being typed is saved (trade form).
 */
export function breachText(breach: CapBreach, caps: Caps, mood: 'now' | 'after'): Bilingual {
  const weight = percent(breach.weight);
  const limit = percent(breach.limit, 0);
  const trim = twd(breach.trimTwd);
  const is = mood === 'now' ? { en: 'is', zh: '目前占' } : { en: 'would be', zh: '將占' };
  if (breach.rule === 'R1') {
    return {
      en: `R1: ${breach.subject} ${is.en} ${weight} of the regular pool, above the ${limit} single-stock cap. Selling about ${trim} brings it back to the cap.`,
      zh: `R1：${breach.subject} ${is.zh}一般投入資金池的 ${weight}，超過單一個股 ${limit} 上限；賣出約 ${trim} 可回到上限內。`,
    };
  }
  const target = percent(caps.satellite?.targetWeight ?? 0, 0);
  return {
    en: `R2: the satellite ${is.en} ${weight} of the regular pool, above the ${limit} trigger. Trimming about ${trim} brings it back to ${target}.`,
    zh: `R2：衛星部位${is.zh}一般投入資金池的 ${weight}，超過 ${limit} 觸發點；減碼約 ${trim} 可回到 ${target}。`,
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
