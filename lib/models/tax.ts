/**
 * F15's tax checks (PRD Module D): the US estate-tax exposure of a non-US resident, and the two
 * Taiwan checks, overseas income against the 所得基本稅額 (minimum tax) floor and the 二代健保
 * supplementary premium on Taiwan dividends. Pure functions; every threshold and rate comes from
 * config tax or the rule US_ESTATE_TAX, so a change in the law is a change of settings.
 *
 * - US-situs assets: every holding of a US-domiciled security, US shares and US-domiciled ETFs
 *   alike, in both pools (the estate counts everything), at the latest USD rate. Irish-domiciled
 *   ETFs, Taiwan-listed funds and TWD balances are not US-situs.
 * - Overseas income for the minimum tax: this year's gains and losses on sales of securities listed
 *   abroad (US and London; a Taiwan-listed fund is domestic whatever it holds), netted, a net loss
 *   counting as 0, plus the dividends recorded from them. Below the floor it is left out of the
 *   basic income altogether; from it, all of it counts, and tax is due only on the household's
 *   basic income above the exemption, at the rate. The household's other income is not known here.
 * - The supplementary premium: each Taiwan dividend payment of at least the single-payment
 *   threshold pays the rate on it, up to the cap. For a fund, only its dividend-income part is
 *   liable; the recorded payment is taken whole, so the figure is an upper bound.
 */
import { buildPositions } from './positions';
import type { CashFlow, Market, Trade } from './types';
import type { Holding } from './valuation';

/** What the checks need of a security. */
export interface TaxSecurity {
  ticker: string;
  market: Market;
  domicile: string;
}

// ---------------------------------------------------------------------------
// US estate tax
// ---------------------------------------------------------------------------

export interface SitusRow {
  ticker: string;
  label: string;
  valueTwd: number;
  valueUsd: number;
}

export interface SitusExposure {
  rows: SitusRow[];
  totalTwd: number;
  totalUsd: number;
  /** US-situs holdings with no price yet, so not in the total. */
  unpriced: string[];
}

/** Every US-domiciled holding, both pools, merged per ticker and largest first; null without a USD rate. */
export function usSitusExposure(holdings: readonly Holding[], domicileOf: (ticker: string) => string | undefined, usdTwd: number | null): SitusExposure | null {
  if (usdTwd === null || usdTwd <= 0) return null;
  const byTicker = new Map<string, SitusRow>();
  const unpriced = new Set<string>();
  for (const holding of holdings) {
    if (holding.ticker === null || holding.qty <= 0 || domicileOf(holding.ticker) !== 'US') continue;
    if (holding.valueTwd === null) {
      unpriced.add(holding.ticker);
      continue;
    }
    const row = byTicker.get(holding.ticker) ?? { ticker: holding.ticker, label: holding.label, valueTwd: 0, valueUsd: 0 };
    row.valueTwd += holding.valueTwd;
    row.valueUsd = row.valueTwd / usdTwd;
    byTicker.set(holding.ticker, row);
  }
  const rows = [...byTicker.values()].sort((a, b) => b.valueTwd - a.valueTwd || a.ticker.localeCompare(b.ticker));
  const totalTwd = rows.reduce((sum, row) => sum + row.valueTwd, 0);
  return { rows, totalTwd, totalUsd: totalTwd / usdTwd, unpriced: [...unpriced].sort() };
}

// ---------------------------------------------------------------------------
// Overseas income and the minimum tax (所得基本稅額)
// ---------------------------------------------------------------------------

export interface OverseasIncome {
  year: string;
  /** Net gains on sales of securities listed abroad this year; may be negative. */
  gainsTwd: number;
  dividendsTwd: number;
  /** max(0, gains) + dividends: what counts towards the floor. */
  totalTwd: number;
  floorTwd: number;
  /** From the floor, all of it enters the basic income. */
  counts: boolean;
  /** The sales and dividends behind the figures. */
  sales: Array<{ date: string; ticker: string; gainTwd: number }>;
  dividends: Array<{ date: string; ticker: string; amountTwd: number }>;
}

export function overseasIncome(trades: readonly Trade[], flows: readonly CashFlow[], securities: ReadonlyMap<string, TaxSecurity>, year: string, floorTwd: number): OverseasIncome {
  const abroad = (ticker: string | null) => ticker !== null && securities.get(ticker) !== undefined && securities.get(ticker)?.market !== 'TW';
  const sales = buildPositions(trades)
    .sales.filter((sale) => sale.tradeDate.startsWith(`${year}-`) && abroad(sale.ticker))
    .map((sale) => ({ date: sale.tradeDate, ticker: sale.ticker, gainTwd: sale.gainTwd }));
  const dividends = flows
    .filter((flow) => flow.type === 'dividend' && flow.flowDate.startsWith(`${year}-`) && abroad(flow.ticker))
    .map((flow) => ({ date: flow.flowDate, ticker: flow.ticker as string, amountTwd: flow.amount * flow.fxRate }));
  const gainsTwd = sales.reduce((sum, sale) => sum + sale.gainTwd, 0);
  const dividendsTwd = dividends.reduce((sum, dividend) => sum + dividend.amountTwd, 0);
  const totalTwd = Math.max(0, gainsTwd) + dividendsTwd;
  return { year, gainsTwd, dividendsTwd, totalTwd, floorTwd, counts: totalTwd >= floorTwd, sales, dividends };
}

// ---------------------------------------------------------------------------
// The supplementary health-insurance premium (二代健保補充保費)
// ---------------------------------------------------------------------------

export interface PremiumRow {
  date: string;
  ticker: string;
  amountTwd: number;
  /** The rate on the payment (up to the cap) when it reaches the threshold, else 0. */
  premiumTwd: number;
}

export interface Premiums {
  rows: PremiumRow[];
  totalTwd: number;
  /** The largest payment this year, to see how close one comes to the threshold. */
  largestTwd: number;
}

export function supplementaryPremiums(
  flows: readonly CashFlow[],
  securities: ReadonlyMap<string, TaxSecurity>,
  year: string,
  nhi: { rate: number; singlePaymentTwd: number; maxPaymentTwd: number },
): Premiums {
  const rows = flows
    .filter((flow) => flow.type === 'dividend' && flow.flowDate.startsWith(`${year}-`) && flow.ticker !== null && securities.get(flow.ticker)?.market === 'TW')
    .map((flow) => {
      const amountTwd = flow.amount * flow.fxRate;
      const premiumTwd = amountTwd >= nhi.singlePaymentTwd ? Math.round(Math.min(amountTwd, nhi.maxPaymentTwd) * nhi.rate) : 0;
      return { date: flow.flowDate, ticker: flow.ticker as string, amountTwd, premiumTwd };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    rows,
    totalTwd: rows.reduce((sum, row) => sum + row.premiumTwd, 0),
    largestTwd: rows.reduce((largest, row) => Math.max(largest, row.amountTwd), 0),
  };
}
