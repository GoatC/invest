/**
 * SEC EDGAR (F12, Phase 2 step 4): a US company's figures from the XBRL facts of its 10-K and 10-Q
 * filings (the company facts API), for the valuation workbench. Free and keyless, but the SEC asks
 * every program to name itself with a contact email in its User-Agent (fair-access policy, at most
 * 10 requests a second) and refuses one without: the nightly job sends SEC_USER_AGENT.
 *
 * Each figure takes the first us-gaap tag in its list that reports it for a span, as companies
 * move between tags over the years; debt adds up the long-term debt (current part included),
 * commercial paper and short-term borrowings at each balance-sheet date.
 */
import type { Fact, Item } from '../../../lib/models/fundamentals.ts';
import { FeedError } from './types.ts';

export const SOURCE = 'sec';
/** Every listed company's ticker and CIK, about 700 kB. */
export const SEC_TICKERS = 'https://www.sec.gov/files/company_tickers.json';

export function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
}

/** Ticker → CIK, from company_tickers.json; class shares as SEC writes them (BRK-B) also under a dot (BRK.B). */
export function secCiks(text: string): Map<string, number> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FeedError('SEC company tickers: reply is not JSON');
  }
  const out = new Map<string, number>();
  for (const entry of Object.values((body ?? {}) as Record<string, unknown>)) {
    const row = (entry ?? {}) as { cik_str?: unknown; ticker?: unknown };
    if (typeof row.ticker !== 'string' || typeof row.cik_str !== 'number') continue;
    const ticker = row.ticker.toUpperCase();
    if (!out.has(ticker)) out.set(ticker, row.cik_str);
    if (ticker.includes('-') && !out.has(ticker.replace('-', '.'))) out.set(ticker.replace('-', '.'), row.cik_str);
  }
  if (out.size === 0) throw new FeedError('SEC company tickers: no tickers in the reply');
  return out;
}

/** Duration figures: the us-gaap tags that report each, preferred first. */
const FLOW_TAGS: Partial<Record<Item, string[]>> = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  ebit: ['OperatingIncomeLoss'],
  pretax: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  tax: ['IncomeTaxExpenseBenefit'],
  netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization', 'Depreciation'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  dividendsPaid: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
  dps: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'],
  interest: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'],
  // The red-flag indicator's (N3): gross margin, SG&A (else all operating expenses).
  grossProfit: ['GrossProfit'],
  cogs: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  sga: ['SellingGeneralAndAdministrativeExpense', 'OperatingExpenses'],
};
/** Balance-sheet figures. */
const BALANCE_TAGS: Partial<Record<Item, string[]>> = {
  currentAssets: ['AssetsCurrent'],
  currentLiabilities: ['LiabilitiesCurrent'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  receivables: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'],
  ppe: ['PropertyPlantAndEquipmentNet', 'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization'],
  totalAssets: ['Assets'],
  totalLiabilities: ['Liabilities'],
  retainedEarnings: ['RetainedEarningsAccumulatedDeficit'],
};
const DEBT_TAGS = ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtCurrent', 'CommercialPaper', 'ShortTermBorrowings'] as const;
const SHARES_TAG = 'WeightedAverageNumberOfDilutedSharesOutstanding';

/** The forms whose figures count: annual and quarterly reports, amended or not. */
const FORMS = /^(10-K|10-Q|20-F|40-F)/;

interface Entry {
  start?: string;
  end: string;
  val: number;
  filed: string;
}

function entries(units: unknown, unit: string): Entry[] {
  const list = ((units ?? {}) as Record<string, unknown>)[unit];
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const { start, end, val, filed, form } = row;
    if (typeof end !== 'string' || typeof val !== 'number' || !Number.isFinite(val) || typeof filed !== 'string' || typeof form !== 'string' || !FORMS.test(form)) return [];
    return [{ ...(typeof start === 'string' ? { start } : {}), end, val, filed }];
  });
}

const days = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;

