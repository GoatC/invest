/** The nightly job's database side: reads and upserts through the Data API with the secret key. */
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadFilingTickers, loadLookThroughPlan, loadSectorSettings, loadPerformanceInput, loadRedFlagCompanies, loadRiskInput, profileColumns, refreshBetas, refreshAttribution, refreshMonteCarlo, revalueOnFilings, runRules, scanRedFlags } from '../../../lib/data.ts';
import { readFactorSettings } from '../../../lib/models/five-factor.ts';
import { readFrontierSettings } from '../../../lib/models/frontier.ts';
import { readMcSettings } from '../../../lib/models/monte-carlo.ts';
import { readRegressionSettings } from '../../../lib/models/regression.ts';
import type { Snapshot } from '../../../lib/models/performance.ts';
import { candidateProxies } from '../../../lib/models/risk.ts';
import type { ProductType } from '../../../lib/models/types.ts';
import type { IndexClose } from '../feeds/indices.ts';
import type { FeedEvent } from '../feeds/redflags.ts';
import type { DailyPrice, DailyRate, MonthlyPoint } from '../feeds/types.ts';
import { packConstituent } from '../../../lib/models/look-through.ts';
import type { FundamentalRow, FundFileRow, JobRun, Security, Store } from './job.ts';

/** Rows per upsert request; a full history is a few thousand rows. */
const BATCH = 500;

