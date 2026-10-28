/**
 * The rules engine (PRD Section 4): the Investment Policy Statement in executable form. After the
 * nightly refresh, or when the owner asks, it evaluates every enabled rule it knows by the rule's
 * `condition`, drafts a proposal with an order list when one fires, and decides which open
 * proposals to close. It never trades (L2): the owner approves, edits or dismisses each proposal
 * and places the orders by hand. Pure functions; lib/data.ts loads the input and saves the outcome.
 *
 * Rules evaluated (Phase 1, step 9), each on the regular-contribution pool, windfall money left out:
 * - single_stock_weight_above (R1): a stock above max_weight → sell it back to the cap.
 * - satellite_weight_above (R2): the satellite above trigger_weight → sell it back to target_weight,
 *   pro rata across its holdings, counting what R1 sells of them in the same run.
 * - class_drift_exceeds (F8_DRIFT): a core class past the 5/25 band → sell the classes over it back
 *   to target and buy the ones under it, cash first: when only classes under their band are out and
 *   the next contribution covers them, no sale is proposed and the contribution does it.
 * - day_after_dca (MONTHLY_CONTRIBUTION): the day after the DCA debit → put the contribution into the
 *   most underweight core classes.
 * - first_weekend_of_month (ANNUAL_REVIEW): from the first Saturday of January → a full rebalance of
 *   the core back to its targets, and a prompt to review the rules.
 * - us_situs_value_above (US_ESTATE_TAX, step 11): US-situs assets (every US-domiciled holding, both
 *   pools, as the estate counts everything) above the exemption → a suggestion to use Irish-domiciled
 *   equivalents, with no orders: a sale abroad is overseas income, so the swap is the owner's call.
 * - tranche_due (WINDFALL_TRANCHE_DUE, Phase 2 step 1): a windfall tranche falls due → the cash
 *   waiting over the tranches left, split by the core targets (F3: never the satellite).
 * - index_drawdown_tier (WINDFALL_ACCELERATION): ACWI past a tier below its 52-week high → the next
 *   tranche pulled forward, or a share of the cash waiting, once per tier and drawdown.
 *   Windfall orders draw on the windfall pool's TWD balance and buy through config windfall.vehicles,
 *   else the pool's largest holding of the class, else its benchmark; strategic cash's share stays
 *   in the balance, which is strategic cash already.
 * - price_at_or_below_value_multiple (BUY_ZONE, Phase 2 step 4): a watched stock's price at or below
 *   its saved base value × the buy multiple → a buy of the month's contribution share
 *   (MONTHLY_CONTRIBUTION's satellite_share_with_buy_alert), split over the stocks in the zone and
 *   each kept within R1's cap and R2's target; the month's contribution then puts the rest into the
 *   core. Once a month per stock list.
 * - price_at_or_above_value_multiple (TRIM_ZONE): a held stock's price at or above its saved base
 *   value × the trim multiple → sell sell_share of it, the proceeds into the core.
 * - value_change_exceeds (VALUATION_UPDATED): a filing moved a watched stock's base value by more
 *   than `change` from the value saved before it → a prompt to review, with no orders.
 *
 * Every sale's proceeds stay in the regular pool: they buy the most underweight core classes (at
 * most MONTHLY_CONTRIBUTION's max_classes, F8's minimum-fee limit; F8 never buys the satellite).
 * Listed orders are in whole shares, or in fractions to config orders.share_decimals for the
 * markets in orders.fractional_markets (US shares through 複委託): sales round up so a cap is met,
 * purchases round down so the cash covers them, and what is left stays as cash. A TWD balance (savings, money-market) is moved
 * as an amount; gold held in grams cannot be ordered and is reported as such.
 *
 * Noise control: a rule fires at most once per cooldown_days unless its state (what it fired on)
 * changes; an open proposal closes when it times out (config proposal_expiry_days), when its rule
 * no longer fires, or when a new state supersedes it.
 */
import { addDays } from '../dates';
import { classDrifts, type DriftBands } from './allocation';
import { daysBetween } from './fx';
import { classWeights, regularPool, type PoolView } from './rules';
import { usSitusExposure } from './tax';
import type { AssetClass, Pool, Side } from './types';
import type { Holding } from './valuation';
import { drawdownOf, readAcceleration, tierAmount, tierToFire, type Close } from './windfall';

/** Floating-point sums a hair over a limit are not over it. */
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Input and output
// ---------------------------------------------------------------------------

export interface EngineRule {
  id: string;
  condition: string;
  threshold: unknown;
  enabled: boolean;
  cooldownDays: number;
}

export interface EngineClass extends AssetClass {
  benchmarkTicker: string | null;
}

/** A security's latest close in its trade currency and the TWD rate for that currency. */
export interface EngineQuote {
  price: number;
  currency: string;
  fxRate: number;
  /** Decimals an order's share count may have: 0 for whole shares, e.g. 4 for fractional US shares (config orders). */
  decimals: number;
}

export type ProposalStatus = 'open' | 'approved' | 'dismissed' | 'filled' | 'expired';
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['open', 'approved', 'dismissed', 'filled', 'expired'];

export type ClosedReason = 'timed_out' | 'cleared' | 'superseded';

/** What the engine needs to know about a proposal already saved. */
export interface ProposalRecord {
  id: number;
  ruleId: string;
  state: string;
  status: ProposalStatus;
  /** ISO timestamps. */
  createdAt: string;
  expiresAt: string | null;
}

export interface EngineInput {
  /** Today in Taipei, YYYY-MM-DD. */
  today: string;
  /** The current time, ISO; open proposals expire against it. */
  now: string;
  /** Every holding, valued as on the holdings page; the engine keeps the regular pool. */
  holdings: readonly Holding[];
  assetClasses: readonly EngineClass[];
  /** Latest close and rate per ticker, to price a fund not held yet. */
  quotes: ReadonlyMap<string, EngineQuote>;
  rules: readonly EngineRule[];
  /** config dca. */
  dca: { amountTwd: number | null; dayOfMonth: number | null };
  /** config proposal_expiry_days; null: proposals do not expire. */
  expiryDays: number | null;
  /** Proposals of the last while (every open and approved one, and recent others for the cooldown). */
  proposals: readonly ProposalRecord[];
  /** Each security's domicile, ISO code (US_ESTATE_TAX); without it the rule waits. */
  domiciles?: ReadonlyMap<string, string>;
  /** TWD per USD, the latest rate (US_ESTATE_TAX); without it the rule waits. */
  usdTwd?: number | null;
  /** The windfall plan (F3); without it the two windfall rules wait. */
  windfall?: WindfallInput;
  /** The watched stocks' saved values (F12); without them the three valuation rules wait. */
  watch?: readonly WatchInput[];
}

/** A watched single stock's newest saved value a share (F12), for the zone rules. */
export interface WatchInput {
  ticker: string;
  assetClassId: string;
  /** The base value a share of the model its alerts use, in the stock's trade currency. */
  value: number;
  valuedOn: string;
  /** What saved it: Hugo's edit, or a new quarter's filing. */
  trigger: 'edit' | 'filing';
  /** The value of the same model saved before it. */
  previous?: { value: number; valuedOn: string };
  /** The stock's own multiples (watchlist), else the rules'. */
  buy?: number;
  trim?: number;
}

export interface WindfallTranche {
  id: number;
  dueDate: string;
  amountTwd: number;
  status: 'scheduled' | 'accelerated' | 'done';
}

export interface FiredTier {
  drawdown: number;
  /** The 52-week high's date, which names the drawdown. */
  peakDate: string;
  firedOn: string;
}

