import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  constituentKey,
  currencyOf,
  directKey,
  fileDue,
  lookThrough,
  lookThroughSettingsValue,
  overlap,
  packConstituent,
  readLookThroughSettings,
  unpackConstituents,
  type Constituent,
  type FundFile,
  type LookThroughSettings,
} from './look-through';
import { holding } from './test-helpers';

const close = (a: number, b: number, digits = 6) => assert.ok(Math.abs(a - b) < 10 ** -digits / 2, `${a} ≈ ${b}`);

/** The seeded config look_through. */
const SEEDED = {
  sources: { VT: { source: 'vanguard', id: 'VT' }, VOO: { source: 'vanguard', id: 'VOO' }, '00692': { source: 'fubon', id: '00692' } },
  fund_country: { BIL: 'US', '0050': 'TW', '009816': 'TW', '00922': 'TW' },
  refresh_days: 28,
  top_companies: 30,
  tw_sectors: { '24': 'Information Technology', '17': 'Financials' },
  last_verified: null,
};
const SETTINGS = readLookThroughSettings(SEEDED) as LookThroughSettings;

const row = (key: string, weight: number, overrides: Partial<Constituent> = {}): Constituent => ({
  key,
  name: key,
  ticker: key.split(':')[1] ?? null,
  country: key.split(':')[0] ?? null,
  currency: currencyOf(key.split(':')[0] ?? null),
  sector: null,
  assetType: 'equity',
  weight,
  ...overrides,
});
const file = (fund: string, constituents: Constituent[]): FundFile => ({ fund, asOf: '2026-09-30', source: 'vanguard', constituents });

describe('PRD Section 11 acceptance: F14', () => {
  it('Overlap: A holds X 50%, Y 30%, Z 20%; B holds X 40%, Y 40%, W 20% → 0.4 + 0.3 = 70%', () => {
    const a = file('A', [row('US:X', 0.5), row('US:Y', 0.3), row('US:Z', 0.2)]);
    const b = file('B', [row('US:X', 0.4), row('US:Y', 0.4), row('US:W', 0.2)]);
    const result = overlap(a, b);
    close(result.overlap, 0.7);
    assert.equal(result.common, 2);
  });

  it('Combined: NT$100,000 of a fund 50% TSMC, NT$20,000 of one 2% TSMC and NT$10,000 of TSMC itself → NT$60,400 of TSMC', () => {
    const files = new Map([
      ['00692', file('00692', [row('TW:2330', 0.5, { sector: 'Information Technology' }), row('TW:2317', 0.5)])],
      ['VT', file('VT', [row('TW:2330', 0.02), row('US:AAPL', 0.98)])],
    ]);
    const holdings = [
      holding({ key: 'regular:00692', ticker: '00692', label: '富邦公司治理', productType: 'equity_etf', currency: 'TWD', valueTwd: 100_000, market: 'TW' }),
      holding({ key: 'regular:VT', ticker: 'VT', valueTwd: 20_000 }),
      holding({ key: 'regular:2330', ticker: '2330', label: '台積電', productType: 'stock', currency: 'TWD', valueTwd: 10_000, market: 'TW', assetClassId: 'tw_stocks', sleeve: 'satellite' }),
    ];
    const result = lookThrough({ holdings, files, sectors: new Map(), settings: SETTINGS });
    const tsmc = result.companies[0];
    assert.equal(tsmc?.key, 'TW:2330');
    close(tsmc?.valueTwd ?? 0, 60_400);
    assert.deepEqual(tsmc?.via, { '00692': 50_000, VT: 400, direct: 10_000 });
    assert.equal(tsmc?.sector, 'Information Technology');
    assert.equal(result.lookedThrough, 1);
  });
});

