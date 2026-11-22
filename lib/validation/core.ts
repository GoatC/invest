/**
 * Form parsing shared by the browser (instant feedback) and the server actions (the authority:
 * the server never trusts what the browser sends). Every error message is bilingual. Each feature's
 * parser lives in its own module beside this one; the helpers several of them use live here.
 */
import { isIsoDate } from '../dates';
import type { Bilingual } from '../i18n';
import { MAX_GOALS } from '../models/timeline';

export type RawForm = Record<string, string | undefined>;

export type FieldErrors<K extends string> = Partial<Record<K, Bilingual>>;

export type Parsed<T, K extends string> = { ok: true; value: T } | { ok: false; errors: FieldErrors<K> };

export const MESSAGES = {
  required: { en: 'Required.', zh: '必填。' },
  date: { en: 'Enter a date as YYYY-MM-DD.', zh: '請以 YYYY-MM-DD 格式輸入日期。' },
  future: { en: 'The date cannot be in the future.', zh: '日期不能晚於今天。' },
  positive: { en: 'Enter a number above 0.', zh: '請輸入大於 0 的數字。' },
  nonNegative: { en: 'Enter 0 or more.', zh: '請輸入 0 或以上的數字。' },
  unknownTicker: { en: 'Unknown ticker: add it as a security first.', zh: '找不到這個代號，請先新增證券。' },
  tickerFormat: { en: 'Use capital letters, digits, "." or "-", up to 12 characters.', zh: '請用大寫英文字母、數字、「.」或「-」，最多 12 個字元。' },
  tickerTaken: { en: 'This ticker already exists.', zh: '這個代號已存在。' },
  currency: { en: 'Use a three-letter code such as USD.', zh: '請輸入三個字母的幣別代碼，例如 USD。' },
  country: { en: 'Use a two-letter country code such as US or IE.', zh: '請輸入兩個字母的國家代碼，例如 US 或 IE。' },
  choice: { en: 'Pick one of the options.', zh: '請從選項中選擇。' },
  tooLong: { en: 'Too long.', zh: '太長了。' },
  dividendTicker: { en: 'Name the security that paid the dividend.', zh: '請填寫發放股利的證券代號。' },
  percent: { en: 'Enter a percentage from 0 to 100, with at most two decimals.', zh: '請輸入 0 到 100 的百分比，最多兩位小數。' },
  expectedReturn: { en: 'Enter a yearly return from −50% to 50%.', zh: '請輸入 −50% 到 50% 之間的年報酬。' },
  volatility: { en: 'Enter a yearly volatility from 0% to 100%.', zh: '請輸入 0% 到 100% 之間的年化波動度。' },
  source: { en: 'Say where the assumption comes from.', zh: '請註明假設的來源。' },
  month: { en: 'Enter a month as YYYY-MM.', zh: '請以 YYYY-MM 格式輸入月份。' },
  stepUp: { en: 'Enter a yearly step-up from 0% to 30%, with at most two decimals.', zh: '請輸入 0% 到 30% 之間的每年調升比例，最多兩位小數。' },
  inflation: { en: 'Enter a yearly inflation from −5% to 20%, with at most two decimals.', zh: '請輸入 −5% 到 20% 之間的年通膨率，最多兩位小數。' },
  years: { en: 'Enter a whole number of years from 1 to 60.', zh: '請輸入 1 到 60 之間的整數年數。' },
  fraction: { en: 'Enter a number between 0 and 1, e.g. 0.05 for 5%.', zh: '請輸入 0 到 1 之間的數字，例如 5% 填 0.05。' },
  wholeNumber: { en: 'Enter a whole number, 0 or more.', zh: '請輸入 0 或以上的整數。' },
  cooldown: { en: 'Enter whole days from 0 to 365.', zh: '請輸入 0 到 365 的整數天數。' },
  dcaDay: { en: 'Enter a day of the month from 1 to 31, or leave it blank.', zh: '請輸入 1 到 31 的日期，或留白。' },
  expiryDays: { en: 'Enter whole days from 1 to 365.', zh: '請輸入 1 到 365 的整數天數。' },
  shareDecimals: { en: 'Enter 1 to 4 decimals.', zh: '請輸入 1 到 4 位小數。' },
  clock: { en: 'Enter a time as HH:MM, 24-hour, e.g. 23:00.', zh: '請以 24 小時制 HH:MM 輸入時間，例如 23:00。' },
  leverage: { en: 'Pick a leverage from the list: 1.0× and up in steps of 0.1×.', zh: '請從清單選擇槓桿：1.0 倍起，以 0.1 倍為級距。' },
  quietSame: { en: 'The quiet hours cannot start and end at the same time.', zh: '安靜時段的開始與結束時間不能相同。' },
  weekday: { en: 'Pick a day of the week.', zh: '請選擇星期幾。' },
  rate: { en: 'Enter a percentage from 0 to 100, with at most four decimals, e.g. 0.1425.', zh: '請輸入 0 到 100 的百分比，最多四位小數，例如 0.1425。' },
  discount: { en: 'Enter the discount in 折, above 0 up to 10 (10 is no discount), e.g. 2.8.', zh: '請以折數輸入折扣，大於 0、最多 10（10 為不打折），例如 2.8。' },
  usd: { en: 'Enter US$ 0 or more, with at most two decimals.', zh: '請輸入 0 或以上的美元金額，最多兩位小數。' },
  wholeTwdAmount: { en: 'Enter whole NT$, 0 or more.', zh: '請輸入 0 或以上的整數台幣金額。' },
  rateRange: { en: 'The highest rate must not be below the lowest.', zh: '最高稅率不能低於最低稅率。' },
  brokerId: { en: 'Use lowercase letters, digits or "_", up to 20 characters.', zh: '請用小寫英文字母、數字或「_」，最多 20 個字元。' },
  idTaken: { en: 'This id is already used.', zh: '這個代號已經使用過。' },
  trackingDifference: { en: 'Enter a percentage from −10 to 10, with at most four decimals.', zh: '請輸入 −10 到 10 的百分比，最多四位小數。' },
  positiveWholeTwd: { en: 'Enter whole NT$ above 0.', zh: '請輸入大於 0 的整數台幣金額。' },
  cashReturn: { en: 'Enter a yearly return from −10% to 20%.', zh: '請輸入 −10% 到 20% 的年報酬。' },
  riskFree: { en: 'Enter a yearly rate from −5% to 30%.', zh: '請輸入 −5% 到 30% 的年利率。' },
  blume: { en: 'Enter a weight from 0 to 1.', zh: '請輸入 0 到 1 之間的權重。' },
  premium: { en: 'Enter a premium from 0% to 20% a year.', zh: '請輸入每年 0% 到 20% 的溢酬。' },
  fromYear: { en: 'Enter a year from 1871 on.', zh: '請輸入 1871 年以後的年份。' },
  horizonMonths: { en: 'Enter whole months from 12 to 240.', zh: '請輸入 12 到 240 的整數月數。' },
  percentile: { en: 'Enter a percentile from 0 to 100.', zh: '請輸入 0 到 100 的百分位。' },
  trancheCount: { en: 'Enter a whole number of tranches from 1 to 120.', zh: '請輸入 1 到 120 的整數批數。' },
  share: { en: 'Enter a percentage above 0, up to 100.', zh: '請輸入大於 0、最多 100 的百分比。' },
  drawdown: { en: 'Enter a fall in percent, above 0 and up to 99.', zh: '請輸入大於 0、最多 99 的跌幅百分比。' },
  ascending: { en: 'Must be above the one before it.', zh: '必須大於前一個數值。' },
  growth: { en: 'Enter a yearly growth from −20% to 40%.', zh: '請輸入 −20% 到 40% 之間的年成長率。' },
  terminal: { en: 'Enter a terminal growth from −2% to 6%.', zh: '請輸入 −2% 到 6% 之間的永續成長率。' },
  scenarioOrder: { en: 'Bear ≤ base ≤ bull.', zh: '悲觀 ≤ 基本 ≤ 樂觀。' },
  forecastYears: { en: 'Enter whole years from 1 to 20.', zh: '請輸入 1 到 20 的整數年數。' },
  millions: { en: 'Enter a number in millions, or leave it blank.', zh: '請輸入以百萬為單位的數字，或留白。' },
  positiveMillions: { en: 'Enter a number in millions above 0, or leave it blank.', zh: '請輸入大於 0 的百萬單位數字，或留白。' },
  optionalRate: { en: 'Enter a percentage from 0 to 60, or leave it blank.', zh: '請輸入 0 到 60 的百分比，或留白。' },
  peers: { en: 'List up to 8 single stocks, by ticker, separated by commas; each a security already.', zh: '請以逗號分隔最多 8 檔個股代號，且都已是證券。' },
  buyMultiple: { en: 'Enter a multiple between 0 and 1, e.g. 0.75, or leave it blank.', zh: '請輸入 0 到 1 之間的倍數，例如 0.75，或留白。' },
  trimMultiple: { en: 'Enter a multiple above 1, e.g. 1.25, or leave it blank.', zh: '請輸入大於 1 的倍數，例如 1.25，或留白。' },
  quarters: { en: 'Enter whole quarters from 1 to 40.', zh: '請輸入 1 到 40 的整數季數。' },
  historyYears: { en: 'Enter whole years from 1 to 10.', zh: '請輸入 1 到 10 的整數年數。' },
  scanDays: { en: 'Enter whole days from 1 to 90.', zh: '請輸入 1 到 90 的整數天數。' },
  score: { en: 'Enter a score, e.g. −1.78 or 2.99.', zh: '請輸入分數，例如 −1.78 或 2.99。' },
  industryCodes: { en: 'List two-digit TWSE industry codes, e.g. 24, 28.', zh: '請列出兩位數的證交所產業別代碼，例如 24、28。' },
  topCompanies: { en: 'Enter a whole number from 5 to 100.', zh: '請輸入 5 到 100 的整數。' },
  codeSectors: { en: 'One per line: a TWSE industry code, "=", a GICS sector, e.g. 24 = Information Technology.', zh: '每行一個：證交所產業別代碼、「=」、GICS 產業，例如 24 = 資訊科技。' },
  indexSectors: { en: 'One per line: an industry index already listed, "=", a GICS sector, e.g. Electronic = Information Technology.', zh: '每行一個：清單中的類股指數、「=」、GICS 產業，例如 Electronic = 資訊科技。' },
  mcTarget: { en: 'Enter whole NT$ above 0 (in today’s money), or leave it blank.', zh: '請輸入大於 0 的整數台幣金額（以今天幣值計），或留白。' },
  mcWindfallMonth: { en: 'Enter the month the money arrives as YYYY-MM.', zh: '請以 YYYY-MM 輸入入帳月份。' },
  mcWindfallAmount: { en: 'Enter whole NT$ above 0, or leave it blank.', zh: '請輸入大於 0 的整數台幣金額，或留白。' },
  goals: { en: 'One per line: month | amount in today’s money (blank for none) | name, e.g. 2045-06 | 3,000,000 | House.', zh: '每行一個：月份 | 以今天幣值計的金額（留白代表沒有）| 名稱，例如 2045-06 | 3,000,000 | 購屋頭期款。' },
  goalCount: { en: `At most ${MAX_GOALS} goals.`, zh: `最多 ${MAX_GOALS} 個目標。` },
  frontierBounds: { en: 'One per line: an asset class id, "=", the minimum and maximum in percent, e.g. us_global_equity = 0 - 50; the minimums must not exceed 100% nor the maximums fall short of it.', zh: '每行一個：資產類別代號、「=」、最小與最大百分比，例如 us_global_equity = 0 - 50；最小值合計不得超過 100%，最大值合計不得低於 100%。' },
  frontierYears: { en: 'Enter whole years from 1 to 30.', zh: '請輸入 1 到 30 的整數年數。' },
  autoYears: { en: 'Enter whole years from 1 to 20.', zh: '請輸入 1 到 20 的整數年數。' },
  autoMonths: { en: 'Enter whole months from 12 up to the years × 12.', zh: '請輸入 12 到「年數 × 12」之間的整數月數。' },
  fundCountries: { en: 'One per line: a ticker, "=", a two-letter country code, e.g. BIL = US.', zh: '每行一個：代號、「=」、兩個字母的國家代碼，例如 BIL = US。' },
} as const satisfies Record<string, Bilingual>;

