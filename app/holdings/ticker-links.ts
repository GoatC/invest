import { LABELS, type Bilingual } from '@/lib/i18n';
import type { Holding } from '@/lib/models/valuation';

/** Where to look at a ticker next: the analyses that read it, by what kind of security it is. */
export function tickerLinks(ticker: string, productType: Holding['productType']): Array<{ href: string; label: Bilingual }> {
  const t = encodeURIComponent(ticker);
  const chart = { href: `/holdings/chart/${t}`, label: { en: 'Price & trades', zh: '走勢與買賣點' } };
  const regression = { href: `/regression?t=${t}`, label: LABELS.regression };
  const security = { href: `/securities/${t}`, label: { en: 'Security and splits', zh: '證券資料與分割' } };
  if (productType === 'stock') {
    return [
      chart,
      { href: `/valuation?t=${t}`, label: { en: 'Valuation workbench', zh: '估值工作台' } },
      { href: `/red-flags?t=${t}`, label: LABELS.redFlags },
      regression,
      { href: '/capm', label: LABELS.costOfEquity },
      security,
    ];
  }
  if (productType === 'equity_etf' || productType === 'theme_etf') {
    return [chart, { href: '/look-through', label: LABELS.lookThrough }, regression, { href: '/costs', label: LABELS.costs }, security];
  }
  return [chart, regression, { href: '/costs', label: LABELS.costs }, security];
}
