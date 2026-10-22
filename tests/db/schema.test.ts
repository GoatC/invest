import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite, Transaction } from '@electric-sql/pglite';

import { as, errorCode, freshDatabase, OWNER_ID, publicTables, STRANGER_ID } from './harness.ts';

// SQLSTATE codes. 42501 covers both a missing privilege and a row-level security refusal.
const DENIED = '42501';
const CHECK_FAILED = '23514';
const KEY_MISSING = '23503';

// PRD Section 7 lists 19 tables; Web Push adds push_subscriptions, the N5 audit log adds audit_log
// and the nightly job (Phase 1, step 4) adds job_runs.
const EXPECTED_TABLES = [
  'asset_classes', 'securities', 'transactions', 'cash_flows', 'prices', 'fx_rates', 'nav_snapshots',
  'rules', 'rule_changes', 'proposals', 'windfall_tranches', 'valuations', 'beta_results', 'red_flags',
  'attribution', 'config', 'watchlist', 'windfall_plan', 'manual_assets', 'push_subscriptions', 'audit_log',
  'job_runs',
].sort();

type Queryable = Pick<Transaction, 'query'>;

/** First column of the first row. */
async function scalar<T = unknown>(db: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<Record<string, T>>(sql, params);
  return Object.values(rows[0] ?? {})[0] as T;
}

let db: PGlite;
before(async () => {
  db = await freshDatabase({ seed: true });
});
after(async () => {
  await db.close();
});