function batches<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < rows.length; at += BATCH) out.push(rows.slice(at, at + BATCH));
  return out;
}

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function supabaseStore(client: SupabaseClient): Store {
  return {
    async securities() {
      const { data, error } = await client.from('securities').select('ticker, market, currency').order('ticker');
      check('securities', error);
      return (data ?? []) as Security[];
    },
    async earliestTradeDate() {
      const { data, error } = await client.from('transactions').select('trade_date').order('trade_date').limit(1);
      check('transactions', error);
      return (data?.[0] as { trade_date?: string } | undefined)?.trade_date;
    },
    async lookbackYears() {
      const { data, error } = await client.from('config').select('value').eq('key', 'var');
      check('config', error);
      const value = (data?.[0] as { value?: Record<string, unknown> } | undefined)?.value;
      const years = value?.['lookback_years'];
      if (typeof years !== 'number' || years <= 0) throw new Error('config var.lookback_years is missing or not a positive number');
      return years;
    },
    async riskProxies() {
      const [classes, securities] = await Promise.all([
        client.from('asset_classes').select('id, benchmark_ticker'),
        client.from('securities').select('ticker, product_type, currency'),
      ]);
      check('asset_classes', classes.error);
      check('securities', securities.error);
      const benchmarks = new Map(((classes.data ?? []) as Array<{ id: string; benchmark_ticker: string | null }>).map((row) => [row.id, row.benchmark_ticker]));
      const rows = (securities.data ?? []) as Array<{ ticker: string; product_type: ProductType; currency: string }>;
      return [...candidateProxies(benchmarks, rows.map((row) => ({ ticker: row.ticker, productType: row.product_type, currency: row.currency }))).keys()];
    },
    async earliestPriceDate(ticker) {
      const { data, error } = await client.from('prices').select('price_date').eq('ticker', ticker).order('price_date').limit(1);
      check('prices', error);
      return (data?.[0] as { price_date?: string } | undefined)?.price_date;
    },
    async savePrices(rows: readonly DailyPrice[], options: { fillOnly?: boolean } = {}) {
      for (const batch of batches(rows)) {
        const { error } = await client.from('prices').upsert(
          batch.map((row) => ({ ticker: row.ticker, price_date: row.date, close: row.close, adj_close: row.adjClose, source: row.source })),
          { onConflict: 'ticker,price_date', ignoreDuplicates: options.fillOnly ?? false },
        );
        check('prices', error);
      }
    },
    async saveRates(rows: readonly DailyRate[]) {
      for (const batch of batches(rows)) {
        const { error } = await client
          .from('fx_rates')
          .upsert(batch.map((row) => ({ pair: row.pair, rate_date: row.date, rate: row.rate, source: row.source })), { onConflict: 'pair,rate_date' });
        check('fx_rates', error);
      }
    },
    async saveSeries(rows: readonly MonthlyPoint[]) {
      for (const batch of batches(rows)) {
        const { error } = await client
          .from('market_series')
          .upsert(batch.map((row) => ({ series: row.series, obs_month: `${row.month}-01`, value: row.value, source: row.source })), { onConflict: 'series,obs_month' });
        check('market_series', error);
      }
    },
    async factorYears() {
      const { data, error } = await client.from('config').select('value').eq('key', 'factors');
      check('config', error);
      const settings = readFactorSettings((data?.[0] as { value?: unknown } | undefined)?.value);
      return settings?.keepYears;
    },
    async historyYears() {
      const { data, error } = await client.from('config').select('key, value').in('key', ['monte_carlo', 'frontier']);
      check('config', error);
      const found = (data ?? []) as Array<{ key: string; value: unknown }>;
      const years = found.flatMap((row) => {
        const settings = row.key === 'monte_carlo' ? readMcSettings(row.value) : readFrontierSettings(row.value);
        return settings ? [settings.lookbackYears] : [];
      });
      return years.length > 0 ? Math.max(...years) + 1 : undefined;
    },
    async regressionYears() {
      const { data, error } = await client.from('config').select('value').eq('key', 'regression');
      check('config', error);
      const row = data?.[0] as { value?: unknown } | undefined;
      if (!row) return undefined;
      const settings = readRegressionSettings(row.value);
      if (!settings) throw new Error('config regression is malformed');
      return Math.max(...settings.windows) + 1;
    },
    async capmReady() {
      const { data, error } = await client.from('config').select('key').eq('key', 'capm');
      check('config', error);
      return (data ?? []).length > 0;
    },
    async saveIndexPrices(rows: readonly IndexClose[], options: { fillOnly?: boolean } = {}) {
      for (const batch of batches(rows)) {
        const { error } = await client
          .from('index_prices')
          .upsert(batch.map((row) => ({ index_id: row.index, price_date: row.date, close: row.close, source: row.source })), { onConflict: 'index_id,price_date', ignoreDuplicates: options.fillOnly ?? false });
        check('index_prices', error);
      }
    },
    async filingTickers() {
      const { data, error } = await client.from('config').select('key').eq('key', 'valuation');
      check('config', error);
      return (data ?? []).length > 0 ? loadFilingTickers(client) : undefined;
    },
    async saveFundamentals(rows: readonly FundamentalRow[]) {
      for (const batch of batches(rows)) {
        const { error } = await client.from('fundamentals').upsert(
          batch.map((row) => ({ ticker: row.ticker, period_end: row.periodEnd, figures: row.figures, currency: row.currency, filed_on: row.filed, source: row.source })),
          { onConflict: 'ticker,period_end' },
        );
        check('fundamentals', error);
      }
    },
    redFlagCompanies: (today) => loadRedFlagCompanies(client, today),
    async saveProfiles(rows) {
      const { error } = await client.from('company_profiles').upsert(rows.map(profileColumns), { onConflict: 'ticker' });
      check('company_profiles', error);
    },
    async saveFlagEvents(rows: readonly FeedEvent[]) {
      for (const batch of batches(rows)) {
        const { error } = await client.from('red_flag_events').upsert(
          batch.map((row) => ({ ticker: row.ticker, indicator: row.indicator, event_date: row.date, source: row.source, ref: row.ref, title: row.title, url: row.url, value: row.value })),
          { onConflict: 'ticker,indicator,source,ref', ignoreDuplicates: true },
        );
        check('red_flag_events', error);
      }
    },
    scanRedFlags: (today, tickers) => scanRedFlags(client, today, tickers),
    lookThroughPlan: (today) => loadLookThroughPlan(client, today),
    async sectorProxies() {
      const settings = await loadSectorSettings(client);
      return settings?.proxies.map((proxy) => ({ id: proxy.id, market: proxy.market, symbol: proxy.symbol, name: proxy.name }));
    },
    async saveFundFile(file: FundFileRow) {
      const { error } = await client
        .from('fund_holdings')
        .upsert({ fund: file.fund, as_of: file.asOf, source: file.source, constituents: file.constituents.map(packConstituent), loaded_at: new Date().toISOString() }, { onConflict: 'fund' });
      check('fund_holdings', error);
    },
    async saveSectors(rows) {
      for (const row of rows) {
        const { data, error } = await client.from('company_profiles').update({ sector: row.sector }).eq('ticker', row.ticker).select('ticker');
        check('company_profiles', error);
        if ((data ?? []).length > 0) continue;
        const { error: insertError } = await client.from('company_profiles').insert({ ticker: row.ticker, sector: row.sector, source: row.market === 'TW' ? 'twse' : 'ssga' });
        check('company_profiles', insertError);
      }
    },
    revalue: (today) => revalueOnFilings(client, today),
    refreshBetas: (today) => refreshBetas(client, today),
    refreshAttribution: (today) => refreshAttribution(client, today),
    refreshMonteCarlo: async (today) => {
      const saved = await refreshMonteCarlo(client, today);
      return saved ? { runDate: saved.runDate } : undefined;
    },
    performanceInput: (end) => loadPerformanceInput(client, end),
    riskInput: (from, end) => loadRiskInput(client, from, end),
    async saveSnapshots(rows: readonly Snapshot[]) {
      const first = rows[0]?.date;
      // Days before the first one were left by trades since deleted; with nothing held, none stay.
      const stale = client.from('nav_snapshots').delete();
      const { error: staleError } = await (first ? stale.lt('snapshot_date', first) : stale.gte('snapshot_date', '1900-01-01'));
      check('nav_snapshots', staleError);
      // Without a VaR (its inputs failed to load), var_95_1w is left as it is: an upsert writes only
      // the columns it sends, so every row of a request sends the same ones.
      const withVar = rows.some((row) => row.valueAtRisk !== undefined);
      for (const batch of batches(rows)) {
        const { error } = await client.from('nav_snapshots').upsert(
          batch.map((row) => ({
            snapshot_date: row.date,
            total_twd: row.totalTwd,
            weights_by_class: row.weightsByClass,
            ...(withVar ? { var_95_1w: row.valueAtRisk ?? null } : {}),
          })),
          { onConflict: 'snapshot_date' },
        );
        check('nav_snapshots', error);
      }
    },
    evaluateRules: (today, now) => runRules(client, today, now),
    async recordRun(run: JobRun) {
      const { error } = await client
        .from('job_runs')
        .insert({ job: run.job, started_at: run.startedAt, finished_at: run.finishedAt, status: run.status, detail: run.detail });
      check('job_runs', error);
    },
  };
}