describe('look-through', () => {
  const settings = SETTINGS;

  it('keeps a fund without a file whole, in its trade currency and the country config gives it, and gold and TWD cash as such', () => {
    const holdings = [
      holding({ key: 'regular:BIL', ticker: 'BIL', label: 'SPDR T-Bill', productType: 'cash_mmf', valueTwd: 30_000 }),
      holding({ key: 'regular:BNDW', ticker: 'BNDW', label: 'Vanguard Total World Bond', productType: 'bond_etf', valueTwd: 50_000 }),
      holding({ key: 'manual:1', ticker: null, label: 'Gold bar', productType: 'gold', currency: 'TWD', valueTwd: 15_000, market: null }),
      holding({ key: 'manual:2', ticker: null, label: 'Savings', productType: 'cash_mmf', currency: 'TWD', valueTwd: 5_000, market: null }),
    ];
    const result = lookThrough({ holdings, files: new Map(), sectors: new Map(), settings });
    close(result.lookedThrough, 0.2);
    assert.deepEqual(
      result.countries.map((slice) => [slice.key, slice.valueTwd]),
      [['whole', 50_000], ['US', 30_000], ['gold', 15_000], ['TW', 5_000]],
    );
    assert.deepEqual(result.currencies.map((slice) => slice.key), ['USD', 'TWD']);
    assert.deepEqual(result.assetTypes.map((slice) => slice.key), ['bond', 'cash', 'gold']);
    assert.deepEqual(result.funds.map((fund) => [fund.ticker, fund.asOf]), [['BNDW', null], ['BIL', null]]);
  });

  it('leaves the part of a fund its file does not name with the fund, and gives sectors as shares of the equity', () => {
    const files = new Map([['VOO', file('VOO', [row('US:AAPL', 0.6, { sector: 'Information Technology' }), row('US:JPM', 0.3, { sector: 'Financials' })])]]);
    const holdings = [holding({ key: 'regular:VOO', ticker: 'VOO', valueTwd: 10_000 })];
    const result = lookThrough({ holdings, files, sectors: new Map(), settings });
    close(result.lookedThrough, 0.9);
    const rest = result.exposures.find((exposure) => exposure.key === 'rest:VOO');
    close(rest?.valueTwd ?? 0, 1_000);
    assert.deepEqual(result.sectors.map((slice) => [slice.key, Math.round(slice.share * 1000) / 1000]), [['Information Technology', 0.667], ['Financials', 0.333]]);
    close(result.funds[0]?.named ?? 0, 0.9);
  });

  it('lists the top companies by name and the rest as one line, and every pair of looked-through funds', () => {
    const many = Array.from({ length: 40 }, (_, i) => row(`US:S${i}`, 0.025));
    const files = new Map([
      ['VT', file('VT', many)],
      ['VOO', file('VOO', many.slice(0, 20).map((one) => ({ ...one, weight: 0.05 })))],
    ]);
    const holdings = [holding({ key: 'regular:VT', ticker: 'VT', valueTwd: 40_000 }), holding({ key: 'regular:VOO', ticker: 'VOO', valueTwd: 1_000 })];
    const result = lookThrough({ holdings, files, sectors: new Map(), settings });
    assert.equal(result.companies.length, 30);
    assert.equal(result.otherCompaniesCount, 10);
    close(result.otherCompaniesTwd, 10_000);
    assert.equal(result.overlaps.length, 1);
    close(result.overlaps[0]?.overlap ?? 0, 0.5);
  });
});

describe('keys and settings', () => {
  it("names a constituent by its ISIN's country and ticker, and a direct stock by its market", () => {
    assert.equal(constituentKey('2330', 'TW0002330008', 'TSMC'), 'TW:2330');
    assert.equal(constituentKey(null, 'US3135G0X245', 'FNMA'), 'US3135G0X245');
    assert.equal(constituentKey(null, null, ' Federal National Mortgage Assn. '), 'name:FEDERAL NATIONAL MORTGAGE ASSN.');
    assert.equal(directKey('US', 'AAPL'), 'US:AAPL');
    assert.equal(directKey('UK', 'AGGU'), 'GB:AGGU');
    assert.equal(currencyOf('DE'), 'EUR');
    assert.equal(currencyOf('KY'), null);
  });

  it('reads the seeded config and writes it back unchanged, refusing a malformed one', () => {
    assert.deepEqual(lookThroughSettingsValue(SETTINGS), SEEDED);
    assert.equal(readLookThroughSettings({ ...SEEDED, sources: { VT: { source: 'ishares', id: 'VT' } } }), undefined);
    assert.equal(readLookThroughSettings({ ...SEEDED, tw_sectors: { '24': 'Chips' } }), undefined);
    assert.equal(readLookThroughSettings({ ...SEEDED, top_companies: 2 }), undefined);
  });
});

describe('saved files', () => {
  it('pack a constituent into one array and read it back, leaving out a malformed line', () => {
    const one: Constituent = { key: 'TW:2330', name: '台積電', ticker: '2330', country: 'TW', currency: 'TWD', sector: 'Information Technology', assetType: 'equity', weight: 0.525483 };
    assert.deepEqual(unpackConstituents([packConstituent(one), ['x'], 'y']), [one]);
    assert.deepEqual(unpackConstituents(null), []);
  });

  it('are due when never read, or read a refresh period ago', () => {
    assert.equal(fileDue(undefined, '2026-10-28', 28), true);
    assert.equal(fileDue('2026-10-01T12:00:00Z', '2026-10-28', 28), false);
    assert.equal(fileDue('2026-09-30T12:00:00Z', '2026-10-28', 28), true);
  });
});