describe('migrations', () => {
  it('create the 19 PRD Section 7 tables plus push_subscriptions, audit_log and job_runs', async () => {
    assert.deepEqual([...publicTables()].sort(), EXPECTED_TABLES);
    const { rows } = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by tablename`);
    assert.deepEqual(
      rows.map((row) => row.tablename),
      EXPECTED_TABLES,
    );
  });
});

describe('row-level security', () => {
  it('is on for every table in public and private', async () => {
    const { rows } = await db.query(`
      select n.nspname || '.' || c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(rows, []);
  });

  it('gives every public table a policy, for signed-in users only', async () => {
    const { rows } = await db.query<{ tablename: string; roles: string }>(
      `select tablename, array_to_string(roles, ',') as roles from pg_policies where schemaname = 'public' order by tablename`,
    );
    assert.deepEqual([...new Set(rows.map((row) => row.tablename))], EXPECTED_TABLES);
    for (const row of rows) assert.equal(row.roles, 'authenticated', row.tablename);
  });

  it('refuses anon on every table', async () => {
    for (const table of EXPECTED_TABLES) {
      assert.equal(await errorCode(as(db, 'anon', (tx) => tx.query(`select 1 from public.${table} limit 1`))), DENIED, table);
    }
  });

  it('refuses anon even on a project that started with the old default grants', async () => {
    const legacy = await freshDatabase({ legacyGrants: true });
    try {
      for (const table of EXPECTED_TABLES) {
        assert.equal(await errorCode(as(legacy, 'anon', (tx) => tx.query(`select 1 from public.${table} limit 1`))), DENIED, table);
      }
      // TRUNCATE skips row-level security, so the broad old grant must be gone too.
      assert.equal(await errorCode(as(legacy, 'stranger', (tx) => tx.query('truncate public.transactions'))), DENIED);
    } finally {
      await legacy.close();
    }
  });

  it('shows a signed-in stranger no rows and refuses their writes', async () => {
    await as(db, 'stranger', async (tx) => {
      for (const table of ['asset_classes', 'securities', 'rules', 'config', 'transactions']) {
        assert.equal(await scalar(tx, `select count(*) from public.${table}`), 0, table);
      }
      // Updates and deletes see no rows, so they change nothing.
      assert.equal((await tx.query('update public.rules set enabled = false')).affectedRows, 0);
      assert.equal((await tx.query('delete from public.transactions')).affectedRows, 0);
    });
    const insert = `insert into public.config (key, value, desc_en, desc_zh) values ('x', '1', 'x', 'x')`;
    assert.equal(await errorCode(as(db, 'stranger', (tx) => tx.query(insert))), DENIED);
  });

  it('lets the owner read, add, change and delete', async () => {
    await as(db, 'owner', async (tx) => {
      assert.equal(await scalar(tx, 'select count(*) from public.asset_classes'), 8);
      const id = await scalar<number>(
        tx,
        `insert into public.transactions (trade_date, ticker, side, qty, price, currency, fx_rate)
         values ('2026-10-21', 'VT', 'buy', 1, 158, 'USD', 32.4) returning id`,
      );
      assert.equal((await tx.query('update public.transactions set qty = 2 where id = $1', [id])).affectedRows, 1);
      assert.equal((await tx.query('delete from public.transactions where id = $1', [id])).affectedRows, 1);
    });
  });

  it('lets the nightly jobs write market data with the service role', async () => {
    await as(db, 'service_role', async (tx) => {
      await tx.query(`insert into public.prices (ticker, price_date, close, source) values ('VT', '2026-10-21', 158.1, 'alphavantage')`);
      assert.equal(await scalar(tx, `select count(*) from public.prices where price_date = '2026-10-21'`), 1);
    });
  });

  it('lets the jobs record their runs, and the owner only read them', async () => {
    const run = `insert into public.job_runs (job, started_at, finished_at, status, detail)
                 values ('nightly_prices', now() - interval '1 minute', now(), 'ok', '{"prices": 12}')`;
    await as(db, 'service_role', async (tx) => {
      await tx.query(run);
      assert.equal(await scalar(tx, `select count(*) from public.job_runs where job = 'nightly_prices'`), 1);
    });
    // A committed run, as the job leaves it, for the owner to read and a stranger not to see.
    await db.query(run);
    try {
      await as(db, 'owner', async (tx) => {
        assert.equal(await scalar(tx, `select status from public.job_runs where job = 'nightly_prices'`), 'ok');
      });
      await as(db, 'stranger', async (tx) => {
        assert.equal(await scalar(tx, 'select count(*) from public.job_runs'), 0);
      });
    } finally {
      await db.query(`delete from public.job_runs where job = 'nightly_prices'`);
    }
    assert.equal(await errorCode(as(db, 'owner', (tx) => tx.query(run))), DENIED);
    assert.equal(await errorCode(as(db, 'owner', (tx) => tx.query('delete from public.job_runs'))), DENIED);
    assert.equal(await errorCode(as(db, 'stranger', (tx) => tx.query(run))), DENIED);
  });

  it('keeps the owner table and the owner check out of reach', async () => {
    assert.equal(await errorCode(as(db, 'anon', (tx) => tx.query('select private.is_owner()'))), DENIED);
    assert.equal(await errorCode(as(db, 'owner', (tx) => tx.query('select * from private.app_owner'))), DENIED);
    assert.equal(await errorCode(as(db, 'stranger', (tx) => tx.query('insert into private.app_owner (user_id) values ($1)', [STRANGER_ID]))), DENIED);
  });

  it('keeps the change logs read-only, even for the owner', async () => {
    for (const sql of [
      `insert into public.audit_log (table_name, row_key, action) values ('transactions', '1', 'delete')`,
      'delete from public.audit_log',
      `update public.rule_changes set new_value = '{}'`,
    ]) {
      assert.equal(await errorCode(as(db, 'owner', (tx) => tx.query(sql))), DENIED, sql);
    }
  });
});

