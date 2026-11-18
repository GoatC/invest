import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MarketEvent } from '../../../lib/models/events.ts';
import { readVolatilitySettings, type Close } from '../../../lib/models/volatility.ts';
import type { IndexClose } from '../feeds/indices.ts';
import { JOB, runVolatility, type ScoreRow, type VolatilityRun, type VolatilityStore } from './job.ts';
import { volatilitySummary } from './summary.ts';

const SETTINGS = readVolatilitySettings({
  components: {
    vix: { calm: 12, panic: 40, weight: 2 },
    vix_term: { calm: 0.85, panic: 1.15, weight: 2 },
    tw_vix: { calm: 15, panic: 45, weight: 2 },
    spx_drawdown: { calm: 0.02, panic: 0.2, weight: 1 },
    taiex_drawdown: { calm: 0.03, panic: 0.25, weight: 1 },
    taiex_fall: { calm: 0, panic: 0.1, weight: 1 },
    hy_spread: { calm: 3, panic: 7, weight: 1 },
    epu: { calm: 100, panic: 500, weight: 0.5 },
  },
  max_age_days: 5,
  min_coverage: 0.5,
  drawdown_days: 365,
  fall_sessions: 5,
  epu_days: 7,
  history_days: 400,
  last_verified: null,
});

/** A store in memory: what the job saved, and the closes it reads back. */
function memoryStore(missingSettings = false) {
  const settings = missingSettings ? undefined : SETTINGS;
  const prices = new Map<string, IndexClose>();
  const scores: ScoreRow[] = [];
  const runs: VolatilityRun[] = [];
  let events: MarketEvent[] = [];
  const store: VolatilityStore = {
    settings: async () => settings,
    saveIndexPrices: async (rows, options) => {
      for (const row of rows) {
        const key = `${row.index}|${row.date}`;
        if (!(options?.fillOnly && prices.has(key))) prices.set(key, row);
      }
    },
    series: async (ids, from) => {
      const out = new Map<string, Close[]>();
      for (const row of [...prices.values()].sort((a, b) => a.date.localeCompare(b.date))) {
        if (ids.includes(row.index) && row.date >= from) out.set(row.index, [...(out.get(row.index) ?? []), { date: row.date, close: row.close }]);
      }
      return out;
    },
    saveScore: async (row) => void scores.push(row),
    replaceEvents: async (source, from, rows) => {
      events = [...events.filter((event) => event.source !== source || event.date < from), ...rows];
    },
    recordRun: async (run) => void runs.push(run),
    evaluateRules: async () => ({ created: 1, closed: 0 }),
  };
  return { store, prices, scores, runs, events: () => events };
}

const CBOE = (close: number) => `DATE,OPEN,HIGH,LOW,CLOSE\n11/05/2026,1,1,1,${close}\n`;

/** Replies as on 2026-11-06, with FinMind and FRED down. */
async function reply(url: string): Promise<string> {
  if (url.includes('VIX_History')) return CBOE(28.18);
  if (url.includes('VIX3M_History')) return CBOE(25.55);
  if (url.endsWith('202611new.txt')) return '20261106\t13450000\t\t\t46.52\t\t46.62\n';
  if (url.includes('taifex')) return '<title>404</title>';
  if (url.includes('policyuncertainty')) return 'day,month,year,daily_policy_index\n5,11,2026,168.20\n';
  if (url.includes('fomccalendars')) return '<h4><a id="1">2026 FOMC Meetings</a></h4><div class="fomc-meeting__month"><strong>October</strong></div><div class="fomc-meeting__date">27-28</div><div class="fomc-meeting__month"><strong>December</strong></div><div class="fomc-meeting__date">8-9*</div>';
  if (url.includes('releases/calendar') && url.includes('y=2026')) return '<span style="font-weight: bold;">Tuesday November 10, 2026</span></td></tr><tr><td nowrap style="x"> 7:30 am </td>';
  if (url.includes('releases/calendar')) return '<p>none</p>';
  if (url.includes('openapi.twse')) return JSON.stringify([{ 日期: '1151106', 指數: '發行量加權股價報酬指數', 收盤指數: '60,000.00' }]);
  throw new Error('HTTP 503');
}

