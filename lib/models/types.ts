/** Domain types shared by the holdings page, the CSV import and, later, the rules engine. */

export type Pool = 'regular' | 'windfall';
export type Side = 'buy' | 'sell';
export type Sleeve = 'core' | 'satellite';
export type Market = 'US' | 'TW' | 'UK';
export type ProductType = 'equity_etf' | 'bond_etf' | 'gold' | 'cash_mmf' | 'stock' | 'theme_etf';

/** One buy or sell. Price, fee and tax are in the trade currency; fxRate is TWD per 1 unit of it. */
export interface Trade {
  id?: number;
  tradeDate: string;
  ticker: string;
  side: Side;
  qty: number;
  price: number;
  currency: string;
  fee: number;
  tax: number;
  fxRate: number;
  pool: Pool;
}

export interface Security {
  ticker: string;
  name: string;
  market: Market;
  productType: ProductType;
  assetClassId: string;
  sleeve: Sleeve;
  currency: string;
}

export interface AssetClass {
  id: string;
  nameEn: string;
  nameZh: string;
  /** Share of the regular-contribution pool, 0 to 1. */
  targetWeight: number;
  sleeve: Sleeve;
  sortOrder: number;
}

/** Physical gold in grams, or a savings / money-market balance in TWD (N5). */
export interface ManualAsset {
  id: number;
  name: string;
  assetClassId: string;
  productType: 'gold' | 'cash_mmf';
  unit: 'grams' | 'TWD';
  quantity: number;
  lastValueTwd: number | null;
  valuedOn: string | null;
  pool: Pool;
}

export interface PriceQuote {
  ticker: string;
  date: string;
  close: number;
}

/** pair "USD/TWD" means TWD per 1 USD. */
export interface FxQuote {
  pair: string;
  date: string;
  rate: number;
}

export type FlowType = 'contribution' | 'windfall' | 'dividend' | 'withdrawal';

/**
 * Money in or out (F18, F2): a contribution or the windfall arriving, a dividend paid out by a
 * holding, or a withdrawal. The amount is positive in its currency; the type gives the direction.
 */
export interface CashFlow {
  id?: number;
  flowDate: string;
  type: FlowType;
  amount: number;
  currency: string;
  /** TWD per 1 unit of the currency. */
  fxRate: number;
  pool: Pool;
  /** The security that paid a dividend; null for the other types. */
  ticker: string | null;
  note: string | null;
}
