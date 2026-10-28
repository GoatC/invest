/**
 * UI text in English and Traditional Chinese (CLAUDE.md: all UI text bilingual). Pages show both
 * side by side, the way the PRD is written; every string must come with both languages.
 */
export interface Bilingual {
  en: string;
  zh: string;
}

export function bi(text: Bilingual): string {
  return text.en === text.zh ? text.en : `${text.en} ${text.zh}`;
}

export const LABELS = {
  appName: { en: 'Long-View Invest', zh: '長期投資' },
  holdings: { en: 'Holdings', zh: '持倉' },
  addTrade: { en: 'Add trade', zh: '新增交易' },
  editTrade: { en: 'Edit trade', zh: '修改交易' },
  importCsv: { en: 'Import CSV', zh: '匯入 CSV' },
  addAsset: { en: 'Add non-listed asset', zh: '新增非上市資產' },
  editAsset: { en: 'Edit non-listed asset', zh: '修改非上市資產' },
  addSecurity: { en: 'Add security', zh: '新增證券' },
  editSecurity: { en: 'Edit security', zh: '修改證券' },
  securities: { en: 'Securities', zh: '證券' },
  signIn: { en: 'Sign in', zh: '登入' },
  signOut: { en: 'Sign out', zh: '登出' },
  email: { en: 'Email', zh: '電子郵件' },
  password: { en: 'Password', zh: '密碼' },
  save: { en: 'Save', zh: '儲存' },
  saving: { en: 'Saving…', zh: '儲存中…' },
  cancel: { en: 'Cancel', zh: '取消' },
  delete: { en: 'Delete', zh: '刪除' },
  edit: { en: 'Edit', zh: '修改' },
  tradeDate: { en: 'Trade date', zh: '交易日' },
  market: { en: 'Market', zh: '市場' },
  ticker: { en: 'Ticker', zh: '代號' },
  name: { en: 'Name', zh: '名稱' },
  side: { en: 'Buy / sell', zh: '買賣' },
  qty: { en: 'Quantity', zh: '數量' },
  price: { en: 'Price', zh: '價格' },
  currency: { en: 'Trade currency', zh: '交易幣別' },
  fee: { en: 'Fee', zh: '手續費' },
  tax: { en: 'Tax', zh: '稅' },
  fxRate: { en: 'FX rate (TWD per 1 unit)', zh: '匯率（每 1 單位兌台幣）' },
  sleeve: { en: 'Sleeve', zh: '部位' },
  pool: { en: 'Pool', zh: '資金池' },
  note: { en: 'Note', zh: '備註' },
  source: { en: 'Source', zh: '來源' },
  assetClass: { en: 'Asset class', zh: '資產類別' },
  productType: { en: 'Product type', zh: '產品類別' },
  domicile: { en: 'Domicile (country code)', zh: '註冊地（國家代碼）' },
  unit: { en: 'Unit', zh: '單位' },
  quantityHeld: { en: 'Quantity held', zh: '持有數量' },
  lastValue: { en: 'Last value (TWD)', zh: '最近估值（台幣）' },
  valuedOn: { en: 'Valued on', zh: '估值日期' },
  avgCost: { en: 'Average cost', zh: '平均成本' },
  costTwd: { en: 'Cost (TWD)', zh: '成本（台幣）' },
  valueTwd: { en: 'Market value (TWD)', zh: '市值（台幣）' },
  unrealised: { en: 'Unrealised gain', zh: '未實現損益' },
  weight: { en: 'Weight', zh: '權重' },
  target: { en: 'Target', zh: '目標' },
  actual: { en: 'Actual', zh: '實際' },
  drift: { en: 'Drift', zh: '偏離' },
  history: { en: 'Edit history', zh: '修改紀錄' },
  dataStatus: { en: 'Data status', zh: '資料狀態' },
  performance: { en: 'Performance', zh: '績效' },
  allocation: { en: 'Allocation', zh: '資產配置' },
  risk: { en: 'Value at Risk', zh: '風險值' },
  calculator: { en: 'Calculator', zh: '複利計算機' },
  costs: { en: 'Costs & tax', zh: '費用與稅務' },
  windfall: { en: 'Windfall', zh: '大額資金' },
  regression: { en: 'Regression', zh: '回歸分析' },
  costOfEquity: { en: 'Cost of equity', zh: '權益成本' },
  proposals: { en: 'Proposals', zh: '提案' },
  rules: { en: 'Rules', zh: '規則' },
  notifications: { en: 'Notifications', zh: '推播' },
  dashboard: { en: 'Dashboard', zh: '儀表板' },
  cashFlows: { en: 'Cash flows', zh: '現金流' },
  addCashFlow: { en: 'Add cash flow', zh: '新增現金流' },
  editCashFlow: { en: 'Edit cash flow', zh: '修改現金流' },
  flowDate: { en: 'Date', zh: '日期' },
  flowType: { en: 'Type', zh: '類型' },
  amount: { en: 'Amount', zh: '金額' },
  flowCurrency: { en: 'Currency', zh: '幣別' },
  amountTwd: { en: 'Amount (TWD)', zh: '金額（台幣）' },
} as const satisfies Record<string, Bilingual>;

