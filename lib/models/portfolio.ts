import { buildPositions, type Position, type Shortfall } from './positions';
import { restateTrades, type Split } from './splits';
import { capBreaches, classWeights, regularPool, satelliteValue, type CapBreach, type Caps, type ClassWeight, type PoolView } from './rules';
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
  /** Stock splits: trades before one are read in today's units (lib/models/splits). */
  splits?: readonly Split[];
}

export interface Portfolio {
  positions: Position[];
  shortfalls: Shortfall[];
  holdings: Holding[];
  pool: PoolView;
  classes: ClassWeight[];
}

export function buildPortfolio(data: PortfolioData): Portfolio {
  const trades = restateTrades(data.trades, data.splits);
  const { positions, shortfalls } = buildPositions(trades);
  const holdings = valueHoldings({
    positions,
    securities: new Map(data.securities.map((security) => [security.ticker, security])),
    assetClasses: new Map(data.assetClasses.map((assetClass) => [assetClass.id, assetClass])),
    prices: latestPrices(data.prices, trades),
    fx: latestFx(data.fx, trades),
    manualAssets: data.manualAssets,
  });
  const pool = regularPool(holdings);
  return { positions, shortfalls, holdings, pool, classes: classWeights(pool, data.assetClasses) };
}

/** The two figures R1 and R2 are measured against. */
export interface PoolFigures {
  totalTwd: number;
  satelliteTwd: number;
}

export function poolFigures(pool: PoolView): PoolFigures {
  return { totalTwd: pool.totalTwd, satelliteTwd: satelliteValue(pool) };
}

export interface TradePreview {
  /** Breaches the change would leave in place, with "new" marking the ones it causes. */
  breaches: Array<CapBreach & { isNew: boolean }>;
  /** Sells the change would leave larger than the holding, beyond any that were already there. */
  shortfalls: Shortfall[];
  /** The regular pool after the change. */
  after: PoolFigures;
}

function shortfallKey(shortfall: Shortfall): string {
  return `${shortfall.pool}:${shortfall.ticker}:${shortfall.tradeDate}`;
}

/** Shortfalls in `after` that `before` did not have, or that grew. */
export function addedShortfalls(before: readonly Shortfall[], after: readonly Shortfall[]): Shortfall[] {
  const was = new Map(before.map((shortfall) => [shortfallKey(shortfall), shortfall.missingQty]));
  return after.filter((shortfall) => shortfall.missingQty - (was.get(shortfallKey(shortfall)) ?? 0) > 1e-9);
}

function breachKey(breach: CapBreach): string {
  return `${breach.rule}:${breach.subject}`;
}

function compare(data: PortfolioData, trades: Trade[], caps: Caps): TradePreview {
  const current = buildPortfolio(data);
  const next = buildPortfolio({ ...data, trades });
  const existing = new Set(capBreaches(current.holdings, caps).map(breachKey));
  return {
    breaches: capBreaches(next.holdings, caps).map((breach) => ({ ...breach, isNew: !existing.has(breachKey(breach)) })),
    shortfalls: addedShortfalls(current.shortfalls, next.shortfalls),
    after: poolFigures(next.pool),
  };
}

/**
 * The R1 / R2 picture with a trade added, or replacing the saved trade with the same id. N5 warns
 * on these without blocking the save; the same function runs live in the form and after saving.
 */
export function previewTrade(data: PortfolioData, trade: Trade, caps: Caps): TradePreview {
  const trades = trade.id === undefined ? [...data.trades, trade] : data.trades.map((saved) => (saved.id === trade.id ? trade : saved));
  return compare(data, trades, caps);
}

/** The same picture for many new trades at once: a CSV import. */
export function previewImport(data: PortfolioData, added: readonly Trade[], caps: Caps): TradePreview {
  return compare(data, [...data.trades, ...added], caps);
}
