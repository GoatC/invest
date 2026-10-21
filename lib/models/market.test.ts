import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MarketHistory } from './market';
import { GRAMS_PER_TROY_OUNCE } from './valuation';

describe('MarketHistory', () => {
  const market = new MarketHistory(
    [
      { ticker: 'VT', date: '2026-10-16', close: 100, adjClose: 95 },
      { ticker: 'VT', date: '2026-10-19', close: 96, adjClose: 96 },
      { ticker: '0050', date: '2026-10-16', close: 50, adjClose: null },
      { ticker: '0050', date: '2026-10-19', close: 55, adjClose: 55 },
      { ticker: 'GLDM', date: '2026-10-01', close: 50, adjClose: null },
      { ticker: 'GLDM', date: '2026-10-16', close: 60, adjClose: null },
    ],
    [
      { pair: 'USD/TWD', date: '2026-10-01', rate: 30 },
      { pair: 'USD/TWD', date: '2026-10-16', rate: 31.5 },
      { pair: 'XAU/TWD', date: '2026-10-16', rate: 3000 * GRAMS_PER_TROY_OUNCE },
      { pair: 'XAU/USD', date: '2026-10-16', rate: 2900 },
    ],
  );

  it('keeps the last close over a weekend and has none before the first', () => {
    assert.equal(market.close('VT', '2026-10-18'), 100);
    assert.equal(market.close('VT', '2026-10-19'), 96);
    assert.equal(market.close('VT', '2026-10-15'), undefined);
    assert.equal(market.close('BND', '2026-10-19'), undefined);
  });

  it('measures growth on adjusted closes, so a dividend is not a loss', () => {
    // Paid out 5 a share on the 19th: the close fell 4%, the holder gained about 1%.
    assert.equal(market.growth('VT', '2026-10-16', '2026-10-19'), 96 / 95);
    assert.equal(market.growth('VT', '2026-10-17', '2026-10-18'), 1);
    assert.equal(market.growth('VT', '2026-10-15', '2026-10-19'), undefined);
  });

  it('falls back to closes when one of the two days has no adjusted close', () => {
    assert.equal(market.growth('0050', '2026-10-16', '2026-10-19'), 55 / 50);
  });

  it('reads TWD per unit of a currency, TWD itself as 1, and the move between two dates', () => {
    assert.equal(market.fx('USD', '2026-10-20'), 31.5);
    assert.equal(market.fx('TWD', '2020-01-01'), 1);
    assert.equal(market.fx('USD', '2026-09-30'), undefined);
    assert.equal(market.fxGrowth('USD', '2026-10-01', '2026-10-16'), 1.05);
    assert.equal(market.fxGrowth('TWD', '2026-10-01', '2026-10-16'), 1);
    assert.equal(market.twdGrowth('GLDM', 'USD', '2026-10-01', '2026-10-16'), 1.2 * 1.05);
  });

  it('prices gold per gram from XAU/TWD, ignoring pairs not quoted in TWD', () => {
    assert.ok(Math.abs((market.goldPerGram('2026-10-20') ?? 0) - 3000) < 1e-9);
  });

  it('moves the gold price back by the gold ETF in TWD before the first saved price', () => {
    // GLDM in TWD was 50 × 30 on 1 October against 60 × 31.5 on the 16th.
    const expected = 3000 * ((50 * 30) / (60 * 31.5));
    assert.ok(Math.abs((market.goldPerGram('2026-10-05') ?? 0) - expected) < 1e-9);
    assert.equal(market.goldPerGram('2026-09-30'), undefined);
    assert.equal(new MarketHistory([], []).goldPerGram('2026-10-20'), undefined);
  });
});
