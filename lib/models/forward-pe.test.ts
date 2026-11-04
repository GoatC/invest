import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estimatesDue, nextTwelveMonths, PE_CHECK_DEFAULTS, peCheck, readEstimates, readPeCheckSettings, type Estimates } from './forward-pe';

const close = (a: number | undefined, b: number, digits = 4) => assert.ok(a !== undefined && Math.abs(a - b) < 10 ** -digits / 2, `${a} ≈ ${b}`);

/** PRD Section 11's case: FY1 ends 2026-12-31, 219 days after 2026-05-26 (w = 0.6). */
const TODAY = '2026-05-26';
const ESTIMATES: Estimates = {
  asOf: '2026-05-25',
  source: 'alphavantage',
  currency: 'USD',
  years: [
    { periodEnd: '2027-12-31', mean: 8.0, high: 9.0, low: 7.0, analysts: 12, mean30: 7.9, up30: 2, down30: 0 },
    { periodEnd: '2026-12-31', mean: 7.0, high: 7.5, low: 6.5, analysts: 14, mean30: 6.9, up30: 3, down30: 1 },
    // A fiscal year already over is left out.
    { periodEnd: '2025-12-31', mean: 5.5, analysts: 20 },
  ],
  targetPrice: 180,
};
const INPUT = { price: 148, priceCurrency: 'USD', ttmEps: 6, ownMedianPe: 25, estimates: ESTIMATES, today: TODAY };

describe('PRD Section 11 acceptance: F12 forward P/E', () => {
  it('blends FY1 and FY2 into the next twelve months: 0.6 × 7.0 + 0.4 × 8.0 = 7.4, and 7.3 thirty days ago', () => {
    const blend = nextTwelveMonths(ESTIMATES.years, TODAY);
    close(blend?.weight, 0.6);
    close(blend?.eps, 7.4);
    close(blend?.eps30, 7.3);
    close(blend?.high, 8.1);
    close(blend?.low, 6.7);
    assert.equal(blend?.analysts, 12);
    assert.equal(blend?.up30, 5);
    assert.equal(blend?.down30, 1);
  });

  it('price 148, TTM EPS 6, own median P/E 25: trailing 24.67, forward 20.0, growth 23.3%, PEG 0.857, 20% below the own median: attractive', () => {
    const check = peCheck(INPUT, PE_CHECK_DEFAULTS);
    close(check.trailingPe, 148 / 6);
    close(check.forwardPe, 20);
    close(check.forwardRange?.low, 148 / 8.1);
    close(check.forwardRange?.high, 148 / 6.7);
    close(check.growth, 7.4 / 6 - 1);
    close(check.peg, 20 / ((7.4 / 6 - 1) * 100));
    assert.equal(check.peg?.toFixed(3), '0.857');
    close(check.discount, -0.2);
    close(check.fairPrice, 185);
    close(check.fairUpside, 185 / 148 - 1);
    close(check.targetUpside, 180 / 148 - 1);
    assert.deepEqual(
      check.signals.map((signal) => [signal.id, signal.tone]),
      [
        ['history', 'good'],
        ['peg', 'good'],
        ['revisions', 'good'],
        ['target', 'neutral'],
      ],
    );
    close(check.signals[2]?.value, 7.4 / 7.3 - 1);
    assert.equal(check.score, 3);
    assert.equal(check.verdict, 'attractive');
    assert.deepEqual(check.caveats, []);
  });

  it('price 300 with estimates cut: forward 40.5 is 62% above the own median, PEG 1.74, revisions down: expensive', () => {
    const cut: Estimates = { ...ESTIMATES, years: ESTIMATES.years.map((year) => ({ ...year, mean30: year.mean * 1.05 })) };
    const check = peCheck({ ...INPUT, price: 300, estimates: cut }, PE_CHECK_DEFAULTS);
    close(check.forwardPe, 300 / 7.4);
    close(check.discount, 300 / 7.4 / 25 - 1);
    assert.equal(check.peg?.toFixed(2), '1.74');
    assert.deepEqual(
      check.signals.map((signal) => signal.tone),
      ['bad', 'neutral', 'bad', 'neutral'],
    );
    assert.equal(check.score, -2);
    assert.equal(check.verdict, 'expensive');
  });
});

