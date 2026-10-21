import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite, Transaction } from '@electric-sql/pglite';

import { as, errorCode, freshDatabase, OWNER_ID, publicTables, STRANGER_ID } from './harness.ts';

// SQLSTATE codes. 42501 covers both a missing privilege and a row-level security refusal.
const DENIED = '42501';
const CHECK_FAILED = '23514';
const KEY_MISSING = '23503';

// PRD Section 7 lists 19 tables; Web Push adds push_subscriptions and the N5 audit log adds audit_log.
const EXPECTED_TABLES = [
  'asset_classes', 'securities', 'transactions', 'cash_flows', 'prices', 'fx_rates', 'nav_snapshots',
  'rules', 'rule_changes', 'proposals', 'windfall_tranches', 'valuations', 'beta_results', 'red_flags',
  'attribution', 'config', 'watchlist', 'windfall_plan', 'manual_assets', 'push_subscriptions', 'audit_log',
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
  it('create the 19 PRD Section 7 tables plus push_subscriptions and audit_log', async () => {
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
      await tx.query(`update public.rules set enabled = enabled where id = 'R2'`);
      await tx.query(`update public.config set value = value where key = 'quiet_hours'`);
      assert.equal(await scalar(tx, 'select count(*) from public.rule_changes'), 0);
      assert.equal(await scalar(tx, 'select count(*) from public.audit_log'), 0);
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