/** A company's facts (companyfacts JSON) as figures in USD, with its name. */
export function secFacts(text: string): { name: string; facts: Fact[] } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FeedError('SEC company facts: reply is not JSON');
  }
  const reply = (body ?? {}) as { entityName?: unknown; facts?: Record<string, Record<string, { units?: unknown }>> };
  const gaap = reply.facts?.['us-gaap'];
  if (!gaap) throw new FeedError('SEC company facts: no us-gaap facts (a foreign filer reports in IFRS)');
  const unitsOf = (tag: string) => gaap[tag]?.units;
  const facts: Fact[] = [];
  const add = (item: Item, tags: readonly string[], unit: string, duration: boolean) => {
    // A span the preferred tag reports keeps its figure; the next tag only fills the others.
    const claimed = new Set<string>();
    for (const tag of tags) {
      const mine = new Set<string>();
      for (const entry of entries(unitsOf(tag), unit)) {
        if (duration !== Boolean(entry.start)) continue;
        const key = `${entry.start ?? ''}|${entry.end}`;
        if (claimed.has(key)) continue;
        mine.add(key);
        facts.push({ item, start: entry.start ?? null, end: entry.end, value: item === 'capex' || item === 'dividendsPaid' ? Math.abs(entry.val) : entry.val, filed: entry.filed });
      }
      for (const key of mine) claimed.add(key);
    }
  };
  for (const [item, tags] of Object.entries(FLOW_TAGS) as Array<[Item, string[]]>) add(item, tags, item === 'dps' ? 'USD/shares' : 'USD', true);
  for (const [item, tags] of Object.entries(BALANCE_TAGS) as Array<[Item, string[]]>) add(item, tags, 'USD', false);

  // Debt at each balance-sheet date, first reports only (a later filing restates comparatives).
  const first = new Map<string, Map<string, Entry>>();
  for (const tag of DEBT_TAGS) {
    const byEnd = new Map<string, Entry>();
    for (const entry of entries(unitsOf(tag), 'USD')) {
      if (entry.start) continue;
      const held = byEnd.get(entry.end);
      if (!held || entry.filed < held.filed) byEnd.set(entry.end, entry);
    }
    first.set(tag, byEnd);
  }
  const ends = new Set([...first.values()].flatMap((byEnd) => [...byEnd.keys()]));
  for (const end of ends) {
    const at = (tag: (typeof DEBT_TAGS)[number]) => first.get(tag)?.get(end);
    const parts = DEBT_TAGS.map(at).filter((entry): entry is Entry => entry !== undefined);
    const filed = parts.reduce((max, entry) => (entry.filed > max ? entry.filed : max), '');
    const longTerm = at('LongTermDebt')?.val ?? (at('LongTermDebtNoncurrent')?.val ?? 0) + (at('LongTermDebtCurrent')?.val ?? 0);
    const shortTerm = (at('CommercialPaper')?.val ?? 0) + (at('ShortTermBorrowings')?.val ?? 0);
    facts.push({ item: 'debt', start: null, end, value: longTerm + shortTerm, filed });
    facts.push({ item: 'shortDebt', start: null, end, value: (at('LongTermDebtCurrent')?.val ?? 0) + shortTerm, filed });
  }

  // Diluted shares: the quarter's weighted average where reported, else the longest span ending there.
  const shares = new Map<string, Entry>();
  for (const entry of entries(unitsOf(SHARES_TAG), 'shares')) {
    if (!entry.start) continue;
    const held = shares.get(entry.end);
    const quarter = (row: Entry) => days(row.start as string, row.end) <= 100;
    const better = !held || (quarter(entry) && !quarter(held)) || (quarter(entry) === quarter(held) && entry.filed < held.filed);
    if (better) shares.set(entry.end, entry);
  }
  for (const entry of shares.values()) facts.push({ item: 'shares', start: null, end: entry.end, value: entry.val, filed: entry.filed });

  return { name: typeof reply.entityName === 'string' ? reply.entityName : '', facts };
}
