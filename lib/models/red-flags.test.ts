import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Figures, Quarter } from './fundamentals';
import {
  altmanZ,
  assess,
  beneishM,
  companyKind,
  currentRun,
  readRedFlagSettings,
  readScans,
  redFlagSettingsValue,
  scanDue,
  scanRows,
  summarise,
  windowStart,
  type BeneishYear,
  type CompanyInput,
  type IndicatorResult,
  type Profile,
  type RedFlagSettings,
  type Scan,
} from './red-flags';

const close = (a: number, b: number, digits = 6) => assert.ok(Math.abs(a - b) < 10 ** -digits / 2, `${a} ≈ ${b}`);

/** The seeded config red_flags. */
export const SEEDED = {
  lookback_years: 3,
  scan_days: 7,
  beneish: { red_above: -1.78 },
  altman: { z: { red_below: 1.81, amber_below: 2.99 }, z2: { red_below: 1.1, amber_below: 2.6 } },
  cash_flow_years: 3,
  governance: { bottom_share: 0.35 },
  manufacturing: { sic: [[2000, 3999]], tw_industries: ['01', '24', '28'] },
  financial: { sic: [[6000, 6799]], tw_industries: ['17'] },
  excluded: { industries: [], tickers: [] },
  last_verified: null,
};
const SETTINGS = readRedFlagSettings(SEEDED) as RedFlagSettings;

const YEAR: BeneishYear = {
  revenue: 1000,
  receivables: 100,
  grossProfit: 400,
  currentAssets: 300,
  ppe: 500,
  totalAssets: 1000,
  da: 50,
  sga: 150,
  currentLiabilities: 200,
  longTermDebt: 300,
  netIncome: 80,
  ocf: 80,
};

/** Figures that give YEAR to Beneish and a Z of their own. */
function figures(overrides: Figures = {}): Figures {
  return {
    revenue: 1000,
    receivables: 100,
    grossProfit: 400,
    currentAssets: 300,
    ppe: 500,
    totalAssets: 1000,
    da: 50,
    sga: 150,
    currentLiabilities: 200,
    debt: 350,
    shortDebt: 50,
    netIncome: 80,
    ocf: 100,
    ebit: 100,
    retainedEarnings: 200,
    totalLiabilities: 500,
    equity: 500,
    shares: 10,
    ...overrides,
  };
}

const quarter = (periodEnd: string, overrides: Figures = {}): Quarter => ({ periodEnd, figures: figures(overrides), filed: null });

const US_MAKER: Profile = { industryCode: '3571', industry: 'Electronic Computers', sic: 3571, auditor: null, checked: {} };

function company(overrides: Partial<CompanyInput> = {}): CompanyInput {
  return {
    ticker: 'AAPL',
    market: 'US',
    quarters: [quarter('2023-06-30'), quarter('2024-06-30'), quarter('2025-06-30'), quarter('2026-06-30')],
    reportCurrency: 'USD',
    price: { close: 50, date: '2026-10-20', currency: 'USD' },
    profile: US_MAKER,
    events: [],
    entries: [],
    ...overrides,
  };
}

const byIndicator = (rows: readonly IndicatorResult[], indicator: string) => rows.find((row) => row.indicator === indicator) as IndicatorResult;

describe('PRD Section 11 acceptance: N3', () => {
  it('Beneish: every index 1 and no accruals give M = −2.480, below −1.78', () => {
    const score = beneishM(YEAR, YEAR);
    assert.ok(score);
    close(score.m, -2.48);
    for (const key of ['DSRI', 'GMI', 'AQI', 'SGI', 'DEPI', 'SGAI', 'LVGI']) close(score.parts[key] as number, 1);
    close(score.parts['TATA'] as number, 0);
  });

  it('Altman: X1 0.1, X2 0.2, X3 0.1, X4 1.0, X5 1.2 give Z 2.53 (amber) and Z″ 3.03 (green)', () => {
    const input = { currentAssets: 300, currentLiabilities: 200, totalAssets: 1000, retainedEarnings: 200, ebit: 100, revenue: 1200, totalLiabilities: 500, equity: 500 };
    const z = altmanZ(input, 'Z');
    const z2 = altmanZ(input, 'Z2');
    assert.ok(z && z2);
    close(z.z, 2.53);
    close(z2.z, 3.03);
    const one = assess(company({ quarters: [quarter('2026-06-30', { revenue: 1200, shares: 5 })], price: { close: 100, date: '2026-10-20', currency: 'USD' } }), SETTINGS, '2026-10-28');
    const altman = byIndicator(one.indicators, 'altman_z');
    assert.equal(altman.variant, 'Z');
    assert.equal(altman.equityBasis, 'market');
    close(altman.value as number, 2.53);
    assert.equal(altman.status, 'amber');
  });

  it('Coverage: 7 of the 8 indicators that apply to a US company covered is 87.5%', () => {
    const checked = { on: '2026-10-28' };
    const result = assess(company({ profile: { ...US_MAKER, checked: { auditor_change: checked, going_concern: checked, restatement: checked } } }), SETTINGS, '2026-10-28');
    assert.equal(result.applicable, 8);
    assert.equal(result.covered, 7);
    assert.equal(result.coverage, 87.5);
    assert.equal(byIndicator(result.indicators, 'governance_rating').status, 'na');
    assert.equal(byIndicator(result.indicators, 'environmental_penalties').status, 'none');
  });
});

