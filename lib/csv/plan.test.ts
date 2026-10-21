import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rateHistory } from '../models/fx';
import { SECURITIES, trade } from '../models/test-helpers';
import type { Security } from '../models/types';
import { guessMapping, type CsvMapping } from './mapping';
import { planImport, readStatement, tradesToImport, type ImportContext, type ImportOptions } from './plan';
import { ROC_STATEMENT, TW_STATEMENT, US_STATEMENT } from './test-fixtures';

const ALL_SECURITIES: Security[] = [
  ...SECURITIES,
  { ticker: '00692', name: '富邦公司治理', market: 'TW', productType: 'equity_etf', assetClassId: 'tw_market_cap', sleeve: 'core', currency: 'TWD' },
];

function context(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    securities: new Map(ALL_SECURITIES.map((security) => [security.ticker, security])),
    existing: [],
    today: '2026-10-21',
    fx: new Map([['USD', { value: 32.4, date: '2026-10-20', estimated: false }]]),
    fxMaxGap: 0.2,
    rates: rateHistory([]),
    fxMaxAgeDays: 10,
    ...overrides,
  };
}

/** Bank of Taiwan rates around the demo statements' dates (2026-10-07 and 2026-10-08). */
const RATES = rateHistory([
  { pair: 'USD/TWD', date: '2026-10-06', rate: 32.25 },
  { pair: 'USD/TWD', date: '2026-10-07', rate: 32.28 },
]);

const OPTIONS: ImportOptions = { pool: 'regular', fixedFxRate: 32.3 };

function plan(text: string, headerRow: number, change: Partial<CsvMapping> = {}, options = OPTIONS, ctx = context()) {
  const statement = readStatement(text, ',', headerRow);
  const mapping = { ...guessMapping(statement.headers, statement.rows.map((row) => row.cells), { encoding: 'auto', delimiter: ',', headerRow }), ...change };
  return planImport(statement, mapping, options, ctx);
}

describe('readStatement', () => {
  it('numbers rows as a spreadsheet does and drops blank ones', () => {
    const statement = readStatement(TW_STATEMENT, ',', 3);
    assert.equal(statement.headers.length, 12);
    assert.deepEqual(
      statement.rows.map((row) => row.line),
      [4, 5, 7],
    );
    assert.equal(statement.rows[0]?.cells['股票代號'], 'VT');
  });
});

