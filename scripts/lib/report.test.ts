import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { agguVerdict, cell, coverageOf, formatBytes, renderReport } from './report.ts';
import { TICKERS } from './tickers.ts';
import type { RunReport, SourceResult, TickerSpec } from './types.ts';

function source(overrides: Partial<SourceResult>): SourceResult {
  return {
    id: 'x',
    name: 'Example',
    short: 'Ex',
    row: 'Row',
    usedBy: 'F1',
    auth: 'none',
    documentedLimit: 'none',
    checkedAt: '2026-10-21 05:00:00',
    status: 'ok',
    calls: [],
    observedLimits: [],
    coverage: {},
    series: [],
    previews: [],
    notes: [],
    skipped: [],
    ...overrides,
  };
}

function ticker(id: string): TickerSpec {
  const found = TICKERS.find((t) => t.id === id);
  assert.ok(found, `ticker ${id}`);
  return found;
}

describe('coverageOf', () => {
  it('uses what the probe set', () => {
    assert.deepEqual(coverageOf(source({ coverage: { VT: { mark: 'yes', detail: 'd' } }, coverageMarkets: ['US'] }), ticker('VT')), { mark: 'yes', detail: 'd' });
  });

  it('fills unset cells from the source scope and status', () => {
    const tw = source({ coverageMarkets: ['TW'] });
    assert.equal(coverageOf(tw, ticker('VT')).mark, 'na');
    assert.equal(coverageOf(tw, ticker('0050')).mark, 'unchecked');
    assert.equal(coverageOf(source({ coverageMarkets: ['TW'], coverageKinds: ['stock'] }), ticker('0050')).mark, 'na');
    assert.equal(coverageOf(source({ coverageMarkets: ['US'], status: 'skipped' }), ticker('VT')).mark, 'skipped');
    assert.equal(coverageOf(source({ coverageMarkets: ['US'], status: 'failed' }), ticker('VT')).mark, 'failed');
  });
});

describe('agguVerdict', () => {
  it('names Alpha Vantage when it serves AGGU.LON', () => {
    const lines = agguVerdict([source({ id: 'alphavantage', coverage: { AGGU: { mark: 'yes', detail: 'AGGU.LON 400 weeks' } } })]);
    assert.match(lines.join('\n'), /✅ Alpha Vantage, AGGU\.LON.*400 weeks/);
    assert.match(lines.at(-1) ?? '', /Verdict.*Alpha Vantage, AGGU\.LON/);
  });

  it('falls back to the issuer NAV when no market feed works', () => {
    const lines = agguVerdict([
      source({ id: 'alphavantage', coverage: { AGGU: { mark: 'no', detail: 'Invalid API call' } } }),
      source({ id: 'issuers', series: [{ name: 'AGGU NAV per share (iShares)', latestDate: 'Oct 17, 2026', latestValue: '5.61' }] }),
    ]);
    assert.match(lines.at(-1) ?? '', /NAV history works as a fallback/);
  });

  it('stays unresolved without evidence', () => {
    assert.match(agguVerdict([]).at(-1) ?? '', /unresolved/);
  });

  it('shows a skipped source as skipped, not unchecked', () => {
    const lines = agguVerdict([source({ id: 'fmp', status: 'skipped', coverageMarkets: ['UK'] })]);
    assert.ok(lines.includes('- ⏭️ Financial Modeling Prep, AGGU.L'));
  });
});

describe('renderReport', () => {
  const report: RunReport = {
    schemaVersion: 1,
    generatedAt: '2026-10-21 05:00:00',
    node: 'v22.0.0',
    runner: 'test',
    keys: { ALPHAVANTAGE_API_KEY: true, FINMIND_TOKEN: false },
    sources: [
      source({
        id: 'twse',
        name: 'TWSE OpenAPI',
        short: 'TWSE',
        coverageMarkets: ['TW'],
        coverage: { '00692': { mark: 'yes' }, '009816': { mark: 'yes' }, '00922': { mark: 'no' } },
        calls: [
          {
            label: 'quotes | all',
            url: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
            status: 200,
            ok: true,
            ms: 321,
            bytes: 2048,
            rateLimitHeaders: { 'x-ratelimit-remaining': '9' },
          },
        ],
      }),
      source({ id: 'mops', name: 'MOPS', short: 'MOPS', coverageMarkets: ['TW'], coverageKinds: ['stock'], coverage: { '2330': { mark: 'yes' } } }),
      source({ id: 'fred', name: 'FRED', short: 'FRED', series: [{ name: 'TWD per USD (DEXTAUS)', latestDate: '2026-10-09', latestValue: '30.1', unit: 'TWD per USD' }] }),
      source({ id: 'cbc', name: 'CBC', short: 'CBC', row: 'Taiwan 10-year yield', status: 'failed' }),
      source({
        id: 'issuers',
        name: 'Issuers',
        short: 'Issuer',
        coverageMarkets: ['US'],
        coverageKinds: ['etf'],
        coverage: { VT: { mark: 'failed', detail: 'TypeError: fetch failed' }, VOO: { mark: 'yes', detail: '500 holdings' } },
      }),
    ],
  };
  const markdown = renderReport(report);

  it('shows key presence but never key values', () => {
    assert.match(markdown, /`ALPHAVANTAGE_API_KEY` ✅ · `FINMIND_TOKEN` ❌/);
  });

  it('marks coverage per ticker and drops columns that do not apply', () => {
    const principles = markdown.split('### Investment Principles tickers')[1]?.split('###')[0] ?? '';
    assert.match(principles, /\| \*\*00692\*\* \| .* \| TW \| ✅ \|/);
    assert.match(principles, /\| \*\*00922\*\* \| .* \| TW \| ❌ \|/);
    assert.match(principles, /\| \*\*VT\*\* \| .* \| US \| — \|/);
    assert.doesNotMatch(principles, /MOPS/);
    const supporting = markdown.split('### Proxies and examples')[1]?.split('##')[0] ?? '';
    assert.match(supporting, /\| \*\*2330\*\* \| .* \| TW \| · \| ✅ \|/);
  });

  it('lists series freshness, keeping a row for a market-level source that failed', () => {
    assert.match(markdown, /\| TWD per USD \(DEXTAUS\) \| FRED \| 2026-10-09 \| 30\.1 TWD per USD \|/);
    assert.match(markdown, /\| Taiwan 10-year yield \| CBC \| — \| — \(❌ failed 失敗\) \|/);
  });

  it('keeps failed calls out of the per-ticker details', () => {
    assert.match(markdown, /- \*\*VOO\*\*: Issuer ✅ 500 holdings/);
    assert.doesNotMatch(markdown, /- \*\*VT\*\*: Issuer/);
  });

  it('escapes table pipes and shows rate-limit headers', () => {
    assert.match(markdown, /quotes \\\| all/);
    assert.match(markdown, /x-ratelimit-remaining: 9/);
  });
});

describe('formatting', () => {
  it('formats sizes and table cells', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 kB');
    assert.equal(formatBytes(3_400_000), '3.4 MB');
    assert.equal(cell('a|b\nc'), 'a\\|b c');
  });
});
