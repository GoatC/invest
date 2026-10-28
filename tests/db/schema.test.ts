import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite, Transaction } from '@electric-sql/pglite';

import { readBrokers, readFeeSettings, readFundCosts, readTaxSettings } from '../../lib/models/costs.ts';
import { readCapmSettings } from '../../lib/models/capm.ts';
import { readValuationSettings } from '../../lib/models/intrinsic.ts';
import { readLookThroughSettings } from '../../lib/models/look-through.ts';
import { readRedFlagSettings } from '../../lib/models/red-flags.ts';
import { readRegressionSettings } from '../../lib/models/regression.ts';
import { capePercentile, drawdownOf } from '../../lib/models/windfall.ts';
import { as, errorCode, freshDatabase, OWNER_ID, publicTables, STRANGER_ID } from './harness.ts';

// SQLSTATE codes. 42501 covers both a missing privilege and a row-level security refusal.
const DENIED = '42501';
const CHECK_FAILED = '23514';
const KEY_MISSING = '23503';

// PRD Section 7 lists 19 tables; Web Push adds push_subscriptions and its outbox, notifications
// (step 10), the N5 audit log adds audit_log, the nightly job (Phase 1, step 4) adds job_runs, and
// the windfall planner (Phase 2, step 1) adds market_series, the Regression Lab (step 2) index_prices,
// the valuation workbench (step 4) fundamentals, the red-flag indicator (step 5) company_profiles,
// red_flag_events and red_flag_entries, and the look-through (step 6) fund_holdings.
const EXPECTED_TABLES = [
  'asset_classes', 'securities', 'transactions', 'cash_flows', 'prices', 'fx_rates', 'nav_snapshots',
  'rules', 'rule_changes', 'proposals', 'windfall_tranches', 'valuations', 'beta_results', 'red_flags',
  'attribution', 'config', 'watchlist', 'windfall_plan', 'manual_assets', 'push_subscriptions', 'audit_log',
  'job_runs', 'notifications', 'market_series', 'index_prices', 'fundamentals',
  'company_profiles', 'red_flag_events', 'red_flag_entries', 'fund_holdings',
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
  it('create the 19 PRD Section 7 tables plus push_subscriptions, audit_log, job_runs, notifications, market_series, index_prices, fundamentals, company_profiles, red_flag_events, red_flag_entries and fund_holdings', async () => {
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
      // Rule changes made by a migration are logged too, with no one as their author.
      const { rows } = await tx.query('select rule_id, old_value, new_value, changed_by from public.rule_changes where changed_by is not null');
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
      assert.equal(await scalar(tx, 'select count(*) from public.rule_changes where changed_by is not null'), 0);
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

  it('loads every Section 4 push rule, each enabled once its step is built (F3 since Phase 2, step 1, F12 since step 4, N3 since step 5)', async () => {
    const { rows } = await db.query<{ id: string; feature: string; enabled: boolean }>('select id, feature, enabled from public.rules order by id');
    assert.equal(rows.length, 14);
    for (const row of rows) assert.equal(row.enabled, true, row.id);
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

describe('proposals (step 9)', () => {
  it('keep one open proposal per rule and state, and log every change to one', async () => {
    await as(db, 'owner', async (tx) => {
      const insert = (state: string) =>
        tx.query(`insert into public.proposals (rule_id, state, orders, detail, expires_at) values ('R1', $1, '[]', '{"weight": 0.055}', now() + interval '14 days') returning id`, [state]);
      const { rows } = await insert('2330');
      const id = (rows[0] as { id: number }).id;
      // A refused statement aborts the transaction; the savepoint lets the test carry on.
      const refused = async (statement: () => Promise<unknown>) => {
        await tx.query('savepoint refused');
        const code = await errorCode(statement());
        await tx.query('rollback to savepoint refused');
        return code;
      };
      assert.equal(await refused(() => insert('2330')), '23505');
      await insert('AAPL');
      await tx.query(`update public.proposals set status = 'expired', closed_reason = 'cleared' where id = $1`, [id]);
      await insert('2330');
      const log = await tx.query(`select row_key, action, new_row ->> 'status' as status, changed_by from public.audit_log where table_name = 'proposals'`);
      assert.deepEqual(log.rows, [{ row_key: String(id), action: 'update', status: 'expired', changed_by: OWNER_ID }]);
      assert.equal(await refused(() => tx.query(`update public.proposals set closed_reason = 'whatever' where id = $1`, [id])), '23514');
    });
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, 'select count(*) from public.proposals'), 0);
    });
  });
});

describe('fractional orders (after step 9)', () => {
  it('size US orders in fractions to four decimals, other markets in whole shares', async () => {
    assert.deepEqual(await scalar(db, `select value from public.config where key = 'orders'`), { fractional_markets: ['US'], share_decimals: 4 });
  });
});

describe('web push (step 10)', () => {
  it('plans each push once per kind and key, and keeps the log from strangers', async () => {
    await as(db, 'owner', async (tx) => {
      const plan = () => tx.query(`insert into public.notifications (kind, key, title, body, url) values ('weekly', '2026-10-25', 'Weekly review', 'Rules: all on track.', '/') on conflict (kind, key) do nothing returning id`);
      assert.equal((await plan()).rows.length, 1);
      assert.equal((await plan()).rows.length, 0);
      await tx.query(`update public.notifications set sent_at = now(), delivered = 2 where kind = 'weekly'`);
      await tx.query('savepoint refused');
      assert.equal(await errorCode(tx.query(`insert into public.notifications (kind, key, title, body, url) values ('price', 'x', 't', 'b', 'https://evil.example')`)), CHECK_FAILED);
      await tx.query('rollback to savepoint refused');
      await tx.query(`insert into public.push_subscriptions (endpoint, keys, device_name) values ('https://push.example.com/1', '{"p256dh": "k", "auth": "a"}', 'iPhone')`);
      await tx.query(`update public.push_subscriptions set last_error = 'push service 429'`);
    });
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, 'select count(*) from public.notifications'), 0);
      assert.equal(await scalar(tx, 'select count(*) from public.push_subscriptions'), 0);
    });
  });
});

