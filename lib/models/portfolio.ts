import { buildPositions, type Position, type Shortfall } from './positions';
import { capBreaches, classWeights, regularPool, type CapBreach, type Caps, type ClassWeight, type PoolView } from './rules';
import type { AssetClass, FxQuote, ManualAsset, PriceQuote, Security, Trade } from './types';
import { latestFx, latestPrices, valueHoldings, type Holding } from './valuation';

/** Everything the holdings view needs, as loaded from the database. */
export interface PortfolioData {
  trades: Trade[];
  securities: Security[];
  assetClasses: AssetClass[];
  prices: PriceQuote[];
  fx: FxQuote[];
  manualAssets: ManualAsset[];
}

export interface Portfolio {
  positions: Position[];
  shortfalls: Shortfall[];
  holdings: Holding[];
  pool: PoolView;
  classes: ClassWeight[];
}

export function buildPortfolio(data: PortfolioData): Portfolio {
  const { positions, shortfalls } = buildPositions(data.trades);
  const holdings = valueHoldings({
    positions,
    securities: new Map(data.securities.map((security) => [security.ticker, security])),
    assetClasses: new Map(data.assetClasses.map((assetClass) => [assetClass.id, assetClass])),
    prices: latestPrices(data.prices, data.trades),
    fx: latestFx(data.fx, data.trades),
    manualAssets: data.manualAssets,
  });
  const pool = regularPool(holdings);
  return { positions, shortfalls, holdings, pool, classes: classWeights(pool, data.assetClasses) };
}

export interface TradePreview {
  /** Breaches the trade would leave in place, with "new" marking the ones it causes. */
  breaches: Array<CapBreach & { isNew: boolean }>;
  /** Sells larger than the holding once this trade is in the book. */
  shortfalls: Shortfall[];
}

/**
 * The R1 / R2 picture with a trade added, or replacing the saved trade with the same id. N5 warns
 * on these without blocking the save; the same function runs live in the form and after saving.
 */
export function previewTrade(data: PortfolioData, trade: Trade, caps: Caps): TradePreview {
  const before = capBreaches(buildPortfolio(data).holdings, caps);
  const trades = trade.id === undefined ? [...data.trades, trade] : data.trades.map((saved) => (saved.id === trade.id ? trade : saved));
  const after = buildPortfolio({ ...data, trades });
  const existing = new Set(before.map((breach) => `${breach.rule}:${breach.subject}`));
  return {
    breaches: capBreaches(after.holdings, caps).map((breach) => ({ ...breach, isNew: !existing.has(`${breach.rule}:${breach.subject}`) })),
    shortfalls: after.shortfalls,
  };
}