describe('forward P/E edges', () => {
  it('uses FY1 alone when no second year is estimated', () => {
    const blend = nextTwelveMonths([{ periodEnd: '2026-12-31', mean: 7 }], TODAY);
    assert.equal(blend?.weight, 1);
    assert.equal(blend?.eps, 7);
  });

  it('falls back to the peers when the own range is missing, and says so', () => {
    const check = peCheck({ ...INPUT, ownMedianPe: undefined, peersPe: 16 }, PE_CHECK_DEFAULTS);
    assert.deepEqual(check.reference, { pe: 16, from: 'peers' });
    assert.equal(check.signals[0]?.id, 'peers');
    assert.equal(check.signals[0]?.tone, 'bad');
  });

  it('scores a fall in earnings as rich for its growth', () => {
    const check = peCheck({ ...INPUT, ttmEps: 8 }, PE_CHECK_DEFAULTS);
    assert.ok((check.growth ?? 0) < 0);
    assert.equal(check.peg, undefined);
    assert.equal(check.signals.find((signal) => signal.id === 'peg')?.tone, 'bad');
  });

  it('stays neutral without estimates, on a forecast loss, in another currency, thin or stale', () => {
    assert.deepEqual(peCheck({ ...INPUT, estimates: undefined }, PE_CHECK_DEFAULTS).caveats, ['no_estimates']);
    assert.deepEqual(peCheck({ ...INPUT, estimates: { ...ESTIMATES, currency: 'TWD' } }, PE_CHECK_DEFAULTS).caveats, ['currency']);
    const loss = peCheck({ ...INPUT, estimates: { ...ESTIMATES, years: [{ periodEnd: '2026-12-31', mean: -1 }] } }, PE_CHECK_DEFAULTS);
    assert.deepEqual(loss.caveats, ['loss']);
    assert.equal(loss.forwardPe, undefined);
    const thin = peCheck(INPUT, { ...PE_CHECK_DEFAULTS, minAnalysts: 13 });
    assert.equal(thin.score, 3);
    assert.equal(thin.verdict, 'neutral');
    assert.deepEqual(thin.caveats, ['thin']);
    const stale = peCheck({ ...INPUT, today: '2026-07-10' }, PE_CHECK_DEFAULTS);
    assert.deepEqual(stale.caveats, ['stale']);
    assert.equal(stale.verdict, 'neutral');
  });

  it('loads a stock again after refresh_days', () => {
    assert.equal(estimatesDue(undefined, TODAY, PE_CHECK_DEFAULTS), true);
    assert.equal(estimatesDue('2026-05-20', TODAY, PE_CHECK_DEFAULTS), false);
    assert.equal(estimatesDue('2026-05-19', TODAY, PE_CHECK_DEFAULTS), true);
  });

  it('reads config pe_check, keeping a default for each bad field', () => {
    assert.deepEqual(readPeCheckSettings(undefined), PE_CHECK_DEFAULTS);
    const read = readPeCheckSettings({ cheap_discount: 0.2, peg_rich: 'x', min_analysts: -1, refresh_days: 14 });
    assert.equal(read.cheapDiscount, 0.2);
    assert.equal(read.pegRich, PE_CHECK_DEFAULTS.pegRich);
    assert.equal(read.minAnalysts, PE_CHECK_DEFAULTS.minAnalysts);
    assert.equal(read.refreshDays, 14);
  });

  it('reads a saved row, dropping malformed years', () => {
    const read = readEstimates({
      as_of: '2026-05-25',
      source: 'typed',
      currency: 'TWD',
      estimates: { years: [{ periodEnd: '2026-12-31', mean: 40, analysts: 20 }, { periodEnd: 'soon', mean: 1 }, { periodEnd: '2027-12-31' }], targetPrice: 1500, ratings: { buy: 10 } },
    });
    assert.deepEqual(read?.years, [{ periodEnd: '2026-12-31', mean: 40, analysts: 20 }]);
    assert.equal(read?.targetPrice, 1500);
    assert.deepEqual(read?.ratings, { strongBuy: 0, buy: 10, hold: 0, sell: 0, strongSell: 0 });
    assert.equal(readEstimates({ as_of: '2026-05-25', source: 'typed', currency: 'TWD', estimates: { years: [] } }), undefined);
  });
});