describe('Beneish M-Score', () => {
  it('compares the newest quarter end with the one a year before, and flags red above −1.78', () => {
    const result = assess(company({ quarters: [quarter('2025-06-30'), quarter('2026-06-30', { receivables: 300 })] }), SETTINGS, '2026-10-28');
    const beneish = byIndicator(result.indicators, 'beneish_m');
    assert.equal(beneish.periodEnd, '2026-06-30');
    assert.equal(beneish.priorEnd, '2025-06-30');
    // DSRI 3 adds 0.92 × 2 to M; TATA (80 − 100) ÷ 1000 takes 4.679 × 0.02 off.
    close(beneish.value as number, -2.48 + 0.92 * 2 - 4.679 * 0.02);
    assert.equal(beneish.status, 'red');
  });

  it('works out gross profit from the cost of revenue when the filings give none', () => {
    const result = assess(company({ quarters: [quarter('2025-06-30', { grossProfit: undefined, cogs: 600 }), quarter('2026-06-30', { grossProfit: undefined, cogs: 600 })] }), SETTINGS, '2026-10-28');
    close(byIndicator(result.indicators, 'beneish_m').parts?.['GMI'] as number, 1);
  });

  it('says which figures are missing, and that a year is needed before the newest one', () => {
    const missing = assess(company({ quarters: [quarter('2025-06-30', { receivables: undefined }), quarter('2026-06-30', { receivables: undefined })] }), SETTINGS, '2026-10-28');
    assert.deepEqual(byIndicator(missing.indicators, 'beneish_m'), { indicator: 'beneish_m', value: null, status: 'none', why: 'missing', missing: ['receivables'] });
    const alone = assess(company({ quarters: [quarter('2026-06-30')] }), SETTINGS, '2026-10-28');
    assert.equal(byIndicator(alone.indicators, 'beneish_m').why, 'no_prior_year');
  });

  it('does not apply to a bank or an insurer', () => {
    const bank = assess(company({ profile: { ...US_MAKER, sic: 6021, industryCode: '6021' } }), SETTINGS, '2026-10-28');
    assert.equal(byIndicator(bank.indicators, 'beneish_m').status, 'na');
    assert.equal(byIndicator(bank.indicators, 'altman_z').status, 'na');
    assert.equal(bank.applicable, 6);
  });
});

describe('Altman Z-Score', () => {
  it('uses Z″ with book equity for a company that is not a manufacturer, and for one without a profile', () => {
    const shop = assess(company({ profile: { ...US_MAKER, sic: 5961, industryCode: '5961' } }), SETTINGS, '2026-10-28');
    const z2 = byIndicator(shop.indicators, 'altman_z');
    assert.equal(z2.variant, 'Z2');
    assert.equal(z2.equityBasis, 'book');
    close(z2.value as number, 3.03);
    assert.equal(z2.status, 'green');
    assert.equal(companyKind('US', null, SETTINGS), 'unknown');
    assert.equal(byIndicator(assess(company({ profile: null }), SETTINGS, '2026-10-28').indicators, 'altman_z').variant, 'Z2');
  });

  it("reads a Taiwan manufacturer by its TWSE industry code, and falls back to book equity when the price is in another currency than the filings", () => {
    const tw = company({ ticker: '2330', market: 'TW', reportCurrency: 'TWD', profile: { industryCode: '24', industry: '半導體業', sic: null, auditor: null, checked: {} } });
    assert.equal(companyKind('TW', tw.profile, SETTINGS), 'manufacturer');
    const altman = byIndicator(assess(tw, SETTINGS, '2026-10-28').indicators, 'altman_z');
    assert.equal(altman.variant, 'Z');
    assert.equal(altman.equityBasis, 'book');
  });

  it('takes total liabilities as assets less equity when the filings give none, and flags red below 1.81', () => {
    const result = assess(company({ quarters: [quarter('2026-06-30', { totalLiabilities: undefined, equity: 100, retainedEarnings: -300, ebit: -50 })] }), SETTINGS, '2026-10-28');
    const altman = byIndicator(result.indicators, 'altman_z');
    close(altman.parts?.['X4'] as number, 500 / 900);
    assert.equal(altman.status, 'red');
  });
});

