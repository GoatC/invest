/**
 * Phase 3, step 3 (F10): builds the stress test's scenario data from free sources and prints the
 * config value's `scenarios` as JSON, for the migration that carries it.
 *
 *   npx tsx scripts/build_stress_scenarios.ts > scenarios.json
 *
 * Series (each in TWD, month-end to month-end, dividends reinvested where the source adjusts):
 *   us_equity  SPY   FinMind USStockPrice Adj_Close × USD/TWD
 *   tw_equity  TAIEX FinMind TaiwanStockTotalReturnIndex
 *   bonds      AGG   FinMind USStockPrice Adj_Close × USD/TWD
 *   gold       GLD   FinMind USStockPrice Adj_Close × USD/TWD
 *   cash       BIL   FinMind USStockPrice Adj_Close × USD/TWD
 *   USD/TWD          FRED DEXTAUS, the last rate of the month
 * No key is needed at this volume (a few requests); FINMIND_TOKEN is used when set.
 */
import { monthEnds, monthlyReturns, type Close } from './lib/stress-scenarios.ts';

const WINDOWS = [
  { id: 'gfc_2008', from: '2007-10', months: 39, name_en: '2008 global financial crisis', name_zh: '2008 金融海嘯' },
  { id: 'covid_2020', from: '2020-01', months: 15, name_en: '2020 COVID crash', name_zh: '2020 新冠崩盤' },
  { id: 'rates_2022', from: '2022-01', months: 24, name_en: '2022 rate shock', name_zh: '2022 升息衝擊' },
] as const;

const TOKEN = (process.env['FINMIND_TOKEN'] ?? '').trim();

/** A GET that tries three times: FRED answers 503 now and then. */
async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'long-view-invest scenario builder (github.com/GoatC/Invest)', ...headers }, signal: AbortSignal.timeout(60_000) });
    if (res.ok || attempt === 3 || res.status < 500) {
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.split('?')[0]}`);
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

async function json(url: string): Promise<unknown> {
  return (await get(url, TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})).json();
}

async function finmind(dataset: string, id: string, field: string): Promise<Close[]> {
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=${dataset}&data_id=${id}&start_date=2007-08-01&end_date=2023-12-31`;
  const body = (await json(url)) as { status?: number; msg?: string; data?: Array<Record<string, unknown>> };
  if (body.status !== 200 || !body.data) throw new Error(`FinMind ${id}: ${body.msg ?? 'no data'}`);
  return body.data.flatMap((row) => (typeof row['date'] === 'string' && typeof row[field] === 'number' ? [{ date: row['date'], close: row[field] as number }] : []));
}

async function usdTwd(): Promise<Map<string, number>> {
  const res = await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXTAUS&cosd=2007-08-01&coed=2023-12-31');
  const rows: Close[] = (await res.text())
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const [date = '', value = ''] = line.trim().split(',');
      const rate = Number(value);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && value !== '' && rate > 0 ? [{ date, close: rate }] : [];
    });
  return monthEnds(rows);
}

async function main(): Promise<void> {
  const [spy, agg, gld, bil, taiex, rates] = await Promise.all([
    finmind('USStockPrice', 'SPY', 'Adj_Close'),
    finmind('USStockPrice', 'AGG', 'Adj_Close'),
    finmind('USStockPrice', 'GLD', 'Adj_Close'),
    finmind('USStockPrice', 'BIL', 'Adj_Close'),
    finmind('TaiwanStockTotalReturnIndex', 'TAIEX', 'price'),
    usdTwd(),
  ]);
  const scenarios = WINDOWS.map((window) => ({
    id: window.id,
    name_en: window.name_en,
    name_zh: window.name_zh,
    from: window.from,
    returns: {
      us_equity: monthlyReturns(monthEnds(spy), rates, window.from, window.months),
      tw_equity: monthlyReturns(monthEnds(taiex), null, window.from, window.months),
      bonds: monthlyReturns(monthEnds(agg), rates, window.from, window.months),
      gold: monthlyReturns(monthEnds(gld), rates, window.from, window.months),
      cash: monthlyReturns(monthEnds(bil), rates, window.from, window.months),
    },
  }));
  console.log(JSON.stringify(scenarios));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
