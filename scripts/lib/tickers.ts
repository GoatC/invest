import type { TickerSpec } from './types.ts';

/** Vehicles named in the PRD Investment Principles table, plus the proxies and examples the models need. */
export const TICKERS: readonly TickerSpec[] = [
  { id: 'VOO', label: 'VOO', market: 'US', kind: 'etf', group: 'principles', role: 'Core · US / global equity 美股／全球大盤 28%' },
  { id: 'VT', label: 'VT', market: 'US', kind: 'etf', group: 'principles', role: 'Core · US / global equity 美股／全球大盤 28%' },
  { id: '00692', label: '00692', market: 'TW', kind: 'etf', group: 'principles', role: 'Core · Taiwan market-cap equity 台股市值型 12%' },
  { id: '009816', label: '009816', market: 'TW', kind: 'etf', group: 'principles', role: 'Core · Taiwan market-cap equity 台股市值型 12%' },
  { id: '00922', label: '00922', market: 'TW', kind: 'etf', group: 'principles', role: 'Core · Taiwan market-cap equity 台股市值型 12%' },
  { id: 'BNDW', label: 'BNDW', market: 'US', kind: 'etf', group: 'principles', role: 'Core · Global bonds 全球債券 22%' },
  {
    id: 'AGGU',
    label: 'AGGU (LSE)',
    market: 'UK',
    kind: 'etf',
    group: 'principles',
    role: 'Core · Global bonds 全球債券 22%',
    symbols: { alphaVantage: 'AGGU.LON', fmp: 'AGGU.L' },
  },
  { id: 'GLDM', label: 'GLDM', market: 'US', kind: 'etf', group: 'principles', role: 'Core · Real assets 實體資產 10%' },
  { id: 'GOLD', label: 'Physical gold 實體黃金', market: 'unlisted', kind: 'other', group: 'principles', role: 'Core · Real assets 實體資產 10%' },
  { id: 'BIL', label: 'BIL', market: 'US', kind: 'etf', group: 'principles', role: 'Core · Strategic cash 戰略現金 8%' },
  { id: 'MMF', label: 'MMF 貨幣基金', market: 'unlisted', kind: 'other', group: 'principles', role: 'Core · Strategic cash 戰略現金 8%' },
  { id: 'SAVINGS', label: 'High-yield savings 高利活存', market: 'unlisted', kind: 'other', group: 'principles', role: 'Core · Strategic cash 戰略現金 8%' },
  { id: '0050', label: '0050', market: 'TW', kind: 'etf', group: 'supporting', role: 'N4 VaR proxy for both Taiwan classes 台股類別的風險值代理' },
  { id: 'ACWI', label: 'ACWI', market: 'US', kind: 'etf', group: 'supporting', role: 'F3 drawdown gauge: candidate free proxy for MSCI ACWI 指數代理候選' },
  { id: 'AAPL', label: 'AAPL', market: 'US', kind: 'stock', group: 'supporting', role: 'Satellite stand-in (PRD N1 example) 衛星個股範例' },
  { id: '2330', label: '2330', market: 'TW', kind: 'stock', group: 'supporting', role: 'Satellite stand-in (PRD N1 example) 衛星個股範例' },
];

export const SATELLITE_NOTE =
  'The satellite sleeves name no tickers yet (US 2–3 names, Taiwan 1–2 names, tactical themes), so AAPL and 2330, the PRD N1 examples, stand in for single stocks. ' +
  '衛星部位尚未指定個股，暫以 PRD N1 的範例 AAPL 與 2330 代表。';

export const UNLISTED_NOTE =
  'MMF and high-yield savings are entered as balances on the N5 page and need no market feed; physical gold is valued with the Bank of Taiwan gold price. ' +
  '貨幣基金與高利活存在 N5 以餘額登錄，不需要行情資料；實體黃金以臺灣銀行金價估值。';

export function tickerById(id: string): TickerSpec {
  const ticker = TICKERS.find((t) => t.id === id);
  if (!ticker) throw new Error(`Unknown ticker id: ${id}`);
  return ticker;
}

export function symbolFor(ticker: TickerSpec, source: 'alphaVantage' | 'fmp'): string {
  return ticker.symbols?.[source] ?? ticker.id;
}