/** "1,234.5" → 1234.5; empty or not a number → undefined. */
export function parseNumber(raw: string | undefined): number | undefined {
  const text = (raw ?? '').replace(/[,\s]/g, '');
  if (text === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** An optional amount: empty means 0. */
export function optionalAmount(raw: string | undefined): number | undefined {
  return (raw ?? '').trim() === '' ? 0 : parseNumber(raw);
}

export function text(raw: string | undefined): string {
  return (raw ?? '').trim();
}

export function oneOf<T extends string>(raw: string | undefined, options: readonly T[]): T | undefined {
  return options.find((option) => option === raw);
}

export function finish<T, K extends string>(errors: FieldErrors<K>, value: () => T): Parsed<T, K> {
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: value() };
}

/** "12.5" (percent) → 0.125; at most two decimals of a percent. */
export function percentField(raw: string | undefined, min: number, max: number): number | undefined {
  const value = parseNumber(raw);
  if (value === undefined || value < min || value > max || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return undefined;
  return Math.round(value * 100) / 10_000;
}

/** "0.1425" (percent) → 0.001425, from min to max, at most four decimals of a percent. */
export function ratePercent(raw: string | undefined, min = 0, max = 100): number | undefined {
  const value = parseNumber(raw);
  if (value === undefined || value < min || value > max || Math.abs(Math.round(value * 10_000) - value * 10_000) > 1e-6) return undefined;
  return Math.round(value * 10_000) / 1_000_000;
}

/** The date a form's entry was checked before, carried by a hidden field; only a real date counts. */
export function previouslyChecked(raw: RawForm): string | null {
  const value = text(raw['checkedOn']);
  return isIsoDate(value) ? value : null;
}

/** An optional percent: blank is null. */
export function optionalRate(raw: string | undefined, min = 0, max = 100): number | null | undefined {
  return text(raw) === '' ? null : ratePercent(raw, min, max);
}

export function wholeTwd(raw: string | undefined): number | undefined {
  const value = parseNumber(raw);
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function wholeIn(raw: string | undefined, min: number, max: number): number | undefined {
  const value = parseNumber(raw);
  return value !== undefined && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}
