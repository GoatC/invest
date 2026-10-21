import type { AssetClass, Security, Trade } from './types';
import type { Holding } from './valuation';

/** A USD buy of VT unless overridden. */
export function trade(overrides: Partial<Trade> = {}): Trade {
  return { tradeDate: '2026-10-01', ticker: 'VT', side: 'buy', qty: 1, price: 100, currency: 'USD', fee: 0, tax: 0, fxRate: 32, pool: 'regular', ...overrides };
}

/** A priced regular-pool core ETF unless overridden. */
export function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    key: 'regular:VT',
    ticker: 'VT',
    label: 'Vanguard Total World Stock ETF',
    pool: 'regular',
    sleeve: 'core',
    assetClassId: 'us_global_equity',
    productType: 'equity_etf',
    qty: 1,
    currency: 'USD',
    valueTwd: 0,
    costTwd: 0,
    estimated: false,
    ...overrides,
  };
}

export const SECURITIES: Security[] = [
  { ticker: 'VT', name: 'Vanguard Total World Stock ETF', market: 'US', productType: 'equity_etf', assetClassId: 'us_global_equity', sleeve: 'core', currency: 'USD' },
  { ticker: '0050', name: '元大台灣50', market: 'TW', productType: 'equity_etf', assetClassId: 'tw_market_cap', sleeve: 'core', currency: 'TWD' },
  { ticker: 'AAPL', name: 'Apple Inc.', market: 'US', productType: 'stock', assetClassId: 'us_stocks', sleeve: 'satellite', currency: 'USD' },
  { ticker: '2330', name: '台積電', market: 'TW', productType: 'stock', assetClassId: 'tw_stocks', sleeve: 'satellite', currency: 'TWD' },
];

/** The Investment Principles targets. */
export const ASSET_CLASSES: AssetClass[] = [
  { id: 'us_global_equity', nameEn: 'US / global equity', nameZh: '美股／全球大盤', targetWeight: 0.28, sleeve: 'core', sortOrder: 1 },
  { id: 'tw_market_cap', nameEn: 'Taiwan market-cap equity', nameZh: '台股市值型', targetWeight: 0.12, sleeve: 'core', sortOrder: 2 },
  { id: 'global_bonds', nameEn: 'Global bonds', nameZh: '全球債券', targetWeight: 0.22, sleeve: 'core', sortOrder: 3 },
  { id: 'real_assets', nameEn: 'Real assets', nameZh: '實體資產', targetWeight: 0.1, sleeve: 'core', sortOrder: 4 },
  { id: 'strategic_cash', nameEn: 'Strategic cash', nameZh: '戰略現金', targetWeight: 0.08, sleeve: 'core', sortOrder: 5 },
  { id: 'us_stocks', nameEn: 'US stocks', nameZh: '美股個股', targetWeight: 0.1, sleeve: 'satellite', sortOrder: 6 },
  { id: 'tw_stocks', nameEn: 'Taiwan stocks', nameZh: '台股個股', targetWeight: 0.05, sleeve: 'satellite', sortOrder: 7 },
  { id: 'tactical_themes', nameEn: 'Tactical themes', nameZh: '戰術主題', targetWeight: 0.05, sleeve: 'satellite', sortOrder: 8 },
];

/** R1 and R2 as seeded from the PRD. */
export const CAPS = { singleStock: { maxWeight: 0.05 }, satellite: { triggerWeight: 0.25, targetWeight: 0.2 } };
