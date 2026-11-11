import Link from 'next/link';

import type { Bilingual } from '@/lib/i18n';

type Tab = 'chart' | 'value' | 'flags' | 'beta';

const LABEL: Record<Tab, Bilingual> = {
  chart: { en: 'Price & trades', zh: '走勢' },
  value: { en: 'Valuation', zh: '估值' },
  flags: { en: 'Red flags', zh: '紅旗' },
  beta: { en: 'Regression', zh: 'β' },
};

/**
 * One way in for a security (PRD Section 5, "Phone redesign", step 5): its price chart, and for a
 * single stock its valuation and red flags, then its β, as a row of sub-tabs at the top of each of
 * those pages, so a holding's analyses are one tap apart instead of four menu entries.
 */
export function TickerTabs({ ticker, stock, current }: { ticker: string; stock: boolean; current: Tab }) {
  const t = encodeURIComponent(ticker);
  const tabs: Array<{ tab: Tab; href: string }> = [
    { tab: 'chart', href: `/holdings/chart/${t}` },
    ...(stock ? [{ tab: 'value' as const, href: `/valuation?t=${t}` }, { tab: 'flags' as const, href: `/red-flags?t=${t}` }] : []),
    { tab: 'beta', href: `/regression?t=${t}` },
  ];
  return (
    <nav className="sub-nav ticker-tabs" aria-label={`${ticker} 分析 analyses`}>
      <Link href="/holdings" className="back" lang="zh-Hant" aria-label="持倉 Holdings">
        ‹ 持倉
      </Link>
      <strong>{ticker}</strong>
      {tabs.map(({ tab, href }) => (
        <Link key={tab} href={href} lang="zh-Hant" aria-label={`${LABEL[tab].zh} ${LABEL[tab].en}`} aria-current={tab === current ? 'page' : undefined} className={tab === current ? 'current' : undefined}>
          {LABEL[tab].zh}
        </Link>
      ))}
    </nav>
  );
}