export interface WindfallInput {
  /** null until a plan is started on the Windfall page. */
  plan: { id: number; totalTwd: number; startDate: string; tranches: WindfallTranche[]; tiersFired: FiredTier[] } | null;
  /** ACWI's daily closes over a little more than the drawdown window. */
  gauge: Close[];
  /** config windfall.vehicles: the fund each core class is bought through. */
  vehicles: Record<string, string>;
}

/** A listed buy or sell, in whole shares or, where the broker takes them, fractions. */
export interface TradeOrder {
  kind: 'trade';
  ticker: string;
  side: Side;
  qty: number;
  /** Decimals the share count may have; 0 (or absent, in orders saved before fractions) is whole shares. */
  decimals?: number;
  /** The latest close in the trade currency, and TWD per unit of it. */
  price: number;
  currency: string;
  fxRate: number;
  amountTwd: number;
  assetClassId: string;
  /** The pool it is recorded in; absent is the regular pool. */
  pool?: Pool;
}

/** Money moved into or out of a TWD balance (savings, money-market fund entered as a balance). */
export interface BalanceOrder {
  kind: 'balance';
  assetId: number;
  label: string;
  side: 'deposit' | 'withdraw';
  amountTwd: number;
  assetClassId: string;
  pool?: Pool;
}

export type DraftOrder = TradeOrder | BalanceOrder;

export interface ClassRow {
  id: string;
  weight: number;
  target: number;
  /** The drift past which F8 rebalances; null for the satellite. */
  band: number | null;
}

/** The figures behind a proposal, for its explanation. Amounts in TWD, weights as fractions. */
export interface ProposalDetail {
  poolTwd: number;
  /** R1: each stock over the cap. */
  stocks?: Array<{ ticker: string; valueTwd: number; weight: number; trimTwd: number; soldTwd?: number }>;
  limit?: number;
  /** R2. */
  satelliteTwd?: number;
  weight?: number;
  trigger?: number;
  target?: number;
  trimTwd?: number;
  /** What R1 sells of the satellite in the same run, counted towards R2's trim. */
  countedTwd?: number;
  /** F8_DRIFT: the classes past their band; ANNUAL_REVIEW: every core class. */
  classes?: ClassRow[];
  /** MONTHLY_CONTRIBUTION. */
  contributionTwd?: number;
  dcaDate?: string;
  /** Cash the orders invest: sale proceeds plus any contribution. */
  cashTwd: number;
  /** Cash left over once whole shares are bought. */
  leftTwd: number;
  /** Value the sales should have taken but could not, as it is held in a form no order can sell (gold in grams). */
  untradedTwd?: number;
  /** Core classes with no fund to buy: no listed holding, TWD balance or priced benchmark ETF. */
  noFund?: string[];
  /** US_ESTATE_TAX: the US-situs holdings, both pools, their total in USD, the exemption and the rate used. */
  situs?: Array<{ ticker: string; valueTwd: number; valueUsd: number }>;
  situsUsd?: number;
  limitUsd?: number;
  usdTwd?: number;
  /** Windfall rules: the cash waiting, the tranches still scheduled, the tranche due, what strategic cash keeps. */
  waitingTwd?: number;
  tranchesLeft?: number;
  trancheId?: number;
  dueDate?: string;
  keptTwd?: number;
  /** WINDFALL_ACCELERATION: the drawdown, its peak and the newest close, the tier, and the tranches it pulls forward. */
  drawdown?: number;
  peak?: Close;
  latest?: Close;
  tier?: number;
  /** A tier that deploys a share of the cash waiting: that share. */
  share?: number;
  accelerated?: number[];
  /** BUY_ZONE and TRIM_ZONE: each stock in the zone, its price, value a share, the multiple, and what is bought or sold. */
  zone?: ZoneRow[];
  /** BUY_ZONE: the month's contribution share it may spend. MONTHLY_CONTRIBUTION: the share it leaves to BUY_ZONE. */
  satelliteShareTwd?: number;
  /** TRIM_ZONE: the share of each holding sold. */
  sellShare?: number;
  /** VALUATION_UPDATED: each stock whose value a filing moved. */
  changes?: Array<{ ticker: string; value: number; previous: number; valuedOn: string; previousOn: string; change: number }>;
}

export interface ZoneRow {
  ticker: string;
  price: number;
  currency: string;
  value: number;
  multiple: number;
  /** BUY_ZONE: what R1 and R2 leave room for, TWD; the share bought. */
  roomTwd?: number;
  boughtTwd?: number;
  /** TRIM_ZONE: the holding's value and what is sold of it. */
  heldTwd?: number;
  soldTwd?: number;
}

export interface Draft {
  ruleId: string;
  state: string;
  orders: DraftOrder[];
  detail: ProposalDetail;
}

/**
 * fires: a proposal is due (it may still be held back by the cooldown); quiet: the condition does
 * not hold; covered: it holds, but another proposal or the next contribution deals with it;
 * waiting: it cannot be evaluated yet (no DCA day, nothing in the pool); unreadable: a threshold
 * is missing or malformed; off: disabled; later: evaluated by a feature of a later step.
 */
export type CheckOutcome = 'fires' | 'quiet' | 'covered' | 'waiting' | 'unreadable' | 'off' | 'later';

export interface Check {
  ruleId: string;
  outcome: CheckOutcome;
  draft?: Draft;
  /** covered by: 'R1' or 'contribution'; waiting for: 'dca_day', 'pool', 'usd', 'plan', 'windfall_cash', 'gauge', 'valuation'. */
  why?: string;
  /** For a firing rule: held back by its cooldown until this date. */
  cooldownUntil?: string;
}

export interface Outcome {
  checks: Check[];
  create: Array<Draft & { expiresAt: string | null }>;
  close: Array<{ id: number; reason: ClosedReason }>;
  /** The windfall plan's record of the tiers fired, when a tier fired in this run. */
  windfall?: { planId: number; tiersFired: FiredTier[]; peakClose: number };
}

// ---------------------------------------------------------------------------
// Reading thresholds
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function fraction(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 && value < 1 ? value : undefined;
}

/** R1 and R2 measure the regular pool; a rule set to another pool is not one this engine can read. */
function regularOnly(threshold: Record<string, unknown>): boolean {
  return threshold['pool'] === undefined || threshold['pool'] === 'regular';
}