describe('change logs', () => {
  it('record a rule edit with only the changed values and who made it', async () => {
    await as(db, 'owner', async (tx) => {
      await tx.query(`update public.rules set threshold = jsonb_set(threshold, '{max_weight}', '0.06') where id = 'R1'`);
      const { rows } = await tx.query('select rule_id, old_value, new_value, changed_by from public.rule_changes');
      assert.deepEqual(rows, [
        {
          rule_id: 'R1',
          old_value: { threshold: { max_weight: 0.05, pool: 'regular' } },
          new_value: { threshold: { max_weight: 0.06, pool: 'regular' } },
          changed_by: OWNER_ID,
        },
      ]);
    });
  });

  it('skip an update that changes nothing', async () => {
    await as(db, 'owner', async (tx) => {
      // Migrations that change a setting are logged too, so count from here.
      const logged = await scalar(tx, 'select count(*) from public.audit_log');
      await tx.query(`update public.rules set enabled = enabled where id = 'R2'`);
      await tx.query(`update public.config set value = value where key = 'quiet_hours'`);
      assert.equal(await scalar(tx, 'select count(*) from public.rule_changes'), 0);
      assert.equal(await scalar(tx, 'select count(*) from public.audit_log'), logged);
    });
  });

  it('log the step 4 change to the FX setting, made by a migration rather than a person', async () => {
    await as(db, 'owner', async (tx) => {
      const { rows } = await tx.query(
        `select action, new_row -> 'value' as value, changed_by from public.audit_log where table_name = 'config' and row_key = 'fx_rate_check'`,
      );
      assert.deepEqual(rows, [{ action: 'update', value: { max_gap: 0.2, max_age_days: 10 }, changed_by: null }]);
    });
  });

  it('record edits and deletes of holdings in the audit log', async () => {
    await as(db, 'owner', async (tx) => {
      const id = await scalar<number>(tx, `select id from public.transactions where ticker = 'BNDW'`);
      await tx.query('update public.transactions set qty = 5 where id = $1', [id]);
      await tx.query('delete from public.transactions where id = $1', [id]);
      const { rows } = await tx.query(
        `select action, row_key, old_row ->> 'qty' as old_qty, new_row ->> 'qty' as new_qty, changed_by
         from public.audit_log where table_name = 'transactions' order by id`,
      );
      assert.deepEqual(rows, [
        { action: 'update', row_key: String(id), old_qty: '4', new_qty: '5', changed_by: OWNER_ID },
        { action: 'delete', row_key: String(id), old_qty: '5', new_qty: null, changed_by: OWNER_ID },
      ]);
    });
  });

  it('stamp updated_at on every edit', async () => {
    await as(db, 'owner', async (tx) => {
      await tx.query(`update public.config set value = '21' where key = 'proposal_expiry_days'`);
      assert.equal(await scalar(tx, `select updated_at > created_at from public.config where key = 'proposal_expiry_days'`), true);
    });
  });
});

describe('constraints', () => {
  it('require fx_rate 1 on a TWD trade', async () => {
    const insert = `insert into public.transactions (trade_date, ticker, side, qty, price, currency, fx_rate)
                    values ('2026-10-21', '0050', 'buy', 10, 107, 'TWD', 32.4)`;
    assert.equal(await errorCode(as(db, 'owner', (tx) => tx.query(insert))), CHECK_FAILED);
  });

  it('compute amount_twd from the trade-currency amount and fx_rate', async () => {
    // Demo dividend: US$0.62 at 32.20 TWD per USD.
    assert.equal(await scalar(db, `select amount_twd from public.cash_flows where type = 'dividend'`), '19.9640');
  });

  it('keep windfall money in the windfall pool', async () => {
    const insert = `insert into public.cash_flows (flow_date, type, amount) values ('2026-10-21', 'windfall', 1000)`;
    assert.equal(await errorCode(as(db, 'owner', (tx) => tx.query(insert))), CHECK_FAILED);
  });

  it('give a security the sleeve of its asset class, and follow the class when it moves', async () => {
    await as(db, 'service_role', async (tx) => {
      await tx.query(
        `insert into public.securities (ticker, name, market, product_type, asset_class_id, currency, domicile)
         values ('QQQM', 'Invesco NASDAQ 100 ETF', 'US', 'theme_etf', 'tactical_themes', 'USD', 'US')`,
      );
      assert.equal(await scalar(tx, `select sleeve from public.securities where ticker = 'QQQM'`), 'satellite');
      await tx.query(`update public.asset_classes set is_satellite = false where id = 'tactical_themes'`);
      assert.equal(await scalar(tx, `select sleeve from public.securities where ticker = 'QQQM'`), 'core');
    });
    const mismatch = `insert into public.securities (ticker, name, market, product_type, asset_class_id, sleeve, currency, domicile)
                      values ('QQQM', 'Invesco NASDAQ 100 ETF', 'US', 'theme_etf', 'tactical_themes', 'core', 'USD', 'US')`;
    assert.equal(await errorCode(as(db, 'service_role', (tx) => tx.query(mismatch))), KEY_MISSING);
  });

  it("keep a manual asset's unit in line with its product", async () => {
    const insert = `insert into public.manual_assets (name, asset_class_id, product_type, unit, quantity, valuation_method)
                    values ('Gold coin', 'real_assets', 'gold', 'TWD', 1, 'balance')`;
    assert.equal(await errorCode(as(db, 'owner', (tx) => tx.query(insert))), CHECK_FAILED);
  });
});