describe('fee and tax drag (step 11)', () => {
  it('seed the tax thresholds with the date checked, the fees, the brokers and the fund costs, all readable by the app', async () => {
    const value = (key: string) => scalar(db, `select value from public.config where key = $1`, [key]);
    const tax = readTaxSettings(await value('tax'));
    assert.deepEqual(tax?.amt, { overseasFloorTwd: 1_000_000, exemptionTwd: 7_500_000, rate: 0.2 });
    assert.deepEqual(tax?.withholding, { US: 0.3, IE: 0.15, TW: 0 });
    assert.equal((await scalar<Date>(db, `select last_verified from public.config where key = 'tax'`)).toISOString().slice(0, 10), '2026-10-22');
    assert.deepEqual(readFeeSettings(await value('fees')), { brokerId: null, tw: { rate: 0.001425, discount: 1, minTwd: 20 }, fxSpread: 0.001 });
    assert.deepEqual(
      readBrokers(await value('brokers')).map((broker) => broker.id),
      ['cathay', 'sinopac', 'yuanta', 'masterlink'],
    );
    const funds = readFundCosts(await value('fund_costs'));
    assert.equal(funds.length, 14);
    const classes = (await db.query<{ id: string }>('select id from public.asset_classes')).rows.map((row) => row.id);
    assert.deepEqual(
      funds.filter((fund) => !classes.includes(fund.assetClassId)),
      [],
    );
  });

  it('evaluate US_ESTATE_TAX at most once a month while it holds', async () => {
    assert.deepEqual(await scalar(db, `select threshold from public.rules where id = 'US_ESTATE_TAX'`), { usd: 60000 });
    assert.equal(await scalar(db, `select cooldown_days from public.rules where id = 'US_ESTATE_TAX'`), 30);
    await as(db, 'owner', async (tx) => {
      const { rows } = await tx.query(`select old_value ->> 'cooldown_days' as old, new_value ->> 'cooldown_days' as new, changed_by from public.rule_changes where rule_id = 'US_ESTATE_TAX'`);
      assert.deepEqual(rows, [{ old: '7', new: '30', changed_by: null }]);
    });
  });
});

