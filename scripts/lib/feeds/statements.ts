/**
 * FinMind's Taiwan financial statements (F12, Phase 2 step 4): the income statement, balance sheet
 * and cash-flow statement of a Taiwan company, for the valuation workbench. Items are matched by
 * the statement's own Chinese line name (origin_name), which FinMind keeps as filed, else by its
 * English type. The income statement comes by quarter; the cash-flow statement as filed in Taiwan,
 * the year to date (each year starts on 1 January, as every Taiwan listing reports by calendar
 * year). The share count is the quarter's net income over its EPS, which follows a change of par
 * value, else the share capital at NT$10 a share. The dividend a share adds up each quarter's
 * cash ex-dividends (息) from the ex-dividend results; one with a stock dividend in it (權息) is
 * left out, as the cash part cannot be told apart.
 */
import type { Fact, Item } from '../../../lib/models/fundamentals.ts';
import type { Row } from './finmind.ts';

export const STATEMENT_DATASETS = {
  income: 'TaiwanStockFinancialStatements',
  balance: 'TaiwanStockBalanceSheet',
  cash: 'TaiwanStockCashFlowsStatement',
  /** The ex-dividend results, for the cash dividend a share: the cash-flow statement may not list dividends paid. */
  dividends: 'TaiwanStockDividendResult',
} as const;

type Match = { types: string[]; names: string[] };

const INCOME: Partial<Record<Item | 'eps', Match>> = {
  revenue: { types: ['Revenue'], names: ['營業收入合計', '營業收入'] },
  ebit: { types: ['OperatingIncome'], names: ['營業利益（損失）'] },
  pretax: { types: ['PreTaxIncome'], names: ['稅前淨利（淨損）', '繼續營業單位稅前淨利（淨損）'] },
  tax: { types: ['TAX', 'IncomeTaxExpense'], names: ['所得稅費用（利益）', '所得稅費用（利益）合計'] },
  netIncome: { types: ['EquityAttributableToOwnersOfParent'], names: ['淨利（淨損）歸屬於母公司業主', '母公司業主（淨利∕損）'] },
  eps: { types: ['EPS'], names: ['基本每股盈餘', '基本每股盈餘（元）'] },
  // The red-flag indicator's (N3). Taiwan statements give operating expenses, not SG&A alone.
  grossProfit: { types: ['GrossProfit'], names: ['營業毛利（毛損）', '營業毛利（毛損）淨額'] },
  cogs: { types: ['CostOfGoodsSold'], names: ['營業成本', '營業成本合計'] },
  sga: { types: ['OperatingExpenses'], names: ['營業費用', '營業費用合計'] },
};
const BALANCE: Partial<Record<Item | 'capital', Match>> = {
  currentAssets: { types: ['CurrentAssets'], names: ['流動資產合計'] },
  currentLiabilities: { types: ['CurrentLiabilities'], names: ['流動負債合計'] },
  cash: { types: ['CashAndCashEquivalents'], names: ['現金及約當現金'] },
  equity: { types: ['EquityAttributableToOwnersOfParent'], names: ['歸屬於母公司業主之權益合計'] },
  capital: { types: ['OrdinaryShare'], names: ['普通股股本'] },
  receivables: { types: ['AccountsReceivableNet'], names: ['應收帳款淨額'] },
  ppe: { types: ['PropertyPlantAndEquipment'], names: ['不動產、廠房及設備'] },
  totalAssets: { types: ['TotalAssets'], names: ['資產總額', '資產總計'] },
  totalLiabilities: { types: ['Liabilities'], names: ['負債總額', '負債總計'] },
  retainedEarnings: { types: ['RetainedEarnings'], names: ['保留盈餘合計', '保留盈餘（或累積虧損）合計'] },
};
/** Interest-bearing debt, and which of it is due within the year. */
const DEBT: Array<Match & { current: boolean }> = [
  { types: ['ShortTermBorrowings'], names: ['短期借款'], current: true },
  { types: ['ShortTermNotesAndBillsPayable'], names: ['應付短期票券'], current: true },
  { types: ['CurrentPortionOfLongTermLiabilities', 'LongTermLiabilitiesCurrentPortion'], names: ['一年或一營業週期內到期長期負債', '一年內到期長期負債'], current: true },
  { types: ['BondsPayable'], names: ['應付公司債'], current: false },
  { types: ['LongtermBorrowings', 'LongTermBorrowings'], names: ['長期借款'], current: false },
];
const CASH: Partial<Record<Item | 'depreciation' | 'amortization', Match>> = {
  ocf: { types: ['NetCashInflowFromOperatingActivities', 'CashFlowsFromOperatingActivities'], names: ['營業活動之淨現金流入（流出）'] },
  depreciation: { types: ['Depreciation', 'DepreciationExpense'], names: ['折舊費用'] },
  amortization: { types: ['AmortizationExpense', 'Amortization'], names: ['攤銷費用'] },
  capex: { types: ['PropertyAndPlantAndEquipment', 'AcquisitionOfPropertyPlantAndEquipment'], names: ['取得不動產、廠房及設備'] },
  dividendsPaid: { types: ['CashDividendsPaid'], names: ['發放現金股利'] },
  interest: { types: ['InterestExpense'], names: ['利息費用'] },
};

