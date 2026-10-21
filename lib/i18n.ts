/**
 * UI text in English and Traditional Chinese (CLAUDE.md: all UI text bilingual). Pages show both
 * side by side, the way the PRD is written; every string must come with both languages.
 */
export interface Bilingual {
  en: string;
  zh: string;
}

export function bi(text: Bilingual): string {
  return `${text.en} ${text.zh}`;
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
} as const satisfies Record<string, Bilingual>;

export const SIDE = {
  buy: { en: 'Buy', zh: '買進' },
  sell: { en: 'Sell', zh: '賣出' },
} as const satisfies Record<string, Bilingual>;

export const POOL = {
  regular: { en: 'Regular', zh: '一般' },
  windfall: { en: 'Windfall', zh: '大額資金' },
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