export const SIDE = {
  buy: { en: 'Buy', zh: '買進' },
  sell: { en: 'Sell', zh: '賣出' },
} as const satisfies Record<string, Bilingual>;

export const POOL = {
  regular: { en: 'Regular', zh: '一般' },
  windfall: { en: 'Windfall', zh: '大額資金' },
  regression: { en: 'Regression', zh: '回歸分析' },
} as const satisfies Record<string, Bilingual>;

export const SLEEVE = {
  core: { en: 'Core', zh: '核心' },
  satellite: { en: 'Satellite', zh: '衛星' },
} as const satisfies Record<string, Bilingual>;

export const MARKET = {
  US: { en: 'US', zh: '美國' },
  TW: { en: 'Taiwan', zh: '台灣' },
  UK: { en: 'UK (London)', zh: '英國（倫敦）' },
} as const satisfies Record<string, Bilingual>;

export const PRODUCT = {
  equity_etf: { en: 'Equity ETF', zh: '股票 ETF' },
  bond_etf: { en: 'Bond ETF', zh: '債券 ETF' },
  gold: { en: 'Gold', zh: '黃金' },
  cash_mmf: { en: 'Cash & money-market', zh: '現金與貨幣基金' },
  stock: { en: 'Individual stock', zh: '個股' },
  theme_etf: { en: 'Theme ETF', zh: '主題 ETF' },
} as const satisfies Record<string, Bilingual>;

export const SOURCE = {
  manual: { en: 'Manual', zh: '手動' },
  csv: { en: 'CSV import', zh: 'CSV 匯入' },
} as const satisfies Record<string, Bilingual>;

/** Money in and out of the portfolio (cash_flows.type); the amount is always positive. */
export const FLOW_TYPE = {
  contribution: { en: 'Contribution', zh: '投入資金' },
  windfall: { en: 'Windfall arrives', zh: '大額資金入帳' },
  dividend: { en: 'Dividend', zh: '股利' },
  withdrawal: { en: 'Withdrawal', zh: '提領' },
} as const satisfies Record<string, Bilingual>;

/** The feeds the nightly job loads from (prices.source, fx_rates.source). */
export const FEED: Record<string, Bilingual> = {
  finmind: { en: 'FinMind', zh: 'FinMind' },
  twse: { en: 'TWSE', zh: '證交所' },
  ishares_nav: { en: 'iShares NAV', zh: 'iShares 淨值' },
  alphavantage: { en: 'Alpha Vantage', zh: 'Alpha Vantage' },
  fred: { en: 'FRED', zh: 'FRED' },
  shiller: { en: "Shiller's data", zh: 'Shiller 的資料' },
  multpl: { en: 'multpl.com', zh: 'multpl.com' },
  treasury: { en: 'US Treasury', zh: '美國財政部' },
  cbc: { en: 'Central Bank of the ROC', zh: '中央銀行' },
  damodaran: { en: 'Damodaran Online', zh: 'Damodaran Online' },
  demo: { en: 'Demo data', zh: '示範資料' },
};