/** F8's limit on how many classes one buy list spreads over (MONTHLY_CONTRIBUTION max_classes); no limit when unreadable. */
export function maxBuyClasses(rules: readonly EngineRule[]): number {
  const rule = rules.find((candidate) => candidate.condition === 'day_after_dca');
  const value = record(rule?.threshold)['max_classes'];
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : Number.POSITIVE_INFINITY;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function isBalance(holding: Holding): boolean {
  return holding.ticker === null && holding.productType === 'cash_mmf';
}

function manualId(holding: Holding): number {
  return Number(holding.key.split(':')[1]);
}

/** TWD per share of a listed holding, from its quote. */
function unitOf(quote: EngineQuote): number {
  return quote.price * quote.fxRate;
}

function tradeOrder(ticker: string, side: Side, qty: number, quote: EngineQuote, assetClassId: string): TradeOrder {
  return {
    kind: 'trade',
    ticker,
    side,
    qty,
    price: quote.price,
    currency: quote.currency,
    fxRate: quote.fxRate,
    amountTwd: qty * unitOf(quote),
    assetClassId,
    ...(quote.decimals > 0 ? { decimals: quote.decimals } : {}),
  };
}

/** Share counts rounded up, down or to the nearest step of `decimals` places. */
function roundShares(shares: number, decimals: number, how: 'up' | 'down' | 'nearest'): number {
  const scale = 10 ** decimals;
  const scaled = shares * scale;
  const rounded = how === 'up' ? Math.ceil(scaled - EPS) : how === 'down' ? Math.floor(scaled + EPS) : Math.round(scaled);
  return rounded / scale;
}

/** The regular pool's working copy: values change as the drafted orders are applied. */
class Book {
  readonly total: number;
  readonly values = new Map<string, number>();
  constructor(
    readonly pool: PoolView,
    private readonly quotes: ReadonlyMap<string, EngineQuote>,
  ) {
    this.total = pool.totalTwd;
    for (const holding of pool.holdings) this.values.set(holding.key, holding.valueTwd ?? 0);
  }

  valueOf(holding: Holding): number {
    return this.values.get(holding.key) ?? 0;
  }

  classValue(assetClassId: string): number {
    return this.pool.holdings.filter((holding) => holding.assetClassId === assetClassId).reduce((sum, holding) => sum + this.valueOf(holding), 0);
  }

  /**
   * Sells about `amount` TWD of one holding: shares rounded up (whole, or to the quote's decimals),
   * at most all of it; a TWD balance to the dollar. Gold in grams, or a listed holding without a
   * quote, gives no order.
   */
  sell(holding: Holding, amount: number): DraftOrder | undefined {
    const held = this.valueOf(holding);
    if (amount <= EPS || held <= EPS) return undefined;
    if (holding.ticker !== null) {
      const quote = this.quotes.get(holding.ticker);
      if (!quote || unitOf(quote) <= 0) return undefined;
      const shares = held / unitOf(quote);
      const qty = Math.min(roundShares(amount / unitOf(quote), quote.decimals, 'up'), roundShares(shares, quote.decimals, 'nearest'));
      if (qty <= 0) return undefined;
      const order = tradeOrder(holding.ticker, 'sell', qty, quote, holding.assetClassId);
      this.values.set(holding.key, Math.max(0, held - order.amountTwd));
      return order;
    }
    if (!isBalance(holding)) return undefined;
    const amountTwd = Math.min(held, Math.round(amount));
    if (amountTwd <= 0) return undefined;
    this.values.set(holding.key, held - amountTwd);
    return { kind: 'balance', assetId: manualId(holding), label: holding.label, side: 'withdraw', amountTwd, assetClassId: holding.assetClassId };
  }

  /** Sells about `amount` TWD of a class: listed holdings largest first, then TWD balances. Returns the orders and what could not be sold. */
  sellClass(assetClassId: string, amount: number): { orders: DraftOrder[]; untraded: number } {
    const holdings = this.pool.holdings
      .filter((holding) => holding.assetClassId === assetClassId && this.valueOf(holding) > EPS)
      .sort((a, b) => Number(a.ticker === null) - Number(b.ticker === null) || this.valueOf(b) - this.valueOf(a));
    const orders: DraftOrder[] = [];
    let left = amount;
    for (const holding of holdings) {
      if (left <= EPS) break;
      const order = this.sell(holding, Math.min(left, this.valueOf(holding)));
      if (!order) continue;
      orders.push(order);
      left -= order.amountTwd;
    }
    return { orders, untraded: Math.max(0, left) };
  }

  /**
   * What a class is bought through: its largest listed holding in the regular pool, else its
   * largest TWD balance, else its benchmark ETF if that has a quote.
   */
  vehicle(assetClass: EngineClass): { ticker: string; quote: EngineQuote } | { balance: Holding } | undefined {
    const inClass = this.pool.holdings.filter((holding) => holding.assetClassId === assetClass.id).sort((a, b) => this.valueOf(b) - this.valueOf(a));
    for (const holding of inClass) {
      const quote = holding.ticker === null ? undefined : this.quotes.get(holding.ticker);
      if (holding.ticker !== null && quote && unitOf(quote) > 0) return { ticker: holding.ticker, quote };
    }
    const balance = inClass.find(isBalance);
    if (balance) return { balance };
    const benchmark = assetClass.benchmarkTicker ? this.quotes.get(assetClass.benchmarkTicker) : undefined;
    return assetClass.benchmarkTicker && benchmark && unitOf(benchmark) > 0 ? { ticker: assetClass.benchmarkTicker, quote: benchmark } : undefined;
  }
}

/**
 * Splits cash over the chosen classes: in proportion to how far each is below its target; once
 * every one is at its target, the rest in proportion to the targets themselves.
 */
export function allocate(cash: number, chosen: ReadonlyArray<{ id: string; gap: number; target: number }>): Map<string, number> {
  const out = new Map<string, number>();
  if (cash <= EPS || chosen.length === 0) return out;
  const gaps = chosen.map((row) => Math.max(0, row.gap));
  const totalGap = gaps.reduce((sum, gap) => sum + gap, 0);
  if (totalGap >= cash) {
    chosen.forEach((row, index) => out.set(row.id, (cash * (gaps[index] ?? 0)) / totalGap));
    return out;
  }
  const rest = cash - totalGap;
  const totalTarget = chosen.reduce((sum, row) => sum + row.target, 0);
  chosen.forEach((row, index) => out.set(row.id, (gaps[index] ?? 0) + rest * (totalTarget > 0 ? row.target / totalTarget : 1 / chosen.length)));
  return out;
}

interface BuyResult {
  orders: DraftOrder[];
  left: number;
  noFund: string[];
}

/**
 * Buys each class's share of the cash through its fund: shares rounded down (whole, or to the
 * quote's decimals), then one more whole share at a time, to the class furthest short of its share,
 * while the cash left covers one; then the rest to a fund bought in fractions, and to a TWD
 * balance, which takes the exact amount.
 */
function buy(book: Book, shares: ReadonlyMap<string, number>, classes: ReadonlyMap<string, EngineClass>, cash: number): BuyResult {
  const lines: Array<{ id: string; want: number; ticker?: string; quote?: EngineQuote; balance?: Holding; qty: number; amount: number }> = [];
  const noFund: string[] = [];
  for (const [id, want] of shares) {
    const assetClass = classes.get(id);
    const vehicle = assetClass ? book.vehicle(assetClass) : undefined;
    if (!vehicle) {
      noFund.push(id);
      continue;
    }
    if ('balance' in vehicle) {
      lines.push({ id, want, balance: vehicle.balance, qty: 0, amount: Math.floor(want) });
      continue;
    }
    const qty = roundShares(want / unitOf(vehicle.quote), vehicle.quote.decimals, 'down');
    lines.push({ id, want, ticker: vehicle.ticker, quote: vehicle.quote, qty, amount: qty * unitOf(vehicle.quote) });
  }
  let left = cash - lines.reduce((sum, line) => sum + line.amount, 0);
  for (;;) {
    const fits = lines.filter((line) => line.quote && line.quote.decimals === 0 && unitOf(line.quote) <= left + EPS);
    if (fits.length === 0) break;
    const line = fits.reduce((best, candidate) => (candidate.want - candidate.amount > best.want - best.amount ? candidate : best));
    const unit = unitOf(line.quote as EngineQuote);
    line.qty += 1;
    line.amount += unit;
    left -= unit;
  }
  // What whole shares leave goes to the fund bought in fractions furthest short of its share.
  const fractional = lines.filter((line) => line.quote && line.quote.decimals > 0).sort((a, b) => b.want - b.amount - (a.want - a.amount))[0];
  if (fractional?.quote && left > EPS) {
    const extra = roundShares(left / unitOf(fractional.quote), fractional.quote.decimals, 'down');
    fractional.qty = roundShares(fractional.qty + extra, fractional.quote.decimals, 'nearest');
    fractional.amount += extra * unitOf(fractional.quote);
    left -= extra * unitOf(fractional.quote);
  }
  const balanceLine = lines.find((line) => line.balance);
  if (balanceLine && left >= 1) {
    balanceLine.amount += Math.floor(left);
    left -= Math.floor(left);
  }
  const orders: DraftOrder[] = [];
  for (const line of lines) {
    if (line.balance && line.amount >= 1) {
      orders.push({ kind: 'balance', assetId: manualId(line.balance), label: line.balance.label, side: 'deposit', amountTwd: line.amount, assetClassId: line.id });
    } else if (line.ticker && line.quote && line.qty > 0) {
      orders.push(tradeOrder(line.ticker, 'buy', line.qty, line.quote, line.id));
    }
  }
  return { orders, left: Math.max(0, left), noFund };
}

/** Core classes and how far each is below its target (TWD) in a pool of `total`. */
function coreGaps(book: Book, classes: readonly EngineClass[], total: number): Array<{ id: string; gap: number; target: number }> {
  return classes.filter((assetClass) => assetClass.sleeve === 'core').map((assetClass) => ({ id: assetClass.id, gap: assetClass.targetWeight * total - book.classValue(assetClass.id), target: assetClass.targetWeight }));
}

/** The `count` core classes furthest below target, after the ones that must be in. */
function chooseBuys(gaps: ReadonlyArray<{ id: string; gap: number; target: number }>, count: number, required: readonly string[] = []): Array<{ id: string; gap: number; target: number }> {
  const sorted = [...gaps].sort((a, b) => b.gap - a.gap);
  const chosen = sorted.filter((row) => required.includes(row.id));
  const limit = Math.max(count, chosen.length);
  for (const row of sorted) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(row) && row.target > 0) chosen.push(row);
  }
  // Keep only classes below target, unless none is (then the closest ones take the cash).
  const below = chosen.filter((row) => row.gap > EPS);
  return below.length > 0 ? below : chosen;
}

