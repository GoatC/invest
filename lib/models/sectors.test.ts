import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays } from '../dates';
import type { Exposure } from './look-through';
import {
  annualVolatility,
  closeAt,
  periodReturn,
  periodStart,
  readSectorSettings,
  sectorSettingsValue,
  sectorView,
  shiftMonths,
  twIndexId,
  weeklyReturns,
  type Close,
  type SectorProxy,
} from './sectors';

const close = (a: number, b: number, digits = 6) => assert.ok(Math.abs(a - b) < 10 ** -digits / 2, `${a} ≈ ${b}`);

/** Weekly closes ending on `end`, alternating ±`step` from 100. */
function alternating(end: string, weeks: number, step: number): Close[] {
  const out: Close[] = [];
  let value = 100;
  for (let i = weeks; i >= 0; i--) {
    out.push({ date: addDays(end, -7 * i), close: value });
    value *= (weeks - i) % 2 === 0 ? 1 + step : 1 - step;
  }
  return out;
}

const exposure = (key: string, country: string, sector: string | null, valueTwd: number): Exposure => ({ key, name: key, ticker: key, country, currency: null, sector, assetType: 'equity', valueTwd, via: { direct: valueTwd } });

describe('PRD Section 11 acceptance: N7', () => {
  it('Returns: 100 a year ago, 105 at the year end, 110 now → 1 year +10.00%, year to date +4.76%', () => {
    const closes = [
      { date: '2025-10-28', close: 100 },
      { date: '2025-12-31', close: 105 },
      { date: '2026-10-28', close: 110 },
    ];
    close(periodReturn(closes, '1Y', '2026-10-28') as number, 0.1);
    close(periodReturn(closes, 'YTD', '2026-10-28') as number, 110 / 105 - 1);
  });

  it('Volatility: 52 weekly returns of +1% and −1% in turn → 1.0098% a week, 7.28% a year', () => {
    const returns = weeklyReturns(alternating('2026-10-23', 52, 0.01), '2026-10-28');
    assert.equal(returns.length, 52);
    close(annualVolatility(returns) as number, (0.01 * 52) / Math.sqrt(51), 9);
  });

  it('Treemap colour: US tech +10% on NT$30,000, Taiwan tech +20% on NT$10,000 → +12.5%', () => {
    const proxies: SectorProxy[] = [
      { id: 'XLK', market: 'US', symbol: 'XLK', name: 'XLK', sector: 'Information Technology' },
      { id: 'TW_ELECTRONIC', market: 'TW', symbol: 'Electronic', name: '電子類指數', sector: 'Information Technology' },
    ];
    const closes = new Map<string, Close[]>([
      ['XLK', [{ date: '2025-10-28', close: 100 }, { date: '2026-10-28', close: 110 }]],
      ['TW_ELECTRONIC', [{ date: '2025-10-28', close: 100 }, { date: '2026-10-28', close: 120 }]],
    ]);
    const view = sectorView(proxies, closes, [exposure('US:AAPL', 'US', 'Information Technology', 30_000), exposure('TW:2330', 'TW', 'Information Technology', 10_000)], '2026-10-28');
    const tech = view.tiles.find((tile) => tile.sector === 'Information Technology');
    close(tech?.returns['1Y'] as number, 0.125);
    assert.deepEqual(tech?.byMarket, { US: 30_000, TW: 10_000, other: 0 });
    assert.equal(view.asOf, '2026-10-28');
  });
});

describe('periods', () => {
  it('start a week, a month, three months, at the year end and a year before the newest close', () => {
    assert.equal(periodStart('1W', '2026-10-28'), '2026-10-21');
    assert.equal(periodStart('1M', '2026-03-31'), '2026-02-28');
    assert.equal(periodStart('3M', '2026-10-28'), '2026-07-28');
    assert.equal(periodStart('YTD', '2026-10-28'), '2025-12-31');
    assert.equal(periodStart('1Y', '2028-02-29'), '2027-02-28');
    assert.equal(shiftMonths('2026-01-31', 1), '2026-02-28');
  });

  it('give no return when the closes do not reach back to the start', () => {
    const closes = [{ date: '2026-09-25', close: 100 }, { date: '2026-10-28', close: 110 }];
    assert.equal(periodReturn(closes, '1Y', '2026-10-28'), null);
    // The month starts on 2026-09-28; the close three days before it stands in.
    close(periodReturn(closes, '1M', '2026-10-28') as number, 0.1);
    assert.equal(periodReturn([{ date: '2026-09-01', close: 100 }, ...closes.slice(1)], '1M', '2026-10-28'), null);
    assert.equal(closeAt(closes, '2026-09-24'), undefined);
  });

  it('need 26 weekly returns for a volatility', () => {
    assert.equal(annualVolatility(weeklyReturns(alternating('2026-10-23', 20, 0.01), '2026-10-28')), null);
  });
});

