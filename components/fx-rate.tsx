import { percent } from '@/lib/format';

import { Bi } from './bi';

/** A known TWD rate and its date; estimated when it came from a trade rather than the nightly job. */
export interface KnownRate {
  value: number;
  date: string;
  estimated?: boolean;
}

/** The note under an FX rate field: TWD needs none; else the date's loaded rate, the newest known one, or the broker's. */
export function FxRateHint({ currency, dated, latest }: { currency: string; dated: KnownRate | undefined; latest: KnownRate | undefined }) {
  if (currency === 'TWD') return <Bi en="TWD needs no conversion" zh="台幣不需換算" />;
  if (dated) {
    return (
      <Bi
        en={`Rate of ${dated.date}: ${dated.value}. Your broker's own rate is better if the statement shows one`}
        zh={`${dated.date} 的匯率為 ${dated.value}；對帳單若有券商成交匯率，請以券商為準`}
      />
    );
  }
  if (latest) {
    return (
      <Bi
        en={`No rate loaded for this date; latest known ${latest.value} (${latest.date}${latest.estimated ? ', from a trade' : ''}). Use your broker's rate`}
        zh={`尚無這一天的匯率；最近一筆為 ${latest.value}（${latest.date}${latest.estimated ? '，取自交易紀錄' : ''}），請填券商成交匯率`}
      />
    );
  }
  return <Bi en="Use the rate on your broker statement" zh="請填券商對帳單上的成交匯率" />;
}

/** A typed rate far from the reference one is probably a typo, e.g. 3.24 for 32.4 (config fx_rate_check). */
export function FxTypoWarning({ entered, reference, maxGap }: { entered: number; reference: KnownRate | undefined; maxGap: number | null }) {
  if (maxGap === null || !reference || !(entered > 0) || Math.abs(entered - reference.value) / reference.value <= maxGap) return null;
  return (
    <p className="banner warn">
      <Bi
        en={`This FX rate is more than ${percent(maxGap, 0)} away from ${reference.value} (${reference.date}); check for a typo.`}
        zh={`這個匯率與 ${reference.value}（${reference.date}）相差超過 ${percent(maxGap, 0)}，請確認是否輸入錯誤。`}
      />
    </p>
  );
}