// ---------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------

interface Context {
  input: EngineInput;
  pool: PoolView;
  classes: readonly EngineClass[];
  classById: ReadonlyMap<string, EngineClass>;
  maxBuy: number;
  /** TWD that R1's live proposal sells of each satellite stock: drafted now or still open or approved. */
  r1Trims: Map<string, number>;
  /** R1's trims as evaluated, before the decision on its proposal. */
  pendingTrims: Map<string, number>;
  monthlyActive: boolean;
  /** The month's contribution share BUY_ZONE spends, which the month's contribution leaves to it. */
  buyZoneTwd: number;
}

type Result = Omit<Check, 'ruleId'>;

function newBook(context: Context): Book {
  return new Book(context.pool, context.input.quotes);
}

function invest(context: Context, book: Book, sells: DraftOrder[], extraCash: number, required: readonly string[] = [], all = false) {
  const proceeds = sells.reduce((sum, order) => sum + order.amountTwd, 0);
  const cash = proceeds + extraCash;
  const gaps = coreGaps(book, context.classes, book.total + extraCash);
  const chosen = all ? gaps.filter((row) => row.gap > EPS) : chooseBuys(gaps, context.maxBuy, required);
  const bought = buy(book, allocate(cash, chosen), context.classById, cash);
  return { orders: [...sells, ...bought.orders], cashTwd: cash, leftTwd: bought.left, noFund: bought.noFund };
}

function evaluateR1(rule: EngineRule, context: Context): Result {
  const threshold = record(rule.threshold);
  const limit = fraction(threshold['max_weight']);
  if (limit === undefined || !regularOnly(threshold)) return { outcome: 'unreadable' };
  const total = context.pool.totalTwd;
  if (total <= 0) return { outcome: 'waiting', why: 'pool' };
  const stocks = context.pool.holdings
    .filter((holding) => holding.productType === 'stock' && holding.ticker !== null)
    .map((holding) => ({ holding, valueTwd: holding.valueTwd ?? 0, weight: (holding.valueTwd ?? 0) / total }))
    .filter((row) => row.weight - limit > EPS)
    .sort((a, b) => (a.holding.ticker ?? '').localeCompare(b.holding.ticker ?? ''));
  if (stocks.length === 0) return { outcome: 'quiet' };
  const book = newBook(context);
  const sells: DraftOrder[] = [];
  const rows = stocks.map(({ holding, valueTwd, weight }) => {
    const trimTwd = valueTwd - limit * total;
    const order = book.sell(holding, trimTwd);
    if (order) {
      sells.push(order);
      if (holding.sleeve === 'satellite') context.pendingTrims.set(holding.key, order.amountTwd);
    }
    return { ticker: holding.ticker as string, valueTwd, weight, trimTwd, ...(order ? { soldTwd: order.amountTwd } : {}) };
  });
  const result = invest(context, book, sells, 0);
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: rows.map((row) => row.ticker).join(','),
      orders: result.orders,
      detail: { poolTwd: total, stocks: rows, limit, cashTwd: result.cashTwd, leftTwd: result.leftTwd, ...(result.noFund.length ? { noFund: result.noFund } : {}) },
    },
  };
}

function evaluateR2(rule: EngineRule, context: Context): Result {
  const threshold = record(rule.threshold);
  const trigger = fraction(threshold['trigger_weight']);
  const target = fraction(threshold['target_weight']);
  if (trigger === undefined || target === undefined || target > trigger || !regularOnly(threshold)) return { outcome: 'unreadable' };
  const total = context.pool.totalTwd;
  if (total <= 0) return { outcome: 'waiting', why: 'pool' };
  const satellite = context.pool.holdings.filter((holding) => holding.sleeve === 'satellite');
  const satelliteTwd = satellite.reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const weight = satelliteTwd / total;
  if (weight - trigger <= EPS) return { outcome: 'quiet' };
  const trimTwd = satelliteTwd - target * total;
  const countedTwd = [...context.r1Trims.values()].reduce((sum, value) => sum + value, 0);
  const rest = trimTwd - countedTwd;
  if (rest <= EPS) return { outcome: 'covered', why: 'R1' };
  // Pro rata over the satellite as R1 leaves it, so no holding is sold twice over.
  const book = newBook(context);
  const after = satellite.map((holding) => ({ holding, value: (holding.valueTwd ?? 0) - (context.r1Trims.get(holding.key) ?? 0) }));
  const base = after.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  for (const row of after) if (context.r1Trims.has(row.holding.key)) book.values.set(row.holding.key, Math.max(0, row.value));
  const sells: DraftOrder[] = [];
  let untraded = 0;
  for (const row of after) {
    const share = base > 0 ? (rest * Math.max(0, row.value)) / base : 0;
    const order = book.sell(row.holding, share);
    if (order) sells.push(order);
    else untraded += share;
  }
  const result = invest(context, book, sells, 0);
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: 'satellite',
      orders: result.orders,
      detail: {
        poolTwd: total,
        satelliteTwd,
        weight,
        trigger,
        target,
        trimTwd,
        ...(countedTwd > 0 ? { countedTwd } : {}),
        cashTwd: result.cashTwd,
        leftTwd: result.leftTwd,
        ...(untraded > 0.5 ? { untradedTwd: untraded } : {}),
        ...(result.noFund.length ? { noFund: result.noFund } : {}),
      },
    },
  };
}

/** The 5/25 band from F8_DRIFT's threshold. */
function bandsOf(rule: EngineRule): DriftBands | undefined {
  const { abs_drift: absDrift, rel_drift: relDrift } = record(rule.threshold);
  if (typeof absDrift !== 'number' || absDrift <= 0 || typeof relDrift !== 'number' || relDrift <= 0) return undefined;
  return { absDrift, relDrift, warnShare: 1 };
}

function classRows(context: Context, bands: DriftBands | undefined): ReturnType<typeof classDrifts> {
  return classDrifts(classWeights(context.pool, context.classes), bands, context.pool.totalTwd);
}

