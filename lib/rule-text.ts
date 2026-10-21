import { percent, twd } from './format';
import type { Bilingual } from './i18n';
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
