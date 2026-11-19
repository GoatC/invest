/**
 * The search behind the dashboard's search button (Ink design, Hugo 2026-11-18, docs/design-handoff/02-components.md):
 * like pulling down on the iPhone home screen, one field finds any page, sub-tab, setting, holding or explanation.
 * Each entry carries its Chinese name, where it lives, and keywords in Chinese and English, so 「風險」, 「VaR」 and
 * 「2330」 each find what they name.
 */

import type { Bilingual } from './i18n';

export type SearchKind = 'page' | 'holding' | 'setting' | 'help';

export interface SearchEntry {
  /** Unique within the index. */
  key: string;
  kind: SearchKind;
  /** The name shown, in Chinese. */
  title: string;
  /** Where it lives, e.g. 「儀表板 › 本週」. */
  where: string;
  href: string;
  /** Lower-cased words it is also found by. */
  keywords: readonly string[];
}

export interface NavPageLike {
  href: string;
  label: Bilingual;
  sub?: readonly NavPageLike[];
}

export interface NavGroupLike {
  label: Bilingual;
  pages: readonly NavPageLike[];
}

export interface HoldingLike {
  ticker: string;
  name: string;
}

/** Things inside a page that a search should reach though no tab names them. */
export const EXTRA_ENTRIES: readonly SearchEntry[] = [
  { key: 'var', kind: 'page', title: '風險值（整個投資組合）', where: '儀表板 › 本週', href: '/#value-at-risk', keywords: ['風險', 'var', 'value at risk', 'risk'] },
  { key: 'rules-board', kind: 'page', title: '規則', where: '儀表板 › 本週', href: '/#rule-board', keywords: ['r1', 'r2', '5/25', 'f8', 'rules', '上限'] },
  { key: 'coming-week', kind: 'page', title: '下週事件', where: '儀表板 › 本週', href: '/', keywords: ['事件', 'calendar', 'events', 'fomc', 'cpi'] },
  { key: 'assumptions', kind: 'setting', title: '資本市場假設', where: '配置 › 目標', href: '/allocation/assumptions', keywords: ['假設', 'cma', 'expected return', '預期報酬', '波動'] },
  { key: 'targets', kind: 'setting', title: '目標權重', where: '配置 › 目標', href: '/allocation/targets', keywords: ['目標', 'targets', 'weights', '權重'] },
  { key: 'rules-settings', kind: 'setting', title: '規則與門檻', where: '設定 › 規則', href: '/rules', keywords: ['門檻', 'thresholds', '規則', 'rules', '風險值設定'] },
  { key: 'colour', kind: 'setting', title: '漲跌顏色', where: '配置 › 產業熱圖', href: '/sectors#settings', keywords: ['紅漲綠跌', '綠漲紅跌', 'colour', 'color', '顏色'] },
  { key: 'var-help', kind: 'help', title: '風險值是什麼？', where: '儀表板 › 風險值 ⓘ', href: '/#value-at-risk', keywords: ['風險值', 'var', '說明'] },
];

/** Words a page is also found by, beyond its own names. */
export const PAGE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  '/stress': ['風險', 'risk', '情境', 'scenario'],
  '/volatility': ['風險', '波動', 'vix'],
  '/frontier': ['最佳化', 'optimise', 'optimize'],
  '/look-through': ['成分股', 'exposure', '曝險'],
  '/sectors': ['熱圖', 'heatmap', '紅漲綠跌'],
  '/monte-carlo': ['模擬', 'simulation', '退休'],
  '/plan': ['複利', 'compound', '退休'],
  '/notifications': ['通知', 'push', '推播'],
  '/data': ['資料', 'nightly', '更新'],
  '/import': ['匯入', 'csv', '對帳單'],
};

/** The index: every page and sub-tab of the navigation, every holding, and the extra entries. */
export function buildSearchIndex(main: readonly NavPageLike[], groups: readonly NavGroupLike[], holdings: readonly HoldingLike[], extra: readonly SearchEntry[] = EXTRA_ENTRIES): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: SearchEntry) => {
    if (seen.has(entry.key)) return;
    seen.add(entry.key);
    entries.push(entry);
  };
  const words = (label: Bilingual, href?: string) => [label.zh.toLowerCase(), label.en.toLowerCase(), ...(href ? (PAGE_KEYWORDS[href] ?? []) : [])];
  for (const page of main) {
    add({ key: `page:${page.href}`, kind: 'page', title: page.label.zh, where: page.label.zh, href: page.href, keywords: words(page.label, page.href) });
    for (const sub of page.sub ?? []) {
      if (sub.href === page.href) continue;
      add({ key: `page:${sub.href}`, kind: 'page', title: sub.label.zh, where: page.label.zh, href: sub.href, keywords: words(sub.label, sub.href) });
    }
  }
  for (const group of groups) {
    for (const page of group.pages) add({ key: `page:${page.href}`, kind: 'page', title: page.label.zh, where: group.label.zh, href: page.href, keywords: words(page.label, page.href) });
  }
  for (const holding of holdings) {
    add({ key: `holding:${holding.ticker}`, kind: 'holding', title: `${holding.name} ${holding.ticker}`, where: '持倉', href: `/holdings/chart/${encodeURIComponent(holding.ticker)}`, keywords: [holding.ticker.toLowerCase(), holding.name.toLowerCase()] });
  }
  for (const entry of extra) add(entry);
  return entries;
}

/** How well an entry matches: 3 its name starts with the query, 2 its name holds it, 1 a keyword holds it, 0 no match. */
function score(entry: SearchEntry, query: string): number {
  const title = entry.title.toLowerCase();
  if (title.startsWith(query)) return 3;
  if (title.includes(query)) return 2;
  return entry.keywords.some((word) => word.includes(query)) ? 1 : 0;
}

/** The entries for a query, best first (ties keep the index's order); an empty query finds nothing. */
export function searchIndex(index: readonly SearchEntry[], query: string, limit = 20): SearchEntry[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [];
  return index
    .map((entry, order) => ({ entry, order, score: score(entry, wanted) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((hit) => hit.entry);
}

/** The name split around the first match, for drawing the matched characters bold. */
export function highlight(title: string, query: string): [string, string, string] {
  const wanted = query.trim();
  const at = wanted ? title.toLowerCase().indexOf(wanted.toLowerCase()) : -1;
  if (at < 0) return [title, '', ''];
  return [title.slice(0, at), title.slice(at, at + wanted.length), title.slice(at + wanted.length)];
}