describe('Regression Lab (Phase 2, step 2)', () => {
  it('keeps the index closes for the owner to read and the job to write, one row per index and day', async () => {
    await as(db, 'owner', async (tx) => {
      assert.equal(await errorCode(tx.query(`insert into public.index_prices (index_id, price_date, close, source) values ('SPX', '2099-10-27', 7722.6, 'finmind')`)), DENIED);
    });
    await db.query(`insert into public.index_prices (index_id, price_date, close, source) values ('SPX', '2099-10-27', 7722.6, 'finmind')`);
    assert.equal(await errorCode(db.query(`insert into public.index_prices (index_id, price_date, close, source) values ('spx', '2099-10-28', 7722.6, 'finmind')`)), CHECK_FAILED);
    await as(db, 'owner', async (tx) => {
      assert.equal(await scalar(tx, `select close from public.index_prices where index_id = 'SPX' and price_date = '2099-10-27'`), '7722.6');
    });
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, 'select count(*) from public.index_prices'), 0);
    });
    await db.query(`delete from public.index_prices where price_date = '2099-10-27'`);
  });

  it('seeds settings the app reads: both benchmarks, weekly over two years in local currency, Blume 0.67', async () => {
    const settings = readRegressionSettings(await scalar(db, `select value from public.config where key = 'regression'`));
    assert.ok(settings);
    assert.deepEqual(settings.benchmarks.map((benchmark) => [benchmark.id, benchmark.market, benchmark.currency]), [
      ['SPX', 'US', 'USD'],
      ['TAIEX', 'TW', 'TWD'],
    ]);
    assert.deepEqual(settings.defaults, { freq: 'weekly', years: 2, currency: 'local' });
    assert.deepEqual(settings.windows, [1, 2, 3, 5]);
    assert.deepEqual(settings.blume, { weight: 0.67, prior: 1 });
    assert.equal(settings.riskFreeChecked, null);
  });

  it("seeds the cost of equity's settings (F11): adjusted β, Damodaran's ERP, each market's index, yield series and country premium", async () => {
    const settings = readCapmSettings(await scalar(db, `select value from public.config where key = 'capm'`));
    assert.ok(settings);
    assert.equal(settings.beta, 'adjusted');
    assert.deepEqual(settings.erp, { source: 'damodaran', manual: 0.0423 });
    assert.deepEqual(settings.markets, {
      US: { benchmark: 'SPX', riskFreeSeries: 'us_treasury_10y', riskFree: 0.05, countryPremium: 0 },
      TW: { benchmark: 'TAIEX', riskFreeSeries: 'tw_govt_10y', riskFree: 0.01955, countryPremium: 0.0078 },
    });
    assert.equal(settings.checked, null);
    // Each benchmark is one the Regression Lab measures β against.
    const regression = readRegressionSettings(await scalar(db, `select value from public.config where key = 'regression'`));
    for (const inputs of Object.values(settings.markets)) assert.ok(regression?.benchmarks.some((benchmark) => benchmark.id === inputs.benchmark));
    await as(db, 'owner', async (tx) => {
      await tx.query(`update public.config set value = jsonb_set(value, '{beta}', '"raw"') where key = 'capm'`);
      const { rows } = await tx.query<{ beta: string }>(`select new_row -> 'value' ->> 'beta' as beta from public.audit_log where table_name = 'config' and row_key = 'capm'`);
      assert.deepEqual(rows, [{ beta: 'raw' }]);
    });
  });

  it('lets the owner keep β results, which the monthly refresh writes', async () => {
    await as(db, 'owner', async (tx) => {
      await tx.query(
        `insert into public.beta_results (ticker, benchmark, model, freq, window_years, beta, alpha, factor_loadings, r2, std_err, run_date) values ('VT', 'SPX', '1F', 'weekly', 2, 0.98, 0.01, '{"adjusted": 0.9866}', 0.9, 0.03, '2026-11-02')`,
      );
      assert.equal(await scalar(tx, `select count(*) from public.beta_results where ticker = 'VT'`), 1);
    });
  });
});