const deps = (store: VolatilityStore, get = reply) => ({ get, store, finmindToken: 'token', today: '2026-11-06', now: () => new Date('2026-11-06T07:20:00Z') });

describe('volatility job (N8)', () => {
  it('loads each series, scores the day and records the run; a feed with no fallback left is an error, TAIEX and the S&P 500 only a warning', async () => {
    const { store, prices, scores, runs } = memoryStore();
    const run = await runVolatility(deps(store));
    assert.equal(run.job, JOB);
    assert.deepEqual(Object.keys(run.detail.series).sort(), ['EPU', 'TAIEX', 'TWVIX', 'VIX', 'VIX3M']);
    assert.equal(prices.get('TWVIX|2026-11-06')?.close, 46.52);
    // HY_OAS (FRED) failed: an error, so the run is partial; the S&P 500 (FinMind, FRED) a warning.
    assert.equal(run.status, 'partial');
    assert.ok(run.detail.errors.some((error) => error.startsWith('HY_OAS')));
    assert.ok(run.detail.warnings.some((warning) => warning.startsWith('SPX')));
    assert.equal(scores.length, 1);
    const saved = scores[0] as ScoreRow;
    assert.equal(saved.date, '2026-11-06');
    // VIX 5.78, term 8.43, Taiwan VIX 10, EPU 1.71; one TAIEX close: drawdown 0, no 5-session fall.
    assert.equal(saved.components.find((row) => row.id === 'tw_vix')?.sub_score, 10);
    assert.equal(saved.components.find((row) => row.id === 'taiex_fall')?.status, 'missing');
    assert.ok(saved.score > 5 && saved.score < 8, String(saved.score));
    assert.equal(runs.length, 1);
    assert.deepEqual(run.detail.rules, { created: 1, closed: 0 });
    assert.ok(volatilitySummary(run).some((line) => line.includes('/ 10')));
    assert.ok(volatilitySummary(run).some((line) => line.startsWith('  Rules 規則: 1 warnings raised')));
  });

  it('replaces the feeds\' events from today on: a meeting moved, a past one left out', async () => {
    const { store, events } = memoryStore();
    await store.replaceEvents('fed', '2026-01-01', [{ kind: 'fomc', date: '2026-11-20', time: '03:00', name: { en: 'FOMC rate decision', zh: '聯準會利率決議' }, source: 'fed', note: null }]);
    const run = await runVolatility(deps(store));
    assert.deepEqual(run.detail.events, { fomc: 1, cpi: 1, payrolls: 1 });
    assert.deepEqual(
      events().filter((event) => event.kind === 'fomc').map((event) => event.date),
      ['2026-12-10'],
    );
    assert.ok(volatilitySummary(run).some((line) => line.startsWith('  Events 事件: fomc 1')));
  });

  it('fails, saving no score, without the coverage needed', async () => {
    const { store, scores } = memoryStore();
    const run = await runVolatility(deps(store, async () => Promise.reject(new Error('offline'))));
    assert.equal(run.status, 'failed');
    assert.equal(scores.length, 0);
    assert.ok(run.detail.errors.some((error) => error.startsWith('score:')));
  });

  it('fails before loading anything when config volatility is missing', async () => {
    const { store, runs } = memoryStore(true);
    let asked = 0;
    const run = await runVolatility(deps(store, async () => {
      asked++;
      return '';
    }));
    assert.equal(run.status, 'failed');
    assert.equal(asked, 0);
    assert.match(run.detail.errors[0] as string, /config volatility/);
    assert.equal(runs.length, 1);
  });
});