function evaluateDrift(rule: EngineRule, context: Context): Result {
  const bands = bandsOf(rule);
  if (!bands) return { outcome: 'unreadable' };
  const total = context.pool.totalTwd;
  if (total <= 0) return { outcome: 'waiting', why: 'pool' };
  const rows = classRows(context, bands).filter((row) => row.assetClass.sleeve === 'core');
  const out = rows.filter((row) => row.status === 'rebalance');
  if (out.length === 0) return { outcome: 'quiet' };
  const state = out
    .map((row) => `${row.assetClass.id}:${row.drift > 0 ? 'over' : 'under'}`)
    .sort()
    .join(',');
  const under = out.filter((row) => row.drift < 0);
  const over = out.filter((row) => row.drift > 0);
  const need = under.reduce((sum, row) => sum - row.drift * total, 0);
  // Cash first: when only classes under their band are out and the next contribution, which goes
  // to the most underweight classes, can bring them all back to target, no sale is proposed.
  const contribution = context.input.dca.amountTwd ?? 0;
  const needWithCash = under.reduce((sum, row) => sum + row.assetClass.targetWeight * (total + contribution) - row.valueTwd, 0);
  if (over.length === 0 && context.monthlyActive && under.length <= context.maxBuy && contribution + EPS >= needWithCash) return { outcome: 'covered', why: 'contribution' };

  const book = newBook(context);
  const sells: DraftOrder[] = [];
  let untraded = 0;
  let raised = 0;
  const sellDown = (id: string, amount: number) => {
    const sold = book.sellClass(id, amount);
    sells.push(...sold.orders);
    untraded += sold.untraded;
    raised += sold.orders.reduce((sum, order) => sum + order.amountTwd, 0);
  };
  for (const row of over) sellDown(row.assetClass.id, row.drift * total);
  // Not enough to buy the classes under their band: sell the most overweight others back to target.
  const others = rows.filter((row) => row.status !== 'rebalance' && row.drift > EPS).sort((a, b) => b.drift - a.drift);
  for (const row of others) {
    if (raised + EPS >= need) break;
    sellDown(row.assetClass.id, Math.min(row.drift * total, need - raised));
  }
  const result = invest(
    context,
    book,
    sells,
    0,
    under.map((row) => row.assetClass.id),
  );
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state,
      orders: result.orders,
      detail: {
        poolTwd: total,
        classes: out.map((row) => ({ id: row.assetClass.id, weight: row.weight, target: row.assetClass.targetWeight, band: row.band })),
        cashTwd: result.cashTwd,
        leftTwd: result.leftTwd,
        ...(untraded > 0.5 ? { untradedTwd: untraded } : {}),
        ...(result.noFund.length ? { noFund: result.noFund } : {}),
      },
    },
  };
}

function lastDayOfMonth(month: string): number {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

/** The DCA date of a month: the set day, or the month's last day when it is shorter. */
export function dcaDate(month: string, day: number): string {
  return `${month}-${String(Math.min(day, lastDayOfMonth(month))).padStart(2, '0')}`;
}

/** The latest DCA date whose next day has come, if that day is within `window` days of today. */
export function dueContribution(today: string, day: number, window: number): string | undefined {
  const month = today.slice(0, 7);
  const [year, number] = month.split('-').map(Number) as [number, number];
  const previous = number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
  for (const candidate of [month, previous]) {
    const date = dcaDate(candidate, day);
    const fires = addDays(date, 1);
    if (fires <= today) return daysBetween(fires, today) < window ? date : undefined;
  }
  return undefined;
}

function evaluateMonthly(rule: EngineRule, context: Context): Result {
  const { amountTwd, dayOfMonth } = context.input.dca;
  if (dayOfMonth === null || amountTwd === null || amountTwd <= 0) return { outcome: 'waiting', why: 'dca_day' };
  const date = dueContribution(context.input.today, dayOfMonth, context.input.expiryDays ?? 28);
  if (!date) return { outcome: 'quiet' };
  const book = newBook(context);
  const reserved = Math.min(amountTwd, context.buyZoneTwd);
  const result = invest(context, book, [], amountTwd - reserved);
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: date.slice(0, 7),
      orders: result.orders,
      detail: {
        poolTwd: context.pool.totalTwd,
        contributionTwd: amountTwd,
        dcaDate: date,
        ...(reserved > 0 ? { satelliteShareTwd: reserved } : {}),
        cashTwd: result.cashTwd,
        leftTwd: result.leftTwd,
        ...(result.noFund.length ? { noFund: result.noFund } : {}),
      },
    },
  };
}

/** The first Saturday of a YYYY-MM month. */
export function firstSaturday(month: string): string {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  return addDays(first, (6 - weekday + 7) % 7);
}

function evaluateAnnual(rule: EngineRule, context: Context, drift: EngineRule | undefined): Result {
  const month = record(rule.threshold)['month'];
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) return { outcome: 'unreadable' };
  const { today } = context.input;
  const current = `${today.slice(0, 4)}-${String(month).padStart(2, '0')}`;
  if (today.slice(0, 7) !== current || today < firstSaturday(current)) return { outcome: 'quiet' };
  const total = context.pool.totalTwd;
  const rows = classRows(context, drift ? bandsOf(drift) : undefined).filter((row) => row.assetClass.sleeve === 'core');
  const book = newBook(context);
  const sells: DraftOrder[] = [];
  let untraded = 0;
  if (total > 0) {
    for (const row of rows.filter((candidate) => candidate.drift > EPS)) {
      const sold = book.sellClass(row.assetClass.id, row.drift * total);
      sells.push(...sold.orders);
      untraded += sold.untraded;
    }
  }
  const result = total > 0 ? invest(context, book, sells, 0, [], true) : { orders: [], cashTwd: 0, leftTwd: 0, noFund: [] };
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: today.slice(0, 4),
      orders: result.orders,
      detail: {
        poolTwd: total,
        classes: rows.map((row) => ({ id: row.assetClass.id, weight: row.weight, target: row.assetClass.targetWeight, band: row.band })),
        cashTwd: result.cashTwd,
        leftTwd: result.leftTwd,
        ...(untraded > 0.5 ? { untradedTwd: untraded } : {}),
        ...(result.noFund.length ? { noFund: result.noFund } : {}),
      },
    },
  };
}

function evaluateEstate(rule: EngineRule, context: Context): Result {
  const limit = record(rule.threshold)['usd'];
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return { outcome: 'unreadable' };
  const { domiciles, usdTwd, holdings } = context.input;
  const exposure = domiciles && usdTwd ? usSitusExposure(holdings, (ticker) => domiciles.get(ticker), usdTwd) : null;
  if (!exposure || !usdTwd) return { outcome: 'waiting', why: 'usd' };
  if (exposure.totalUsd - limit <= EPS) return { outcome: 'quiet' };
  const total = holdings.reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: 'over',
      orders: [],
      detail: {
        poolTwd: total,
        situs: exposure.rows.map((row) => ({ ticker: row.ticker, valueTwd: row.valueTwd, valueUsd: row.valueUsd })),
        situsUsd: exposure.totalUsd,
        limitUsd: limit,
        usdTwd,
        cashTwd: 0,
        leftTwd: 0,
      },
    },
  };
}

/** The windfall pool's TWD balances (savings or a money-market fund): the cash waiting to be deployed. */
function waitingBalances(holdings: readonly Holding[]): Holding[] {
  return holdings.filter((holding) => holding.pool === 'windfall' && isBalance(holding) && (holding.valueTwd ?? 0) > 0).sort((a, b) => (b.valueTwd ?? 0) - (a.valueTwd ?? 0));
}