describe('planImport', () => {
  it('reads a Taiwanese statement into trades, summing both fee columns, and skips the totals row', () => {
    const rows = plan(TW_STATEMENT, 3);
    assert.match(rows[2]?.problems[0]?.en ?? '', /not a trade row/);
    assert.deepEqual(
      rows.map((row) => [row.line, row.status]),
      [
        [4, 'new'],
        [5, 'new'],
        [7, 'invalid'],
      ],
    );
    assert.deepEqual(rows[1]?.trade, {
      tradeDate: '2026-10-08',
      ticker: 'AAPL',
      side: 'sell',
      qty: 1,
      price: 236,
      currency: 'USD',
      fee: 1.02,
      tax: 0,
      fxRate: 32.3,
      pool: 'regular',
      note: null,
    });
  });

  it('reads a US statement: negative quantities become positive sells, a dividend is not a trade', () => {
    const rows = plan(US_STATEMENT, 1);
    assert.deepEqual(
      rows.map((row) => [row.status, row.trade?.side, row.trade?.qty, row.trade?.fee]),
      [
        ['new', 'buy', 2, 1],
        ['new', 'sell', 1, 1.02],
        ['invalid', undefined, undefined, undefined],
      ],
    );
    assert.match(rows[2]?.problems[0]?.en ?? '', /Not a buy or a sell/);
  });

  it('reads ROC dates and Taiwan codes kept as ="00692"; TWD trades need no FX rate', () => {
    const rows = plan(ROC_STATEMENT, 1, {}, { pool: 'regular', fixedFxRate: null });
    assert.deepEqual(
      rows.map((row) => [row.status, row.trade?.tradeDate, row.trade?.ticker, row.trade?.fxRate, row.trade?.tax]),
      [
        ['new', '2026-10-07', '00692', 1, 0],
        ['new', '2026-10-15', '00692', 1, 1.84],
      ],
    );
  });

  it('can read the side from the quantity sign instead of a column', () => {
    const rows = plan(US_STATEMENT, 1, { side: null, sideFromSign: true });
    assert.deepEqual(
      rows.slice(0, 2).map((row) => row.trade?.side),
      ['buy', 'sell'],
    );
  });

  it('asks for an FX rate when a foreign trade has none and no rate is loaded for its date', () => {
    const [row] = plan(TW_STATEMENT, 3, {}, { pool: 'regular', fixedFxRate: null });
    assert.equal(row?.status, 'invalid');
    assert.match(row?.problems[0]?.en ?? '', /none for this USD trade, and no rate loaded for its date/);
  });

  it("fills a missing rate with the trade date's rate, or the newest one before it", () => {
    const rows = plan(TW_STATEMENT, 3, {}, { pool: 'regular', fixedFxRate: null }, context({ rates: RATES }));
    assert.deepEqual(
      rows.slice(0, 2).map((row) => [row.status, row.trade?.fxRate, row.fxRateDate]),
      [
        ['new', 32.28, '2026-10-07'],
        ['new', 32.28, '2026-10-07'],
      ],
    );
    // A rate older than config fx_rate_check max_age_days allows is no default.
    const strict = plan(TW_STATEMENT, 3, {}, { pool: 'regular', fixedFxRate: null }, context({ rates: RATES, fxMaxAgeDays: 0 }));
    assert.deepEqual(
      strict.slice(0, 2).map((row) => row.status),
      ['new', 'invalid'],
    );
  });

  it('prefers a rate from the file, then the one typed for the file, over the loaded rate', () => {
    const [typed] = plan(TW_STATEMENT, 3, {}, OPTIONS, context({ rates: RATES }));
    assert.deepEqual([typed?.trade?.fxRate, typed?.fxRateDate], [32.3, undefined]);
    const withColumn = TW_STATEMENT.replace('其他費用,幣別', '其他費用,幣別,匯率').replace('0.00,USD', '0.00,USD,32.31');
    const [fromFile] = plan(withColumn, 3, {}, OPTIONS, context({ rates: RATES }));
    assert.equal(fromFile?.trade?.fxRate, 32.31);
  });

  it("warns, without stopping, when a rate is far from the trade date's rate, else the latest known one", () => {
    const [row] = plan(TW_STATEMENT, 3, {}, { pool: 'regular', fixedFxRate: 3.24 });
    assert.equal(row?.status, 'new');
    assert.match(row?.warnings[0]?.en ?? '', /more than 20% away from 32.4 \(2026-10-20\)/);
    const [dated] = plan(TW_STATEMENT, 3, {}, { pool: 'regular', fixedFxRate: 3.24 }, context({ rates: RATES }));
    assert.match(dated?.warnings[0]?.en ?? '', /more than 20% away from 32.28 \(2026-10-07\)/);
  });

  it('marks unknown tickers so they can be added as securities', () => {
    const rows = plan(US_STATEMENT, 1, {}, OPTIONS, context({ securities: new Map(ALL_SECURITIES.filter((s) => s.ticker !== 'AAPL').map((s) => [s.ticker, s])) }));
    assert.deepEqual([rows[1]?.status, rows[1]?.ticker], ['unknown', 'AAPL']);
  });

  it('applies the trade form checks, such as no dates in the future', () => {
    const rows = plan(TW_STATEMENT, 3, {}, OPTIONS, context({ today: '2026-10-07' }));
    assert.deepEqual(
      rows.map((row) => row.status),
      ['new', 'invalid', 'invalid'],
    );
    assert.match(rows[1]?.problems[0]?.zh ?? '', /交易日：日期不能晚於今天/);
  });

  it('puts the pool chosen for the import on every trade', () => {
    const [row] = plan(TW_STATEMENT, 3, {}, { pool: 'windfall', fixedFxRate: 32.3 });
    assert.equal(row?.trade?.pool, 'windfall');
  });

  it('skips rows already saved, one for one', () => {
    const saved = trade({ id: 9, tradeDate: '2026-10-07', ticker: 'VT', qty: 2, price: 150, fee: 0.5 });
    const twice = TW_STATEMENT.replace('\r\n2026/10/08', '\r\n2026/10/07,2026/10/09,美國,VT,Vanguard Total World,買進,2,150.00,300.00,1.00,0.00,USD\r\n2026/10/08');
    const rows = plan(twice, 3, {}, OPTIONS, context({ existing: [saved] }));
    assert.deepEqual(
      rows.map((row) => row.status),
      ['duplicate', 'new', 'new', 'invalid'],
    );
  });
});

describe('planImport on a statement imported before', () => {
  it('reports saved rows as already saved even without an FX rate, with nothing to keep', () => {
    const saved = trade({ id: 9, tradeDate: '2026-10-07', ticker: 'VT', qty: 2, price: 150, fee: 1 });
    const rows = plan(TW_STATEMENT, 3, {}, { pool: 'regular', fixedFxRate: null }, context({ existing: [saved] }));
    assert.deepEqual(
      rows.map((row) => [row.status, row.trade, row.problems.length]),
      [
        ['duplicate', null, 0],
        ['invalid', null, 1],
        ['invalid', null, 1],
      ],
    );
    assert.deepEqual(tradesToImport(rows, new Set([4])), []);
  });
});

describe('tradesToImport', () => {
  it('saves new rows and the duplicates kept, oldest first and buys before sells on a day', () => {
    // Newest first, as many statements list them, with a same-day sell above its buy.
    const text = [
      'Trade Date,Symbol,Action,Quantity,Price',
      '2026-10-09,VT,Sell,1,152',
      '2026-10-09,VT,Buy,1,151',
      '2026-10-08,VT,Buy,1,150',
    ].join('\n');
    const saved = trade({ id: 1, tradeDate: '2026-10-08', ticker: 'VT', qty: 1, price: 150 });
    const rows = plan(text, 1, {}, OPTIONS, context({ existing: [saved] }));
    assert.deepEqual(
      rows.map((row) => row.status),
      ['new', 'new', 'duplicate'],
    );
    assert.deepEqual(
      tradesToImport(rows, new Set()).map((t) => [t.tradeDate, t.side]),
      [
        ['2026-10-09', 'buy'],
        ['2026-10-09', 'sell'],
      ],
    );
    assert.deepEqual(
      tradesToImport(rows, new Set([4])).map((t) => [t.tradeDate, t.side]),
      [
        ['2026-10-08', 'buy'],
        ['2026-10-09', 'buy'],
        ['2026-10-09', 'sell'],
      ],
    );
  });
});
