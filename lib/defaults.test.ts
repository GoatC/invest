import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { likelyAssetClass } from './defaults';
import type { Security } from './models/types';

function security(ticker: string, market: Security['market'], productType: Security['productType'], assetClassId: string): Security {
  return { ticker, name: ticker, market, productType, assetClassId, sleeve: 'core', currency: market === 'TW' ? 'TWD' : 'USD' };
}

const SECURITIES = [
  security('VT', 'US', 'equity_etf', 'us_global_equity'),
  security('VOO', 'US', 'equity_etf', 'us_global_equity'),
  security('0050', 'TW', 'equity_etf', 'tw_market_cap'),
  security('GLDM', 'US', 'gold', 'real_assets'),
  security('BIL', 'US', 'cash_mmf', 'strategic_cash'),
  security('AAPL', 'US', 'stock', 'us_stocks'),
];

describe('likelyAssetClass', () => {
  it('prefers securities of the same type in the same market', () => {
    assert.equal(likelyAssetClass(SECURITIES, 'equity_etf', 'TW'), 'tw_market_cap');
    assert.equal(likelyAssetClass(SECURITIES, 'equity_etf', 'US'), 'us_global_equity');
  });

  it('falls back to the same type in any market', () => {
    assert.equal(likelyAssetClass(SECURITIES, 'stock', 'TW'), 'us_stocks');
    assert.equal(likelyAssetClass(SECURITIES, 'gold'), 'real_assets');
    assert.equal(likelyAssetClass(SECURITIES, 'cash_mmf'), 'strategic_cash');
  });

  it('has no guess when nothing similar exists', () => {
    assert.equal(likelyAssetClass(SECURITIES, 'theme_etf', 'US'), undefined);
    assert.equal(likelyAssetClass([], 'gold'), undefined);
  });
});