/**
 * Orders for `amount` of the windfall's waiting cash, split by the core targets: each class
 * bought through its windfall vehicle, else the windfall pool's largest holding of it, else its
 * benchmark ETF, in shares rounded down. Strategic cash's share stays where it is (the waiting
 * balance is strategic cash). One withdrawal from the largest balance pays for the purchases.
 */
function deployWindfall(context: Context, windfall: WindfallInput, amount: number): { orders: DraftOrder[]; boughtTwd: number; keptTwd: number; noFund: string[] } {
  const holdings = context.input.holdings.filter((holding) => holding.pool === 'windfall');
  const source = waitingBalances(holdings)[0];
  const core = context.classes.filter((assetClass) => assetClass.sleeve === 'core' && assetClass.targetWeight > 0);
  const total = core.reduce((sum, assetClass) => sum + assetClass.targetWeight, 0);
  const buys: DraftOrder[] = [];
  const noFund: string[] = [];
  let keptTwd = 0;
  for (const assetClass of core) {
    const want = (amount * assetClass.targetWeight) / total;
    if (source && assetClass.id === source.assetClassId) {
      keptTwd += want;
      continue;
    }
    const largest = holdings.filter((holding) => holding.assetClassId === assetClass.id && holding.ticker !== null).sort((a, b) => (b.valueTwd ?? 0) - (a.valueTwd ?? 0))[0];
    const ticker = [windfall.vehicles[assetClass.id], largest?.ticker, assetClass.benchmarkTicker].find((candidate) => {
      const quote = candidate ? context.input.quotes.get(candidate) : undefined;
      return quote !== undefined && unitOf(quote) > 0;
    });
    const quote = ticker ? context.input.quotes.get(ticker) : undefined;
    if (!ticker || !quote) {
      noFund.push(assetClass.id);
      continue;
    }
    const qty = roundShares(want / unitOf(quote), quote.decimals, 'down');
    if (qty > 0) buys.push({ ...tradeOrder(ticker, 'buy', qty, quote, assetClass.id), pool: 'windfall' });
  }
  const boughtTwd = buys.reduce((sum, order) => sum + order.amountTwd, 0);
  const orders: DraftOrder[] = [];
  if (source && boughtTwd > 0) {
    orders.push({ kind: 'balance', assetId: manualId(source), label: source.label, side: 'withdraw', amountTwd: Math.ceil(boughtTwd), assetClassId: source.assetClassId, pool: 'windfall' });
  }
  return { orders: [...orders, ...buys], boughtTwd, keptTwd, noFund };
}

function windfallState(context: Context) {
  const windfall = context.input.windfall;
  const plan = windfall?.plan;
  if (!windfall || !plan) return undefined;
  const left = plan.tranches.filter((tranche) => tranche.status === 'scheduled').sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
  const waitingTwd = waitingBalances(context.input.holdings).reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const poolTwd = context.input.holdings.filter((holding) => holding.pool === 'windfall').reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  return { windfall, plan, left, waitingTwd, poolTwd };
}

function evaluateTranche(rule: EngineRule, context: Context): Result {
  const state = windfallState(context);
  if (!state) return { outcome: 'waiting', why: 'plan' };
  const due = state.left.find((tranche) => tranche.dueDate <= context.input.today);
  if (!due) return { outcome: 'quiet' };
  if (state.waitingTwd <= 0) return { outcome: 'waiting', why: 'windfall_cash' };
  const amount = state.waitingTwd / state.left.length;
  const deployed = deployWindfall(context, state.windfall, amount);
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: `tranche:${due.id}`,
      orders: deployed.orders,
      detail: {
        poolTwd: state.poolTwd,
        waitingTwd: state.waitingTwd,
        tranchesLeft: state.left.length,
        trancheId: due.id,
        dueDate: due.dueDate,
        keptTwd: deployed.keptTwd,
        cashTwd: amount,
        leftTwd: Math.max(0, amount - deployed.boughtTwd - deployed.keptTwd),
        ...(deployed.noFund.length ? { noFund: deployed.noFund } : {}),
      },
    },
  };
}

function evaluateAcceleration(rule: EngineRule, context: Context): Result {
  const acceleration = readAcceleration(rule.threshold);
  if (!acceleration) return { outcome: 'unreadable' };
  const state = windfallState(context);
  if (!state) return { outcome: 'waiting', why: 'plan' };
  if (state.left.length === 0 || state.waitingTwd <= 0) return { outcome: 'quiet' };
  const drawdown = drawdownOf(state.windfall.gauge, context.input.today, acceleration.windowWeeks);
  if (!drawdown) return { outcome: 'waiting', why: 'gauge' };
  const fired = state.plan.tiersFired.filter((tier) => tier.peakDate === drawdown.peak.date).map((tier) => tier.drawdown);
  const tier = tierToFire(acceleration.tiers, drawdown.drawdown, fired);
  if (!tier) return { outcome: 'quiet' };
  const amount = Math.min(state.waitingTwd, tierAmount(tier, state.waitingTwd, state.left.length));
  // The tranche pulled forward is the next one not due yet (else the last); all of them when everything goes in.
  const next = state.left.find((tranche) => tranche.dueDate > context.input.today) ?? state.left[state.left.length - 1];
  const accelerated = tier.deploy.kind === 'next_tranche' ? (next ? [next.id] : []) : tier.deploy.share >= 1 ? state.left.map((tranche) => tranche.id) : [];
  const deployed = deployWindfall(context, state.windfall, amount);
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: `tier:${tier.drawdown}:${drawdown.peak.date}`,
      orders: deployed.orders,
      detail: {
        poolTwd: state.poolTwd,
        waitingTwd: state.waitingTwd,
        tranchesLeft: state.left.length,
        drawdown: drawdown.drawdown,
        peak: drawdown.peak,
        latest: drawdown.latest,
        tier: tier.drawdown,
        ...(tier.deploy.kind === 'share' ? { share: tier.deploy.share } : {}),
        accelerated,
        keptTwd: deployed.keptTwd,
        cashTwd: amount,
        leftTwd: Math.max(0, amount - deployed.boughtTwd - deployed.keptTwd),
        ...(deployed.noFund.length ? { noFund: deployed.noFund } : {}),
      },
    },
  };
}

/** The share of a contribution that may go to the satellite during a buy-zone alert (MONTHLY_CONTRIBUTION). */
function satelliteShare(rules: readonly EngineRule[]): number {
  const rule = rules.find((candidate) => candidate.condition === 'day_after_dca');
  return fraction(record(rule?.threshold)['satellite_share_with_buy_alert']) ?? 0;
}

/** An enabled rule's threshold number, by condition and key. */
function capOf(rules: readonly EngineRule[], condition: string, key: string): number | undefined {
  const rule = rules.find((candidate) => candidate.condition === condition && candidate.enabled);
  return rule ? fraction(record(rule.threshold)[key]) : undefined;
}