describe('reference data from the PRD', () => {
  it('sets the Investment Principles targets: 100% in total, 80% core, 20% satellite', async () => {
    const { rows } = await db.query<{ id: string; target_weight: string; sleeve: string }>(
      'select id, target_weight, sleeve from public.asset_classes order by sort_order',
    );
    assert.deepEqual(
      rows.map((row) => [row.id, Number(row.target_weight), row.sleeve]),
      [
        ['us_global_equity', 0.28, 'core'],
        ['tw_market_cap', 0.12, 'core'],
        ['global_bonds', 0.22, 'core'],
        ['real_assets', 0.1, 'core'],
        ['strategic_cash', 0.08, 'core'],
        ['us_stocks', 0.1, 'satellite'],
        ['tw_stocks', 0.05, 'satellite'],
        ['tactical_themes', 0.05, 'satellite'],
      ],
    );
    const { rows: sums } = await db.query(
      `select sum(target_weight) as total,
              sum(target_weight) filter (where sleeve = 'core') as core,
              sum(target_weight) filter (where sleeve = 'satellite') as satellite
       from public.asset_classes`,
    );
    assert.deepEqual(sums, [{ total: '1.00', core: '0.80', satellite: '0.20' }]);
  });

  it('loads R1 (one stock at most 5%) and R2 (above 25% trims the satellite back to 20%) on the regular pool', async () => {
    const { rows } = await db.query(`select id, threshold, enabled from public.rules where id in ('R1', 'R2') order by id`);
    assert.deepEqual(rows, [
      { id: 'R1', threshold: { max_weight: 0.05, pool: 'regular' }, enabled: true },
      { id: 'R2', threshold: { trigger_weight: 0.25, target_weight: 0.2, pool: 'regular' }, enabled: true },
    ]);
  });

  it('loads every Section 4 push rule, with the Phase 2 rules disabled', async () => {
    const { rows } = await db.query<{ id: string; feature: string; enabled: boolean }>('select id, feature, enabled from public.rules order by id');
    assert.equal(rows.length, 14);
    for (const row of rows) assert.equal(row.enabled, !['F3', 'F12', 'N3'].includes(row.feature), row.id);
  });

  it("keeps the trade-entry FX default and typo check in config: the trade date's rate, up to 10 days old, and a 20% margin", async () => {
    assert.deepEqual(await scalar(db, `select value from public.config where key = 'fx_rate_check'`), { max_gap: 0.2, max_age_days: 10 });
  });

  it('lists every Investment Principles core vehicle as a security', async () => {
    const { rows } = await db.query<{ ticker: string }>('select ticker from public.securities');
    const tickers = new Set(rows.map((row) => row.ticker));
    for (const ticker of ['VOO', 'VT', '00692', '009816', '00922', 'BNDW', 'AGGU', 'GLDM', 'BIL']) assert.ok(tickers.has(ticker), ticker);
  });

  it('gives every asset class its benchmark from the N4 proxy table', async () => {
    const { rows } = await db.query<{ id: string; benchmark_ticker: string }>('select id, benchmark_ticker from public.asset_classes');
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.benchmark_ticker])), {
      us_global_equity: 'VT',
      tw_market_cap: '0050',
      global_bonds: 'BNDW',
      real_assets: 'GLDM',
      strategic_cash: 'BIL',
      us_stocks: 'VOO',
      tw_stocks: '0050',
      tactical_themes: 'VT',
    });
  });
});