describe('valuation workbench (Phase 2, step 4)', () => {
  it('keeps the fundamentals for the owner to read and the job to write, one row per stock and quarter end', async () => {
    const row = `('AAPL', '2099-06-30', '{"netIncome": 100, "shares": 10}', 'USD', '2099-07-31', 'sec')`;
    await as(db, 'owner', async (tx) => {
      assert.equal(await errorCode(tx.query(`insert into public.fundamentals (ticker, period_end, figures, currency, filed_on, source) values ${row}`)), DENIED);
    });
    await db.query(`insert into public.fundamentals (ticker, period_end, figures, currency, filed_on, source) values ${row}`);
    assert.equal(await errorCode(db.query(`insert into public.fundamentals (ticker, period_end, figures, currency, source) values ('AAPL', '2099-09-30', '[]', 'USD', 'sec')`)), CHECK_FAILED);
    assert.equal(await errorCode(db.query(`insert into public.fundamentals (ticker, period_end, figures, currency, source) values ('NOPE', '2099-09-30', '{}', 'USD', 'sec')`)), KEY_MISSING);
    await as(db, 'owner', async (tx) => {
      assert.equal(await scalar(tx, `select figures ->> 'shares' from public.fundamentals where ticker = 'AAPL' and period_end = '2099-06-30'`), '10');
    });
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, 'select count(*) from public.fundamentals'), 0);
    });
    await db.query(`delete from public.fundamentals where period_end = '2099-06-30'`);
  });

  it('seeds the defaults the workbench reads, and turns the three F12 rules on', async () => {
    const settings = readValuationSettings(await scalar(db, `select value from public.config where key = 'valuation'`));
    assert.ok(settings);
    assert.equal(settings.model, 'dcf');
    assert.deepEqual(settings.growth, { bear: 0.02, base: 0.06, bull: 0.1 });
    assert.deepEqual(settings.terminal, { bear: 0.015, base: 0.025, bull: 0.03 });
    const { rows } = await db.query<{ id: string; enabled: boolean; threshold: unknown; cooldown_days: number }>(
      `select id, enabled, threshold, cooldown_days from public.rules where feature = 'F12' order by id`,
    );
    assert.deepEqual(rows, [
      { id: 'BUY_ZONE', enabled: true, threshold: { multiple: 0.75 }, cooldown_days: 7 },
      { id: 'TRIM_ZONE', enabled: true, threshold: { multiple: 1.25, sell_share: 0.5 }, cooldown_days: 30 },
      { id: 'VALUATION_UPDATED', enabled: true, threshold: { change: 0.1 }, cooldown_days: 7 },
    ]);
  });

  it("logs an edit of a stock's assumptions, which must be an object", async () => {
    await as(db, 'owner', async (tx) => {
      await tx.query(`update public.watchlist set assumptions = '{"model": "ddm"}' where ticker = 'AAPL'`);
      const { rows } = await tx.query<{ model: string }>(`select new_row -> 'assumptions' ->> 'model' as model from public.audit_log where table_name = 'watchlist' and row_key = 'AAPL'`);
      assert.deepEqual(rows, [{ model: 'ddm' }]);
      assert.equal(await errorCode(tx.query(`update public.watchlist set assumptions = '[]' where ticker = 'AAPL'`)), CHECK_FAILED);
    });
  });

  it('keeps each model\'s values a share in order, bear to bull', async () => {
    await as(db, 'owner', async (tx) => {
      await tx.query(`insert into public.valuations (ticker, valuation_date, model, iv_bear, iv_base, iv_bull, inputs) values ('AAPL', '2099-11-02', 'dcf_fcff', 150, 200, 260, '{"trigger": "edit"}')`);
      assert.equal(await errorCode(tx.query(`insert into public.valuations (ticker, valuation_date, model, iv_bear, iv_base, iv_bull) values ('AAPL', '2099-11-02', 'ddm', 210, 200, 260)`)), CHECK_FAILED);
    });
  });
});