/** Each line's value by period end, for the lines a match names; the Chinese name first. */
function lines(rows: readonly Row[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const { date, type, value } = row;
    const name = typeof row['origin_name'] === 'string' ? row['origin_name'].trim() : '';
    if (typeof date !== 'string' || typeof type !== 'string' || type.endsWith('_per') || typeof value !== 'number' || !Number.isFinite(value)) continue;
    for (const key of [`name:${name}`, `type:${type}`]) {
      const byDate = out.get(key) ?? new Map<string, number>();
      if (!byDate.has(date.slice(0, 10))) byDate.set(date.slice(0, 10), value);
      out.set(key, byDate);
    }
  }
  return out;
}

function pick(found: Map<string, Map<string, number>>, match: Match): Map<string, number> | undefined {
  for (const name of match.names) if (found.has(`name:${name}`)) return found.get(`name:${name}`);
  for (const type of match.types) if (found.has(`type:${type}`)) return found.get(`type:${type}`);
  return undefined;
}

/** The first day of a quarter ending on `end`, and of its year. */
function quarterStart(end: string): string {
  const [year, month] = end.split('-').map(Number) as [number, number];
  return `${year}-${String(month - 2).padStart(2, '0')}-01`;
}

/** A Taiwan company's facts from its three statements and its ex-dividend results, in TWD. */
export function finmindStatements(rows: { income: readonly Row[]; balance: readonly Row[]; cash: readonly Row[]; dividends?: readonly Row[] }): Fact[] {
  const facts: Fact[] = [];
  const income = lines(rows.income);
  const incomeItems = Object.fromEntries(Object.entries(INCOME).map(([item, match]) => [item, pick(income, match as Match)]));
  for (const [item, byDate] of Object.entries(incomeItems)) {
    if (!byDate || item === 'eps') continue;
    for (const [end, value] of byDate) facts.push({ item: item as Item, start: quarterStart(end), end, value });
  }

  const balance = lines(rows.balance);
  for (const [item, match] of Object.entries(BALANCE)) {
    if (item === 'capital') continue;
    for (const [end, value] of pick(balance, match as Match) ?? []) facts.push({ item: item as Item, start: null, end, value });
  }
  const debtLines = DEBT.map((line) => ({ current: line.current, byDate: pick(balance, line) }));
  const debtDates = new Set(debtLines.flatMap((line) => [...(line.byDate?.keys() ?? [])]));
  for (const end of debtDates) {
    const sum = (current?: boolean) => debtLines.filter((line) => current === undefined || line.current === current).reduce((total, line) => total + (line.byDate?.get(end) ?? 0), 0);
    facts.push({ item: 'debt', start: null, end, value: sum() });
    facts.push({ item: 'shortDebt', start: null, end, value: sum(true) });
  }
  // Shares: the quarter's net income over its EPS, else the share capital at NT$10 a share.
  const eps = incomeItems['eps'];
  const capital = pick(balance, BALANCE.capital as Match);
  const ends = new Set([...(incomeItems['netIncome']?.keys() ?? []), ...(capital?.keys() ?? [])]);
  for (const end of ends) {
    const earned = incomeItems['netIncome']?.get(end);
    const perShare = eps?.get(end);
    const fromEps = earned !== undefined && perShare !== undefined && Math.abs(perShare) >= 0.01 ? earned / perShare : undefined;
    const fromCapital = capital?.get(end) !== undefined ? (capital.get(end) as number) / 10 : undefined;
    const shares = fromEps !== undefined && fromEps > 0 ? fromEps : fromCapital;
    if (shares !== undefined && shares > 0) facts.push({ item: 'shares', start: null, end, value: Math.round(shares) });
  }

  const cash = lines(rows.cash);
  const yearStart = (end: string) => `${end.slice(0, 4)}-01-01`;
  for (const [item, match] of Object.entries(CASH)) {
    if (item === 'depreciation' || item === 'amortization') continue;
    for (const [end, value] of pick(cash, match as Match) ?? []) {
      facts.push({ item: item as Item, start: yearStart(end), end, value: item === 'capex' || item === 'dividendsPaid' ? Math.abs(value) : value });
    }
  }
  const depreciation = pick(cash, CASH.depreciation as Match);
  const amortization = pick(cash, CASH.amortization as Match);
  for (const end of new Set([...(depreciation?.keys() ?? []), ...(amortization?.keys() ?? [])])) {
    facts.push({ item: 'da', start: yearStart(end), end, value: (depreciation?.get(end) ?? 0) + (amortization?.get(end) ?? 0) });
  }

  // The cash dividend a share, quarter by quarter over the quarters the income statement covers.
  if (rows.dividends) {
    const byQuarter = new Map<string, number>();
    for (const row of rows.dividends) {
      const day = typeof row['date'] === 'string' ? row['date'].slice(0, 10) : '';
      const amount = row['stock_and_cache_dividend'];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || row['stock_or_cache_dividend'] !== '息' || typeof amount !== 'number' || !(amount > 0)) continue;
      const end = quarterEnd(day);
      byQuarter.set(end, (byQuarter.get(end) ?? 0) + amount);
    }
    for (const end of incomeItems['netIncome']?.keys() ?? []) facts.push({ item: 'dps', start: quarterStart(end), end, value: Math.round((byQuarter.get(end) ?? 0) * 1e4) / 1e4 });
  }
  return facts;
}

/** The last day of the calendar quarter a date falls in. */
function quarterEnd(date: string): string {
  const [year, month] = date.split('-').map(Number) as [number, number];
  const last = Math.ceil(month / 3) * 3;
  return `${year}-${String(last).padStart(2, '0')}-${last === 6 || last === 9 ? '30' : '31'}`;
}