describe('allocation settings (step 6)', () => {
  it('start the capital market assumptions empty and colour drift amber at half the F8 band', async () => {
    assert.deepEqual(await scalar(db, `select value from public.config where key = 'cma'`), {});
    assert.deepEqual(await scalar(db, `select value from public.config where key = 'drift_display'`), { warn_share: 0.5 });
    assert.deepEqual(await scalar(db, `select threshold from public.rules where id = 'F8_DRIFT'`), { abs_drift: 0.05, rel_drift: 0.25 });
  });

  it('log edits to the assumptions and the targets, and keep them from strangers', async () => {
    await as(db, 'owner', async (tx) => {
      await tx.query(
        `update public.config set value = '{"us_global_equity": {"expected_return": 0.065, "volatility": 0.16, "source": "demo"}}', last_verified = '2026-10-22' where key = 'cma'`,
      );
      await tx.query(`update public.asset_classes set target_weight = 0.27 where id = 'us_global_equity'`);
      const { rows } = await tx.query(`select table_name, row_key, changed_by from public.audit_log where (table_name, row_key) in (('config', 'cma'), ('asset_classes', 'us_global_equity')) order by id`);
      assert.deepEqual(rows, [
        { table_name: 'config', row_key: 'cma', changed_by: OWNER_ID },
        { table_name: 'asset_classes', row_key: 'us_global_equity', changed_by: OWNER_ID },
      ]);
    });
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, `select count(*) from public.config where key in ('cma', 'drift_display')`), 0);
    });
  });
});

describe('compounding plan (step 8)', () => {
  it('starts with no plan saved: the calculator offers its own starting values', async () => {
    assert.deepEqual(await scalar(db, `select value from public.config where key = 'projection'`), {
      start: null,
      pv: null,
      pmt: null,
      step_up: 0,
      expected_return: null,
      inflation: 0.02,
      years: 30,
    });
    assert.deepEqual(await scalar(db, `select value from public.config where key = 'dca'`), { amount_twd: 10000, day_of_month: null });
  });

  it('logs a saved plan and keeps it from strangers', async () => {
    await as(db, 'owner', async (tx) => {
      await tx.query(
        `update public.config set value = '{"start": "2026-05", "pv": 0, "pmt": 10000, "step_up": 0.03, "expected_return": 0.05, "inflation": 0.02, "years": 30}' where key = 'projection'`,
      );
      const { rows } = await tx.query(`select row_key, changed_by, new_row -> 'value' ->> 'start' as start from public.audit_log where table_name = 'config' and row_key = 'projection'`);
      assert.deepEqual(rows, [{ row_key: 'projection', changed_by: OWNER_ID, start: '2026-05' }]);
    });
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, `select count(*) from public.config where key = 'projection'`), 0);
    });
  });
});

describe('latest quote views', () => {
  it('give the newest close per ticker and the newest rate per pair', async () => {
    // The demo seed holds VT at 157.80 and USD/TWD at 32.40, both on 2026-10-20.
    await as(db, 'owner', async (tx) => {
      await tx.query(`insert into public.prices (ticker, price_date, close, source) values ('VT', '2026-10-19', 150, 'demo'), ('VT', '2026-10-21', 160, 'demo')`);
      assert.equal(await scalar(tx, `select close from public.latest_prices where ticker = 'VT'`), '160');
      assert.equal(await scalar(tx, `select count(*) from public.latest_prices where ticker = 'VT'`), 1);
      assert.equal(await scalar(tx, `select rate from public.latest_fx_rates where pair = 'USD/TWD'`), '32.40');
    });
  });

  it('follow the row-level security of their tables: nothing for a stranger, refused for anon', async () => {
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, 'select count(*) from public.latest_prices'), 0);
      assert.equal(await scalar(tx, 'select count(*) from public.latest_fx_rates'), 0);
    });
    for (const view of ['latest_prices', 'latest_fx_rates']) {
      assert.equal(await errorCode(as(db, 'anon', (tx) => tx.query(`select 1 from public.${view}`))), DENIED, view);
    }
  });
});