describe('red-flag indicator (Phase 2, step 5)', () => {
  it('keeps the profiles and events for the owner to read and the job to write, and the scans for both to write', async () => {
    const scan = `('AAPL', '2099-06-30', 'beneish_m', -2.4, 'green', 87.5, '{"periodEnd": "2099-03-31"}')`;
    for (const statement of [
      `insert into public.company_profiles (ticker, source) values ('AAPL', 'sec')`,
      `insert into public.red_flag_events (ticker, indicator, event_date, source, ref, title) values ('AAPL', 'restatement', '2099-01-01', 'sec', 'x', '8-K')`,
    ]) {
      await as(db, 'owner', async (tx) => {
        assert.equal(await errorCode(tx.query(statement)), DENIED, statement);
      });
    }
    await as(db, 'owner', async (tx) => {
      await tx.query(`insert into public.red_flags (ticker, flag_date, indicator, value, level, coverage_pct, detail) values ${scan}`);
    });
    await db.query(`insert into public.red_flags (ticker, flag_date, indicator, value, level, coverage_pct, detail) values ${scan}`);
    await db.query(`insert into public.red_flags (ticker, flag_date, indicator, level, coverage_pct) values ('AAPL', '2099-06-30', 'governance_rating', 'na', 87.5)`);
    assert.equal(await errorCode(db.query(`insert into public.red_flags (ticker, flag_date, indicator, level) values ('AAPL', '2099-06-30', 'altman_z', 'blue')`)), CHECK_FAILED);
    // The seed has AAPL's profile: overwrite it here, and put it back at the end.
    const seeded = await scalar(db, `select to_jsonb(p) from public.company_profiles p where ticker = 'AAPL'`);
    await db.query(`delete from public.company_profiles where ticker = 'AAPL'`);
    await db.query(`insert into public.company_profiles (ticker, industry_code, industry, sic, checked, source) values ('AAPL', '3571', 'Electronic Computers', 3571, '{"restatement": {"on": "2099-06-30"}}', 'sec')`);
    assert.equal(await errorCode(db.query(`insert into public.company_profiles (ticker, business_id, source) values ('2330', '123', 'twse')`)), CHECK_FAILED);
    await db.query(`insert into public.red_flag_events (ticker, indicator, event_date, source, ref, title) values ('AAPL', 'restatement', '2099-01-01', 'sec', '0000320193-99-000001', '8-K Item 4.02')`);
    assert.equal(await errorCode(db.query(`insert into public.red_flag_events (ticker, indicator, event_date, source, ref, title) values ('AAPL', 'restatement', '2099-02-01', 'sec', '0000320193-99-000001', 'again')`)), '23505');
    await as(db, 'owner', async (tx) => {
      assert.equal(await scalar(tx, `select count(*) from public.red_flags where flag_date = '2099-06-30'`), 2);
      assert.equal(await scalar(tx, `select industry from public.company_profiles where ticker = 'AAPL'`), 'Electronic Computers');
    });
    await as(db, 'stranger', async (tx) => {
      for (const table of ['red_flags', 'company_profiles', 'red_flag_events', 'red_flag_entries']) assert.equal(await scalar(tx, `select count(*) from public.${table}`), 0, table);
    });
    await db.query(`delete from public.red_flags where flag_date = '2099-06-30'`);
    await db.query(`delete from public.red_flag_events where event_date = '2099-01-01'`);
    await db.query(`delete from public.company_profiles where ticker = 'AAPL'`);
    await db.query(`insert into public.company_profiles select * from jsonb_populate_record(null::public.company_profiles, $1)`, [seeded]);
  });

  it("lets the owner write their own entries, a count of events or a governance tier, and logs each edit", async () => {
    for (const [indicator, value] of [['governance_rating', 33], ['environmental_penalties', 1.5], ['beneish_m', 0]] as const) {
      await as(db, 'owner', async (tx) => {
        assert.equal(await errorCode(tx.query(`insert into public.red_flag_entries (ticker, indicator, as_of, value) values ('2330', '${indicator}', '2099-05-01', ${value})`)), CHECK_FAILED, indicator);
      });
    }
    await as(db, 'owner', async (tx) => {
      const { rows } = await tx.query<{ id: string }>(`insert into public.red_flag_entries (ticker, indicator, as_of, value, note) values ('2330', 'governance_rating', '2099-05-01', 5, '第 12 屆') returning id`);
      const id = rows[0]?.id;
      await tx.query(`update public.red_flag_entries set value = 20 where id = ${id}`);
      await tx.query(`delete from public.red_flag_entries where id = ${id}`);
      const { rows: log } = await tx.query<{ action: string }>(`select action from public.audit_log where table_name = 'red_flag_entries' and row_key = '${id}' order by id`);
      assert.deepEqual(log.map((row) => row.action), ['update', 'delete']);
    });
  });

  it('seeds the settings, and turns the two N3 rules on, RED_FLAG_RED selling all of the stock', async () => {
    const settings = readRedFlagSettings(await scalar(db, `select value from public.config where key = 'red_flags'`));
    assert.ok(settings);
    assert.equal(settings.beneish.redAbove, -1.78);
    assert.deepEqual(settings.altman, { z: { redBelow: 1.81, amberBelow: 2.99 }, z2: { redBelow: 1.1, amberBelow: 2.6 } });
    assert.ok(settings.manufacturing.twIndustries.includes('24'));
    assert.deepEqual(settings.excluded, { industries: [], tickers: [] });
    const { rows } = await db.query<{ id: string; enabled: boolean; threshold: unknown }>(`select id, enabled, threshold from public.rules where feature = 'N3' order by id`);
    assert.deepEqual(rows, [
      { id: 'RED_FLAG_RED', enabled: true, threshold: { sell_share: 1 } },
      { id: 'RED_FLAG_WORSENS', enabled: true, threshold: {} },
    ]);
  });
});

