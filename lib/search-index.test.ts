import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GROUPS, MAIN } from '@/components/nav-pages';

import { buildSearchIndex, highlight, searchIndex } from './search-index';

const INDEX = buildSearchIndex(MAIN, GROUPS, [
  { ticker: '2330', name: '台積電' },
  { ticker: 'VT', name: 'Vanguard Total World Stock ETF' },
]);
const titles = (query: string) => searchIndex(INDEX, query).map((entry) => entry.title);

describe('buildSearchIndex', () => {
  it('holds every page and sub-tab of the navigation once, with where it lives', () => {
    const stress = INDEX.find((entry) => entry.href === '/stress');
    assert.equal(stress?.title, '壓力測試');
    assert.equal(stress?.where, '資產配置');
    assert.equal(INDEX.filter((entry) => entry.href === '/allocation' && entry.kind === 'page').length, 1);
    assert.equal(new Set(INDEX.map((entry) => entry.key)).size, INDEX.length);
  });

  it('holds each holding, opening its chart', () => {
    assert.deepEqual(
      INDEX.filter((entry) => entry.kind === 'holding').map((entry) => entry.href),
      ['/holdings/chart/2330', '/holdings/chart/VT'],
    );
  });
});

describe('searchIndex', () => {
  // The acceptance examples in docs/design-handoff/02-components.md.
  it('「風險」 finds 風險值 and 壓力測試', () => {
    const found = titles('風險');
    assert.ok(found.includes('風險值（整個投資組合）'), found.join('、'));
    assert.ok(found.includes('壓力測試'), found.join('、'));
  });

  it('「VaR」 finds 風險值, in any case', () => {
    assert.ok(titles('VaR').includes('風險值（整個投資組合）'));
    assert.ok(titles('var').includes('風險值（整個投資組合）'));
  });

  it('「2330」 finds 台積電', () => {
    assert.equal(titles('2330')[0], '台積電 2330');
  });

  it('puts a name that starts with the query first', () => {
    assert.equal(titles('風險值')[0], '風險值（整個投資組合）');
  });

  it('finds nothing for an empty query or one that matches nothing', () => {
    assert.deepEqual(searchIndex(INDEX, '   '), []);
    assert.deepEqual(searchIndex(INDEX, 'zzzz'), []);
  });
});

describe('highlight', () => {
  it('splits the name around the first match', () => {
    assert.deepEqual(highlight('風險值（整個投資組合）', '風險'), ['', '風險', '值（整個投資組合）']);
    assert.deepEqual(highlight('Vanguard VT', 'vt'), ['Vanguard ', 'VT', '']);
    assert.deepEqual(highlight('壓力測試', 'x'), ['壓力測試', '', '']);
  });
});