describe('cash flow vs earnings', () => {
  it('flags amber when operating cash flow is below net income in each of the last three years', () => {
    const low = { ocf: 50, netIncome: 80 };
    const result = assess(company({ quarters: [quarter('2024-06-30', low), quarter('2025-06-30', low), quarter('2026-06-30', low)] }), SETTINGS, '2026-10-28');
    const row = byIndicator(result.indicators, 'cash_flow_vs_earnings');
    assert.equal(row.status, 'amber');
    assert.equal(row.value, 3);
    assert.deepEqual(row.years?.map((year) => year.end), ['2026-06-30', '2025-06-30', '2024-06-30']);
  });

  it('stays green when one year of the three covers its earnings, and waits for three years', () => {
    const low = { ocf: 50, netIncome: 80 };
    const mixed = assess(company({ quarters: [quarter('2024-06-30'), quarter('2025-06-30', low), quarter('2026-06-30', low)] }), SETTINGS, '2026-10-28');
    assert.equal(byIndicator(mixed.indicators, 'cash_flow_vs_earnings').status, 'green');
    const short = assess(company({ quarters: [quarter('2025-06-30', low), quarter('2026-06-30', low)] }), SETTINGS, '2026-10-28');
    assert.equal(byIndicator(short.indicators, 'cash_flow_vs_earnings').status, 'none');
  });
});

describe('event indicators', () => {
  const checked = { on: '2026-10-28' };
  const profile: Profile = { ...US_MAKER, checked: { auditor_change: checked, going_concern: checked, restatement: checked } };

  it('flag an auditor change amber and a restatement or going-concern opinion red, within the three years only', () => {
    const result = assess(
      company({
        profile,
        events: [
          { indicator: 'auditor_change', date: '2025-03-01', source: 'sec', title: '8-K Item 4.01' },
          { indicator: 'restatement', date: '2023-10-01', source: 'sec', title: '8-K Item 4.02' },
          { indicator: 'going_concern', date: '2026-02-01', source: 'sec', title: '10-K' },
        ],
      }),
      SETTINGS,
      '2026-10-28',
    );
    assert.equal(byIndicator(result.indicators, 'auditor_change').status, 'amber');
    assert.equal(byIndicator(result.indicators, 'restatement').status, 'green');
    assert.equal(byIndicator(result.indicators, 'going_concern').status, 'red');
    assert.equal(result.light, 'red');
    // Red first, then amber in the table's order: the test figures' Z of 2.33 sits in the grey zone.
    assert.deepEqual(result.fired, ['going_concern', 'altman_z', 'auditor_change']);
  });

  it("count the owner's entry: a count found then, 0 for checked and none found", () => {
    const none = assess(company({ entries: [{ id: 1, indicator: 'environmental_penalties', asOf: '2026-09-01', value: 0, note: 'ECHO: none' }] }), SETTINGS, '2026-10-28');
    assert.equal(byIndicator(none.indicators, 'environmental_penalties').status, 'green');
    const two = assess(company({ entries: [{ id: 1, indicator: 'environmental_penalties', asOf: '2026-09-01', value: 2, note: 'ECHO' }] }), SETTINGS, '2026-10-28');
    assert.equal(byIndicator(two.indicators, 'environmental_penalties').status, 'amber');
    const stale = assess(company({ entries: [{ id: 1, indicator: 'environmental_penalties', asOf: '2022-09-01', value: 0, note: '' }] }), SETTINGS, '2026-10-28');
    assert.equal(byIndicator(stale.indicators, 'environmental_penalties').status, 'none');
  });

  it('show since when a forward-only feed has looked', () => {
    const tw = assess(company({ ticker: '2330', market: 'TW', profile: { ...US_MAKER, checked: { restatement: { on: '2026-10-28', since: '2026-10-20' } } } }), SETTINGS, '2026-10-28');
    assert.equal(byIndicator(tw.indicators, 'restatement').since, '2026-10-20');
  });
});