function evaluateBuyZone(rule: EngineRule, context: Context): Result {
  const multiple = fraction(record(rule.threshold)['multiple']);
  if (multiple === undefined) return { outcome: 'unreadable' };
  const { watch, quotes, dca, rules, today } = context.input;
  if (!watch) return { outcome: 'waiting', why: 'valuation' };
  const inZone = watch
    .flatMap((entry) => {
      const quote = quotes.get(entry.ticker);
      const used = entry.buy ?? multiple;
      return quote && quote.price <= entry.value * used + EPS ? [{ entry, quote, used }] : [];
    })
    .sort((a, b) => a.entry.ticker.localeCompare(b.entry.ticker));
  if (inZone.length === 0) return { outcome: 'quiet' };
  const shareTwd = (dca.amountTwd ?? 0) * satelliteShare(rules);
  // Room under R1 and R2 counts the pool once the contribution is in, and what R1's live proposal sells.
  const total = context.pool.totalTwd + (dca.amountTwd ?? 0);
  const maxWeight = capOf(rules, 'single_stock_weight_above', 'max_weight');
  const satelliteTarget = capOf(rules, 'satellite_weight_above', 'target_weight');
  const trimmed = [...context.r1Trims.values()].reduce((sum, value) => sum + value, 0);
  const satelliteTwd = context.pool.holdings.filter((holding) => holding.sleeve === 'satellite').reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0) - trimmed;
  let satelliteRoom = satelliteTarget === undefined ? Number.POSITIVE_INFINITY : satelliteTarget * total - satelliteTwd;
  const orders: DraftOrder[] = [];
  const zone: ZoneRow[] = inZone.map(({ entry, quote, used }) => {
    const held = context.pool.holdings.filter((holding) => holding.ticker === entry.ticker).reduce((sum, holding) => sum + (holding.valueTwd ?? 0) - (context.r1Trims.get(holding.key) ?? 0), 0);
    const room = Math.max(0, Math.min(maxWeight === undefined ? Number.POSITIVE_INFINITY : maxWeight * total - held, satelliteRoom));
    const want = Math.min(shareTwd / inZone.length, room);
    const qty = unitOf(quote) > 0 ? roundShares(want / unitOf(quote), quote.decimals, 'down') : 0;
    const row: ZoneRow = { ticker: entry.ticker, price: quote.price, currency: quote.currency, value: entry.value, multiple: used, roomTwd: Number.isFinite(room) ? room : shareTwd };
    if (qty > 0) {
      const order = tradeOrder(entry.ticker, 'buy', qty, quote, entry.assetClassId);
      orders.push(order);
      satelliteRoom -= order.amountTwd;
      row.boughtTwd = order.amountTwd;
    }
    return row;
  });
  const bought = orders.reduce((sum, order) => sum + order.amountTwd, 0);
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: `${today.slice(0, 7)}:${zone.map((row) => row.ticker).join(',')}`,
      orders,
      detail: { poolTwd: context.pool.totalTwd, zone, satelliteShareTwd: shareTwd, cashTwd: shareTwd, leftTwd: Math.max(0, shareTwd - bought) },
    },
  };
}

function evaluateTrimZone(rule: EngineRule, context: Context): Result {
  const threshold = record(rule.threshold);
  const multiple = threshold['multiple'];
  const sellShare = typeof threshold['sell_share'] === 'number' && threshold['sell_share'] > 0 && threshold['sell_share'] <= 1 ? threshold['sell_share'] : undefined;
  if (typeof multiple !== 'number' || !(multiple > 1) || sellShare === undefined) return { outcome: 'unreadable' };
  const { watch, quotes } = context.input;
  if (!watch) return { outcome: 'waiting', why: 'valuation' };
  const byTicker = new Map(watch.map((entry) => [entry.ticker, entry]));
  const held = context.pool.holdings
    .flatMap((holding) => {
      const entry = holding.ticker ? byTicker.get(holding.ticker) : undefined;
      const quote = holding.ticker ? quotes.get(holding.ticker) : undefined;
      const used = entry?.trim ?? multiple;
      return entry && quote && quote.price + EPS >= entry.value * used ? [{ holding, entry, quote, used }] : [];
    })
    .sort((a, b) => a.entry.ticker.localeCompare(b.entry.ticker));
  if (held.length === 0) return { outcome: 'quiet' };
  const book = newBook(context);
  const sells: DraftOrder[] = [];
  const zone: ZoneRow[] = held.map(({ holding, entry, quote, used }) => {
    // What R1's live proposal sells of it already is not sold twice.
    const left = Math.max(0, (holding.valueTwd ?? 0) - (context.r1Trims.get(holding.key) ?? 0));
    book.values.set(holding.key, left);
    const order = book.sell(holding, left * sellShare);
    if (order) sells.push(order);
    return { ticker: entry.ticker, price: quote.price, currency: quote.currency, value: entry.value, multiple: used, heldTwd: holding.valueTwd ?? 0, ...(order ? { soldTwd: order.amountTwd } : {}) };
  });
  const result = invest(context, book, sells, 0);
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: zone.map((row) => row.ticker).join(','),
      orders: result.orders,
      detail: { poolTwd: context.pool.totalTwd, zone, sellShare, cashTwd: result.cashTwd, leftTwd: result.leftTwd, ...(result.noFund.length ? { noFund: result.noFund } : {}) },
    },
  };
}