/** A windfall tranche's status (F3). */
export const TRANCHE_STATUS: Record<string, Bilingual> = {
  scheduled: { en: 'Scheduled', zh: '排定' },
  accelerated: { en: 'Pulled forward', zh: '已提前投入' },
  done: { en: 'Done', zh: '已完成' },
};

export function feedLabel(source: string): Bilingual {
  return FEED[source] ?? { en: source, zh: source };
}

/** The series of the performance charts and tables (F18). */
export const RETURN_SERIES = {
  portfolio: { en: 'Portfolio (TWR)', zh: '組合（時間加權）' },
  benchmark: { en: 'SAA benchmark', zh: 'SAA 基準' },
  local: { en: 'Local currency', zh: '當地幣別' },
  currency: { en: 'Currency', zh: '匯率' },
  cross: { en: 'Cross term', zh: '交叉項' },
  total: { en: 'TWD return', zh: '台幣報酬' },
} as const satisfies Record<string, Bilingual>;

/** The series of the compounding calculator's charts and tables (F2). */
export const PLAN_SERIES = {
  growth: { en: 'Growth', zh: '累計成長' },
  contributed: { en: 'Put in', zh: '累計投入' },
  real: { en: "Value in today's money", zh: '換算今天的幣值' },
  value: { en: 'Value', zh: '資產價值' },
  actual: { en: 'Actual', zh: '實際' },
  planned: { en: 'Plan', zh: '計畫' },
} as const satisfies Record<string, Bilingual>;

/** The N6 lenses. */
export const LENS = {
  product: { en: 'Product type', zh: '產品類別' },
  country: { en: 'Listing country', zh: '上市國家' },
  sleeve: { en: 'Active vs passive', zh: '主動與被動' },
} as const satisfies Record<string, Bilingual>;

/** The slices of every N6 lens, by key. */
export const SLICE: Record<string, Bilingual> = {
  equity_etf: { en: 'Equity ETF', zh: '股票 ETF' },
  bond_etf: { en: 'Bond ETF', zh: '債券 ETF' },
  gold: { en: 'Gold (ETF and physical)', zh: '黃金（ETF 與實體）' },
  cash_mmf: { en: 'Cash & money-market', zh: '現金與貨幣基金' },
  stock: { en: 'Individual stocks', zh: '個股' },
  theme_etf: { en: 'Theme ETF', zh: '主題 ETF' },
  US: { en: 'US', zh: '美國' },
  UK: { en: 'UK (London)', zh: '英國（倫敦）' },
  TW: { en: 'Taiwan', zh: '台灣' },
  unlisted: { en: 'Not listed', zh: '非上市' },
  core: { en: 'Passive core', zh: '被動核心' },
  satellite: { en: 'Active satellite', zh: '主動衛星' },
};

/** F6 drift status, always shown with its icon. */
export const DRIFT_STATUS = {
  ok: { en: 'On target', zh: '符合目標' },
  watch: { en: 'Watch', zh: '留意' },
  rebalance: { en: 'Rebalance', zh: '需再平衡' },
  unchecked: { en: 'Left to R2', zh: '由 R2 管理' },
} as const satisfies Record<string, Bilingual>;

export const DRIFT_ICON = { ok: '✓', watch: '!', rebalance: '✕', unchecked: '–' } as const;

export const RUN_STATUS = {
  ok: { en: 'OK', zh: '正常' },
  partial: { en: 'Partly loaded', zh: '部分載入' },
  failed: { en: 'Failed', zh: '失敗' },
} as const satisfies Record<string, Bilingual>;