describe('look-through (Phase 2, step 6)', () => {
  it('keeps each fund\'s holdings file for the owner to read and the job to write, as an array', async () => {
    await as(db, 'owner', async (tx) => {
      assert.equal(await errorCode(tx.query(`insert into public.fund_holdings (fund, as_of, source, constituents) values ('BNDW', '2099-01-01', 'vanguard', '[]')`)), DENIED);
    });
    assert.equal(await errorCode(db.query(`insert into public.fund_holdings (fund, as_of, source, constituents) values ('BNDW', '2099-01-01', 'vanguard', '{}')`)), CHECK_FAILED);
    await db.query(`insert into public.fund_holdings (fund, as_of, source, constituents) values ('BNDW', '2099-01-01', 'vanguard', '[["US:X", "X", "X", "US", "USD", null, "bond", 1]]')`);
    await as(db, 'owner', async (tx) => {
      assert.equal(await scalar(tx, `select jsonb_array_length(constituents) from public.fund_holdings where fund = 'BNDW'`), 1);
    });
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, 'select count(*) from public.fund_holdings'), 0);
    });
    await db.query(`delete from public.fund_holdings where fund = 'BNDW'`);
    assert.equal(await errorCode(db.query(`update public.company_profiles set sector = 'Chips' where ticker = 'AAPL'`)), CHECK_FAILED);
  });

  it('seeds the settings: VT and VOO from Vanguard, 00692 from Fubon, a GICS sector for every TWSE industry', async () => {
    const settings = readLookThroughSettings(await scalar(db, `select value from public.config where key = 'look_through'`));
    assert.ok(settings);
    assert.deepEqual(Object.keys(settings.sources).sort(), ['00692', 'VOO', 'VT']);
    assert.equal(settings.twSectors['24'], 'Information Technology');
    assert.equal(settings.twSectors['17'], 'Financials');
    assert.equal(Object.keys(settings.twSectors).length, 36);
  });
});