describe('weekly prices for the VaR (step 7)', () => {
  it('give the last close of each week to Friday, a holiday Friday falling back to Thursday', async () => {
    await as(db, 'owner', async (tx) => {
      await tx.query(
        `insert into public.prices (ticker, price_date, close, adj_close, source) values
           ('VT', '2026-10-26', 150, 150, 'demo'), ('VT', '2026-10-29', 151, 151, 'demo'),
           ('VT', '2026-11-02', 152, 152, 'demo'), ('VT', '2026-11-06', 153, 152.5, 'demo')`,
      );
      const { rows } = await tx.query<{ week_ending: Date; price_date: Date; close: string; adj_close: string }>(
        `select week_ending, price_date, close, adj_close from public.weekly_prices where ticker = 'VT' and week_ending >= '2026-10-30' order by week_ending`,
      );
      assert.deepEqual(
        rows.map((row) => [row.week_ending.toISOString().slice(0, 10), row.price_date.toISOString().slice(0, 10), Number(row.close), Number(row.adj_close)]),
        [
          ['2026-10-30', '2026-10-29', 151, 151],
          ['2026-11-06', '2026-11-06', 153, 152.5],
        ],
      );
    });
  });

  it('follow the row-level security of prices: nothing for a stranger, refused for anon', async () => {
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, 'select count(*) from public.weekly_prices'), 0);
    });
    assert.equal(await errorCode(as(db, 'anon', (tx) => tx.query('select 1 from public.weekly_prices'))), DENIED);
  });

  it('come with three years of invented weekly closes for every proxy and the dollar in the demo seed, ending at the first demo trade', async () => {
    const { rows } = await db.query<{ ticker: string; weeks: string; first: Date; last: Date }>(
      `select ticker, count(*) as weeks, min(price_date) as first, max(price_date) as last
       from public.prices where price_date < '2026-05-07' group by ticker order by ticker`,
    );
    assert.deepEqual(
      rows.map((row) => [row.ticker, Number(row.weeks), row.first.toISOString().slice(0, 10), row.last.toISOString().slice(0, 10)]),
      ['0050', 'BIL', 'BNDW', 'GLDM', 'VOO', 'VT'].map((ticker) => [ticker, 174, '2023-01-06', '2026-05-01']),
    );
    assert.equal(await scalar(db, `select count(*) from public.fx_rates where pair = 'USD/TWD' and rate_date < '2026-05-07'`), 174);
    // A walk that lands on the first demo trade's close, a week away, with weekly moves of shares-like size.
    const { rows: vt } = await db.query<{ close: string }>(`select close from public.prices where ticker = 'VT' and price_date <= '2026-05-07' order by price_date`);
    const closes = vt.map((row) => Number(row.close));
    const returns = closes.slice(1).map((close, i) => close / (closes[i] ?? close) - 1);
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const sd = Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1));
    assert.ok(sd > 0.015 && sd < 0.03, `VT weekly sd ${sd}`);
    assert.ok(Math.abs((returns[returns.length - 1] ?? 1) - mean) < 4 * sd, 'the last week into the 2026-05-07 close is an ordinary one');
  });
});

describe('demo seed', () => {
  it('marks every price and FX rate as demo data', async () => {
    assert.equal(await scalar(db, `select count(*) from public.prices where source <> 'demo'`), 0);
    assert.equal(await scalar(db, `select count(*) from public.fx_rates where source <> 'demo'`), 0);
  });

  it('holds no windfall money (CLAUDE.md: no windfall figures in git)', async () => {
    const windfallRows = await scalar(
      db,
      `select (select count(*) from public.windfall_plan)
            + (select count(*) from public.transactions where pool = 'windfall')
            + (select count(*) from public.cash_flows where pool = 'windfall')
            + (select count(*) from public.manual_assets where pool = 'windfall')`,
    );
    assert.equal(windfallRows, 0);
  });
});