describe('governance and exclusions', () => {
  const tw = (value: number) => company({ ticker: '2330', market: 'TW', entries: [{ id: 3, indicator: 'governance_rating', asOf: '2026-05-01', value, note: '第 12 屆' }] });

  it('flags a Taiwan company in the bottom 35% of the governance evaluation amber', () => {
    assert.equal(byIndicator(assess(tw(80), SETTINGS, '2026-10-28').indicators, 'governance_rating').status, 'amber');
    assert.equal(byIndicator(assess(tw(65), SETTINGS, '2026-10-28').indicators, 'governance_rating').status, 'green');
    assert.equal(byIndicator(assess(tw(5), SETTINGS, '2026-10-28').indicators, 'governance_rating').status, 'green');
  });

  it("flags red a ticker or an industry on the owner's list, matching an industry's code or part of its name", () => {
    const listed = (excluded: RedFlagSettings['excluded']) => byIndicator(assess(company(), { ...SETTINGS, excluded }, '2026-10-28').indicators, 'excluded_business');
    assert.deepEqual(listed({ industries: [], tickers: [] }), { indicator: 'excluded_business', status: 'green', value: 0, why: 'empty_list' });
    assert.equal(listed({ industries: [], tickers: ['aapl'] }).status, 'red');
    assert.equal(listed({ industries: ['computers'], tickers: [] }).matched, 'computers');
    assert.equal(listed({ industries: ['3571'], tickers: [] }).status, 'red');
    assert.equal(listed({ industries: ['tobacco'], tickers: [] }).status, 'green');
  });
});

describe('light and coverage', () => {
  it('has no light when nothing is covered', () => {
    const rows: IndicatorResult[] = [
      { indicator: 'beneish_m', status: 'none', value: null },
      { indicator: 'governance_rating', status: 'na', value: null },
    ];
    assert.deepEqual(summarise('X', rows), { ticker: 'X', light: null, coverage: 0, covered: 0, applicable: 1, fired: [], indicators: rows });
  });

  it('has no green light from the exclusion list alone, though the list can turn a light red', () => {
    const listed = (status: IndicatorResult['status']): IndicatorResult[] => [
      { indicator: 'beneish_m', status: 'none', value: null },
      { indicator: 'excluded_business', status, value: status === 'red' ? 1 : 0 },
    ];
    assert.equal(summarise('NVDA', listed('green')).light, null);
    assert.equal(summarise('NVDA', listed('green')).coverage, 50);
    assert.equal(summarise('NVDA', listed('red')).light, 'red');
  });

  it('goes back three years of 365.25 days', () => {
    assert.equal(windowStart('2026-10-28', 3), '2023-10-28');
  });
});

describe('scans', () => {
  it('saves one row per indicator with the coverage and reads them back as a scan', () => {
    const assessment = assess(company(), SETTINGS, '2026-10-28');
    const rows = scanRows(assessment, '2026-10-28');
    assert.equal(rows.length, 9);
    assert.ok(rows.every((row) => row.coverage_pct === assessment.coverage && row.flag_date === '2026-10-28'));
    const beneish = rows.find((row) => row.indicator === 'beneish_m');
    assert.equal(beneish?.detail['periodEnd'], '2026-06-30');
    const scans = readScans(rows).get('AAPL') as Scan[];
    assert.equal(scans.length, 1);
    assert.equal(scans[0]?.light, assessment.light);
    assert.deepEqual(scans[0]?.fired, assessment.fired);
  });

  const scan = (date: string, light: Scan['light']): Scan => ({ date, light, coverage: 50, fired: [], indicators: [] });

  it("finds the light's current run, the date it began and the light before it, skipping scans without a light", () => {
    assert.deepEqual(currentRun([scan('2026-10-28', 'amber'), scan('2026-10-21', 'amber'), scan('2026-10-14', null), scan('2026-10-07', 'green')]), {
      light: 'amber',
      since: '2026-10-21',
      before: 'green',
      fired: [],
    });
    assert.deepEqual(currentRun([scan('2026-10-28', 'red')]), { light: 'red', since: '2026-10-28', before: null, fired: [] });
    assert.equal(currentRun([scan('2026-10-28', null)]), undefined);
  });

  it('is due a scan when never scanned or scanned a week or more ago', () => {
    assert.equal(scanDue(undefined, '2026-10-28', 7), true);
    assert.equal(scanDue('2026-10-22', '2026-10-28', 7), false);
    assert.equal(scanDue('2026-10-21', '2026-10-28', 7), true);
  });
});

describe('settings', () => {
  it('read the seeded config and write it back unchanged', () => {
    assert.deepEqual(redFlagSettingsValue(SETTINGS), SEEDED);
  });

  it('refuse malformed settings', () => {
    assert.equal(readRedFlagSettings(undefined), undefined);
    assert.equal(readRedFlagSettings({ ...SEEDED, altman: { z: { red_below: 3, amber_below: 2 }, z2: SEEDED.altman.z2 } }), undefined);
    assert.equal(readRedFlagSettings({ ...SEEDED, governance: { bottom_share: 1.2 } }), undefined);
    assert.equal(readRedFlagSettings({ ...SEEDED, manufacturing: { sic: [[3999, 2000]], tw_industries: [] } }), undefined);
  });
});