describe('windfall planner (Phase 2, step 1)', () => {
  it('keeps the market series for the owner to read and the job to write, one row per series and month', async () => {
    await as(db, 'owner', async (tx) => {
      assert.equal(await errorCode(tx.query(`insert into public.market_series (series, obs_month, value, source) values ('us_cape', '2026-10-01', 40.8, 'shiller')`)), DENIED);
    });
    await db.query(`insert into public.market_series (series, obs_month, value, source) values ('us_cape', '2099-10-01', 40.8, 'shiller')`);
    assert.equal(await errorCode(db.query(`insert into public.market_series (series, obs_month, value, source) values ('us_cape', '2099-10-15', 40.8, 'shiller')`)), CHECK_FAILED);
    await as(db, 'owner', async (tx) => {
      assert.equal(await scalar(tx, `select value from public.market_series where series = 'us_cape' and obs_month = '2099-10-01'`), '40.8');
    });
    await as(db, 'stranger', async (tx) => {
      assert.equal(await scalar(tx, 'select count(*) from public.market_series'), 0);
    });
    await db.query(`delete from public.market_series where obs_month = '2099-10-01'`);
  });

  it('adds ACWI for the drawdown gauge, the planner settings, and turns the F3 rules on', async () => {
    assert.equal(await scalar(db, `select asset_class_id from public.securities where ticker = 'ACWI'`), 'us_global_equity');
    assert.deepEqual(await scalar(db, `select value from public.config where key = 'windfall'`), { vehicles: {}, cash_return: 0.015, backtest: { from_year: 1900, horizon_months: 60 } });
    const { rows } = await db.query<{ id: string; enabled: boolean }>(`select id, enabled from public.rules where id like 'WINDFALL%' order by id`);
    assert.deepEqual(rows, [
      { id: 'WINDFALL_ACCELERATION', enabled: true },
      { id: 'WINDFALL_TRANCHE_DUE', enabled: true },
    ]);
  });

  it('logs edits to a plan and its tranches, and deletes the tranches with their plan', async () => {
    await as(db, 'owner', async (tx) => {
      const id = await scalar<number>(tx, `insert into public.windfall_plan (total_twd, received_on, cape_percentile, tranche_count) values (5500000, '2026-11-02', 75, 24) returning id`);
      await tx.query(`insert into public.windfall_tranches (plan_id, due_date, amount_twd) values ($1, '2026-11-02', 229167), ($1, '2026-12-02', 229167)`, [id]);
      await tx.query(`update public.windfall_tranches set status = 'done' where plan_id = $1 and due_date = '2026-11-02'`, [id]);
      await tx.query('delete from public.windfall_plan where id = $1', [id]);
      const { rows } = await tx.query<{ table_name: string; action: string }>(`select table_name, action from public.audit_log where table_name in ('windfall_plan', 'windfall_tranches') order by id`);
      // The plan's delete is logged, then its two tranches as the cascade removes them.
      assert.deepEqual(
        rows.map((row) => `${row.table_name} ${row.action}`).sort(),
        ['windfall_plan delete', 'windfall_tranches delete', 'windfall_tranches delete', 'windfall_tranches update'],
      );
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

  it('come with three years of invented weekly closes for every proxy, ACWI, the two demo stocks and the dollar in the demo seed, ending at the first demo trade', async () => {
    const { rows } = await db.query<{ ticker: string; weeks: string; first: Date; last: Date }>(
      `select ticker, count(*) as weeks, min(price_date) as first, max(price_date) as last
       from public.prices where price_date < '2026-05-07' group by ticker order by ticker`,
    );
    assert.deepEqual(
      rows.map((row) => [row.ticker, Number(row.weeks), row.first.toISOString().slice(0, 10), row.last.toISOString().slice(0, 10)]),
      ['0050', '2330', 'AAPL', 'ACWI', 'BIL', 'BNDW', 'GLDM', 'VOO', 'VT'].map((ticker) => [ticker, 174, '2023-01-06', '2026-05-01']),
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
  it('marks every price, FX rate and market series month as demo data', async () => {
    assert.equal(await scalar(db, `select count(*) from public.prices where source <> 'demo'`), 0);
    assert.equal(await scalar(db, `select count(*) from public.fx_rates where source <> 'demo'`), 0);
    assert.equal(await scalar(db, `select count(*) from public.market_series where source <> 'demo'`), 0);
    assert.equal(await scalar(db, `select count(*) from public.index_prices where source <> 'demo'`), 0);
    assert.equal(await scalar(db, `select count(*) from public.fundamentals where source <> 'demo'`), 0);
    assert.equal(await scalar(db, `select count(*) from public.company_profiles where source <> 'demo'`), 0);
    assert.equal(await scalar(db, `select count(*) from public.red_flag_events where source <> 'demo'`), 0);
    assert.equal(await scalar(db, `select count(*) from public.fund_holdings where source <> 'demo'`), 0);
  });

  it('invents two green weekly red-flag scans (N3), and an auditor change for AAPL after them', async () => {
    const { rows } = await db.query<{ ticker: string; flag_date: string; levels: string; rows: string }>(
      `select ticker, flag_date::text, string_agg(distinct level, ',' order by level) as levels, count(*) as rows from public.red_flags group by ticker, flag_date order by ticker, flag_date`,
    );
    assert.deepEqual(rows.map((row) => [row.ticker, row.flag_date, row.levels, Number(row.rows)]), [
      ['2330', '2026-10-11', 'green', 9],
      ['2330', '2026-10-18', 'green', 9],
      ['AAPL', '2026-10-11', 'green,na,none', 9],
      ['AAPL', '2026-10-18', 'green,na,none', 9],
    ]);
    assert.equal(await scalar(db, `select event_date::text from public.red_flag_events where ticker = 'AAPL'`), '2026-10-20');
  });

  it("invents thirteen quarters of filings for the two demo stocks (F12), AAPL's with the day it filed", async () => {
    const { rows } = await db.query<{ ticker: string; quarters: string; first: string; last: string; filed: string }>(
      `select ticker, count(*) as quarters, min(period_end)::text as first, max(period_end)::text as last, count(filed_on) as filed from public.fundamentals group by ticker order by ticker`,
    );
    assert.deepEqual(rows.map((row) => [row.ticker, Number(row.quarters), row.first, row.last, Number(row.filed)]), [
      ['2330', 13, '2023-06-30', '2026-06-30', 0],
      ['AAPL', 13, '2023-06-30', '2026-06-30', 13],
    ]);
  });

  it("invents Shiller's monthly series for the windfall planner (F3): price and yield from 1871, CAPE from 1881, to 2026-09; and the cost of equity's yields and ERP (F11)", async () => {
    const { rows } = await db.query<{ series: string; months: string; first: Date; last: Date }>(
      `select series, count(*) as months, min(obs_month) as first, max(obs_month) as last from public.market_series group by series order by series`,
    );
    assert.deepEqual(
      rows.map((row) => [row.series, Number(row.months), row.first.toISOString().slice(0, 7), row.last.toISOString().slice(0, 7)]),
      [
        ['sp500_price', 1869, '1871-01', '2026-09'],
        ['sp500_yield', 1869, '1871-01', '2026-09'],
        ['tw_govt_10y', 3, '2026-06', '2026-08'],
        ['us_cape', 1749, '1881-01', '2026-09'],
        ['us_implied_erp', 3, '2026-08', '2026-10'],
        ['us_tbill_3m', 45, '2023-01', '2026-09'],
        ['us_treasury_10y', 3, '2026-08', '2026-10'],
      ],
    );
    // CAPE ends above its 70th percentile, so a demo plan takes 24 tranches.
    const { rows: capes } = await db.query<{ month: string; value: string }>(`select to_char(obs_month, 'YYYY-MM') as month, value from public.market_series where series = 'us_cape' order by obs_month`);
    const gauge = capePercentile(capes.map((row) => ({ month: row.month, value: Number(row.value) })));
    assert.equal(gauge?.cape, 24.04);
    assert.equal(Math.round(gauge?.percentile ?? 0), 74);
  });

  it("gives ACWI daily closes to the newest demo date, ending short of the first acceleration tier (F3)", async () => {
    const { rows } = await db.query<{ date: string; close: string }>(`select price_date::text as date, close from public.prices where ticker = 'ACWI' order by price_date`);
    const drawdown = drawdownOf(rows.map((row) => ({ date: row.date, close: Number(row.close) })), '2026-10-28', 52);
    assert.deepEqual(drawdown?.peak, { date: '2026-09-17', close: 137.95 });
    assert.deepEqual(drawdown?.latest, { date: '2026-10-20', close: 130.28 });
    assert.ok(Math.abs((drawdown?.drawdown ?? 0) - 0.0556) < 0.0001);
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