function evaluateValueChange(rule: EngineRule, context: Context): Result {
  const limit = fraction(record(rule.threshold)['change']);
  if (limit === undefined) return { outcome: 'unreadable' };
  const { watch } = context.input;
  if (!watch) return { outcome: 'waiting', why: 'valuation' };
  const changes = watch
    .flatMap((entry) => {
      const previous = entry.previous;
      if (entry.trigger !== 'filing' || !previous || previous.value <= 0) return [];
      const change = entry.value / previous.value - 1;
      return Math.abs(change) - limit > EPS ? [{ ticker: entry.ticker, value: entry.value, previous: previous.value, valuedOn: entry.valuedOn, previousOn: previous.valuedOn, change }] : [];
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (changes.length === 0) return { outcome: 'quiet' };
  return {
    outcome: 'fires',
    draft: {
      ruleId: rule.id,
      state: changes.map((row) => `${row.ticker}:${row.valuedOn}`).join(','),
      orders: [],
      detail: { poolTwd: context.pool.totalTwd, changes, cashTwd: 0, leftTwd: 0 },
    },
  };
}

/** The conditions this engine evaluates, in the order it runs them (R2 counts what R1 sells). */
export const CONDITIONS = [
  'single_stock_weight_above',
  'satellite_weight_above',
  'class_drift_exceeds',
  // Before the contribution, which leaves the buy zone its share.
  'price_at_or_below_value_multiple',
  'day_after_dca',
  'first_weekend_of_month',
  'us_situs_value_above',
  'tranche_due',
  'index_drawdown_tier',
  'price_at_or_above_value_multiple',
  'value_change_exceeds',
] as const;

/** Conditions that fire once per period: their state is (or starts with) the month or the year. */
const PERIODIC: readonly string[] = ['day_after_dca', 'first_weekend_of_month', 'price_at_or_below_value_multiple'];

// ---------------------------------------------------------------------------
// Deciding what to save
// ---------------------------------------------------------------------------

function taipeiDate(at: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

/** Evaluates every rule and decides which proposals to draft and which open ones to close. */
export function evaluate(input: EngineInput): Outcome {
  const pool = regularPool(input.holdings);
  const classes = [...input.assetClasses].sort((a, b) => a.sortOrder - b.sortOrder);
  const monthly = input.rules.find((rule) => rule.condition === 'day_after_dca');
  const context: Context = {
    input,
    pool,
    classes,
    classById: new Map(classes.map((assetClass) => [assetClass.id, assetClass])),
    maxBuy: maxBuyClasses(input.rules),
    r1Trims: new Map(),
    pendingTrims: new Map(),
    monthlyActive: Boolean(monthly?.enabled && input.dca.dayOfMonth !== null && (input.dca.amountTwd ?? 0) > 0),
    buyZoneTwd: 0,
  };
  const drift = input.rules.find((rule) => rule.condition === 'class_drift_exceeds' && rule.enabled);
  const order = (rule: EngineRule) => {
    const index = CONDITIONS.indexOf(rule.condition as (typeof CONDITIONS)[number]);
    return index < 0 ? CONDITIONS.length : index;
  };
  const checks: Check[] = [];
  const create: Outcome['create'] = [];
  const close: Outcome['close'] = [];
  let windfall: Outcome['windfall'];
  const now = Date.parse(input.now);

  for (const rule of [...input.rules].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))) {
    const known = (CONDITIONS as readonly string[]).includes(rule.condition);
    let result: Result;
    if (!known) result = { outcome: 'later' };
    else if (!rule.enabled) result = { outcome: 'off' };
    else if (rule.condition === 'single_stock_weight_above') result = evaluateR1(rule, context);
    else if (rule.condition === 'satellite_weight_above') result = evaluateR2(rule, context);
    else if (rule.condition === 'class_drift_exceeds') result = evaluateDrift(rule, context);
    else if (rule.condition === 'day_after_dca') result = evaluateMonthly(rule, context);
    else if (rule.condition === 'us_situs_value_above') result = evaluateEstate(rule, context);
    else if (rule.condition === 'tranche_due') result = evaluateTranche(rule, context);
    else if (rule.condition === 'index_drawdown_tier') result = evaluateAcceleration(rule, context);
    else if (rule.condition === 'price_at_or_below_value_multiple') result = evaluateBuyZone(rule, context);
    else if (rule.condition === 'price_at_or_above_value_multiple') result = evaluateTrimZone(rule, context);
    else if (rule.condition === 'value_change_exceeds') result = evaluateValueChange(rule, context);
    else result = evaluateAnnual(rule, context, drift);
    const check: Check = { ruleId: rule.id, ...result };
    checks.push(check);
    if (!known) continue;

    const mine = input.proposals.filter((proposal) => proposal.ruleId === rule.id);
    let open = mine.filter((proposal) => proposal.status === 'open');
    // Unactioned proposals time out and are evaluated afresh.
    for (const proposal of open) {
      if (proposal.expiresAt !== null && Date.parse(proposal.expiresAt) <= now) close.push({ id: proposal.id, reason: 'timed_out' });
    }
    open = open.filter((proposal) => !close.some((closed) => closed.id === proposal.id));

    const created = create.length;
    const live = decide(rule, check, mine, open);
    if (rule.condition === 'single_stock_weight_above') context.r1Trims = live ? context.pendingTrims : new Map();
    // The month's contribution leaves its satellite share to a buy-zone proposal of the month, live or filled.
    if (rule.condition === 'price_at_or_below_value_multiple') {
      const month = `${input.today.slice(0, 7)}:`;
      const spent = mine.some((proposal) => proposal.state.startsWith(month) && ['open', 'approved', 'filled'].includes(proposal.status) && !close.some((closed) => closed.id === proposal.id));
      if (live || spent) context.buyZoneTwd = (input.dca.amountTwd ?? 0) * satelliteShare(input.rules);
    }
    // A tier fires once per drawdown: the plan keeps the record once its proposal is drafted.
    const plan = input.windfall?.plan;
    const tier = check.draft?.detail;
    if (rule.condition === 'index_drawdown_tier' && create.length > created && plan && tier?.tier !== undefined && tier.peak) {
      windfall = { planId: plan.id, tiersFired: [...plan.tiersFired, { drawdown: tier.tier, peakDate: tier.peak.date, firedOn: input.today }], peakClose: tier.peak.close };
    }
  }

  /** Closes what no longer stands and drafts what is due; true when the rule's proposal is live afterwards. */
  function decide(rule: EngineRule, check: Check, mine: readonly ProposalRecord[], open: readonly ProposalRecord[]): boolean {
    const draft = check.draft;
    if (check.outcome !== 'fires' || !draft) {
      for (const proposal of open) close.push({ id: proposal.id, reason: 'cleared' });
      return false;
    }
    const active = [...open, ...mine.filter((proposal) => proposal.status === 'approved')];
    if (active.some((proposal) => proposal.state === draft.state)) return true;
    for (const proposal of open) close.push({ id: proposal.id, reason: 'superseded' });
    // A contribution or a year's review dismissed or done is not proposed again; one that timed out is.
    if (PERIODIC.includes(rule.condition) && mine.some((proposal) => proposal.state === draft.state && (proposal.status === 'dismissed' || proposal.status === 'filled'))) return false;
    const last = [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (last && last.state === draft.state && daysBetween(taipeiDate(last.createdAt), input.today) < rule.cooldownDays) {
      check.cooldownUntil = addDays(taipeiDate(last.createdAt), rule.cooldownDays);
      return false;
    }
    const expiresAt = input.expiryDays === null ? null : new Date(now + input.expiryDays * 86_400_000).toISOString();
    create.push({ ...draft, expiresAt });
    return true;
  }
  return { checks, create, close, ...(windfall ? { windfall } : {}) };
}

// ---------------------------------------------------------------------------
// Reading saved orders
// ---------------------------------------------------------------------------

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Saved orders read back defensively: an entry that is not a whole order is left out. */
export function readOrders(value: unknown): DraftOrder[] {
  if (!Array.isArray(value)) return [];
  const out: DraftOrder[] = [];
  for (const entry of value) {
    const row = record(entry);
    const amountTwd = finite(row['amountTwd']);
    const assetClassId = typeof row['assetClassId'] === 'string' ? row['assetClassId'] : '';
    if (amountTwd === undefined) continue;
    if (row['kind'] === 'trade') {
      const [qty, price, fxRate] = [finite(row['qty']), finite(row['price']), finite(row['fxRate'])];
      const { ticker, side, currency } = row;
      if (typeof ticker !== 'string' || (side !== 'buy' && side !== 'sell') || typeof currency !== 'string' || qty === undefined || price === undefined || fxRate === undefined) continue;
      const decimals = finite(row['decimals']);
      out.push({
        kind: 'trade',
        ticker,
        side,
        qty,
        price,
        currency,
        fxRate,
        amountTwd,
        assetClassId,
        ...(decimals !== undefined && Number.isInteger(decimals) && decimals > 0 && decimals <= 8 ? { decimals } : {}),
        ...(row['pool'] === 'windfall' ? { pool: 'windfall' as const } : {}),
      });
    } else if (row['kind'] === 'balance') {
      const assetId = finite(row['assetId']);
      const { label, side } = row;
      if (assetId === undefined || typeof label !== 'string' || (side !== 'deposit' && side !== 'withdraw')) continue;
      out.push({ kind: 'balance', assetId, label, side, amountTwd, assetClassId, ...(row['pool'] === 'windfall' ? { pool: 'windfall' as const } : {}) });
    }
  }
  return out;
}

/** An order with a new quantity (a trade) or amount (a balance); 0 drops it. */
export function resized(order: DraftOrder, size: number): DraftOrder | undefined {
  if (size <= 0) return undefined;
  if (order.kind === 'trade') return { ...order, qty: size, amountTwd: size * order.price * order.fxRate };
  return { ...order, amountTwd: size };
}

/** Money the orders take in (sales, withdrawals) and spend (purchases, deposits), TWD. */
export function orderTotals(orders: readonly DraftOrder[]): { sold: number; bought: number } {
  let sold = 0;
  let bought = 0;
  for (const order of orders) {
    if (order.side === 'sell' || order.side === 'withdraw') sold += order.amountTwd;
    else bought += order.amountTwd;
  }
  return { sold, bought };
}

/** A saved detail read back: the figures the engine wrote, with the three every proposal has. */
export function readDetail(value: unknown): ProposalDetail {
  const row = record(value);
  return { ...(row as Partial<ProposalDetail>), poolTwd: finite(row['poolTwd']) ?? 0, cashTwd: finite(row['cashTwd']) ?? 0, leftTwd: finite(row['leftTwd']) ?? 0 };
}