describe('the sector view', () => {
  const proxies: SectorProxy[] = [
    { id: 'XLF', market: 'US', symbol: 'XLF', name: 'XLF', sector: 'Financials' },
    { id: 'TW_FINANCIALINSURANCE', market: 'TW', symbol: 'FinancialInsurance', name: '金融保險類指數', sector: 'Financials' },
    { id: 'TW_CEMENT', market: 'TW', symbol: 'Cement', name: '水泥類指數', sector: 'Materials' },
    { id: 'TW_PLASTICS', market: 'TW', symbol: 'Plastics', name: '塑膠類指數', sector: 'Materials' },
  ];
  const closes = new Map<string, Close[]>([
    // 53 weeks, so a full year of closes stands behind the 1-year return.
    ['XLF', alternating('2026-10-23', 53, 0.01)],
    ['TW_FINANCIALINSURANCE', alternating('2026-10-23', 53, 0.02)],
    ['TW_CEMENT', [{ date: '2025-10-23', close: 100 }, { date: '2026-10-23', close: 90 }]],
    ['TW_PLASTICS', [{ date: '2025-10-23', close: 100 }, { date: '2026-10-23', close: 130 }]],
  ]);

  it('gives each sector and market a row, averaging a sector\'s Taiwan indices', () => {
    const view = sectorView(proxies, closes, [], '2026-10-28');
    assert.deepEqual(view.rows.map((row) => `${row.sector} ${row.market}`), ['Financials US', 'Financials TW', 'Materials TW']);
    const materials = view.rows.find((row) => row.sector === 'Materials');
    close(materials?.returns['1Y'] as number, 0.1);
    assert.deepEqual(materials?.proxies, ['TW_CEMENT', 'TW_PLASTICS']);
  });

  it('weights the portfolio point by exposure, and keeps companies elsewhere and unclassified apart', () => {
    const view = sectorView(
      proxies,
      closes,
      [exposure('US:JPM', 'US', 'Financials', 1_000), exposure('TW:2881', 'TW', 'Financials', 3_000), exposure('JP:8306', 'JP', 'Financials', 500), exposure('JP:7203', 'JP', null, 500)],
      '2026-10-28',
    );
    const [us, tw] = [view.rows[0], view.rows[1]];
    assert.equal(us?.exposureTwd, 1_000);
    const expected = (1_000 * (us?.volatility as number) + 3_000 * (tw?.volatility as number)) / 4_000;
    close(view.portfolio?.volatility as number, expected);
    const financials = view.tiles.find((tile) => tile.sector === 'Financials');
    assert.deepEqual(financials?.byMarket, { US: 1_000, TW: 3_000, other: 500 });
    close(financials?.share as number, 4_500 / 5_000);
    assert.equal(view.tiles.find((tile) => tile.sector === 'unclassified')?.exposureTwd, 500);
  });
});

describe('settings', () => {
  const SEEDED = { colour: 'red_up', us: { XLK: 'Information Technology' }, tw: { Electronic: { name: '電子類指數', sector: 'Information Technology' } }, last_verified: null };

  it('read the seeded config and write it back unchanged, a Taiwan index saved as TW_ and its name', () => {
    const settings = readSectorSettings(SEEDED);
    assert.ok(settings);
    assert.deepEqual(settings.proxies.map((proxy) => proxy.id), ['XLK', 'TW_ELECTRONIC']);
    assert.deepEqual(sectorSettingsValue(settings), SEEDED);
    assert.equal(twIndexId('FinancialInsurance'), 'TW_FINANCIALINSURANCE');
  });

  it('refuse an unknown colour or sector', () => {
    assert.equal(readSectorSettings({ ...SEEDED, colour: 'blue' }), undefined);
    assert.equal(readSectorSettings({ ...SEEDED, us: { XLK: 'Chips' } }), undefined);
  });
});
