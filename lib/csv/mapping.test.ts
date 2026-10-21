import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { guessMapping, mappingKey, missingColumns, parseMapping, parseSavedMapping, reconcile, type CsvMapping } from './mapping';
import { readStatement } from './plan';
import { ROC_STATEMENT, TW_STATEMENT, US_STATEMENT } from './test-fixtures';

function guess(text: string, headerRow: number): CsvMapping {
  const statement = readStatement(text, ',', headerRow);
  return guessMapping(
    statement.headers,
    statement.rows.map((row) => row.cells),
    { encoding: 'auto', delimiter: ',', headerRow },
  );
}

describe('guessMapping', () => {
  it('maps a Taiwanese statement: trade date (not settlement date), filled price (not amount), both fee columns', () => {
    const mapping = guess(TW_STATEMENT, 3);
    assert.deepEqual(
      [mapping.tradeDate, mapping.ticker, mapping.side, mapping.qty, mapping.price, mapping.currency, mapping.fee, mapping.tax, mapping.fxRate, mapping.note],
      ['成交日期', '股票代號', '買賣別', '成交股數', '成交價格', '幣別', ['手續費', '其他費用'], [], null, null],
    );
    assert.equal(mapping.dateFormat, 'ymd');
    assert.deepEqual(missingColumns(mapping), []);
    // The amount column is read for dividend rows only.
    assert.equal(mapping.amount, '成交金額');
  });

  it('maps a US statement without taking "Transaction ID" for the side', () => {
    const mapping = guess(US_STATEMENT, 1);
    assert.deepEqual(
      [mapping.tradeDate, mapping.ticker, mapping.side, mapping.qty, mapping.price, mapping.currency, mapping.fee, mapping.tax],
      ['Trade Date', 'Symbol', 'Action', 'Quantity', 'Price', null, ['Commission', 'Fees'], []],
    );
    assert.equal(mapping.dateFormat, 'mdy');
    assert.equal(mapping.amount, 'Amount');
  });

  it('maps a statement with ROC dates and a tax column', () => {
    const mapping = guess(ROC_STATEMENT, 1);
    assert.equal(mapping.dateFormat, 'roc');
    assert.deepEqual([mapping.fee, mapping.tax], [['手續費'], ['交易稅']]);
  });

  it('leaves unknown headers unmapped and says which columns are still needed', () => {
    const mapping = guess('A,B,C\n1,2,3', 1);
    assert.deepEqual(missingColumns(mapping), ['tradeDate', 'ticker', 'side', 'qty', 'price']);
    assert.deepEqual(missingColumns({ ...mapping, tradeDate: 'A', ticker: 'B', qty: 'C', price: 'C', sideFromSign: true }), []);
  });
});

describe('parseMapping', () => {
  const mapping = guess(TW_STATEMENT, 3);

  it('accepts a mapping that went through JSON', () => {
    assert.deepEqual(parseMapping(JSON.parse(JSON.stringify(mapping))), mapping);
  });

  it('reads a mapping saved before dividends were imported, with no amount column yet', () => {
    const { amount: _amount, dividendWords: _words, ...older } = mapping;
    const parsed = parseMapping(JSON.parse(JSON.stringify(older)));
    assert.equal(parsed?.amount, null);
    assert.ok(parsed?.dividendWords.includes('股利'));
    // Applied to a file, the amount column is guessed again.
    const statement = readStatement(TW_STATEMENT, ',', 3);
    assert.equal(parsed && reconcile(parsed, statement.headers, mapping).mapping.amount, '成交金額');
  });

  it('refuses anything incomplete or out of range', () => {
    const { ticker: _ticker, ...withoutTicker } = mapping;
    for (const bad of [
      null,
      [],
      'mapping',
      withoutTicker,
      { ...mapping, delimiter: '|' },
      { ...mapping, headerRow: 0 },
      { ...mapping, headerRow: 1.5 },
      { ...mapping, dateFormat: 'iso' },
      { ...mapping, fee: '手續費' },
      { ...mapping, buyWords: [''] },
      { ...mapping, price: 'x'.repeat(201) },
      { ...mapping, sideFromSign: 'yes' },
    ]) {
      assert.equal(parseMapping(bad), undefined, JSON.stringify(bad)?.slice(0, 60));
    }
  });
});

describe('mappingKey', () => {
  it('makes a config key from an English broker name', () => {
    assert.equal(mappingKey('Firstrade'), 'csv_mapping.firstrade');
    assert.equal(mappingKey('  Interactive   Brokers '), 'csv_mapping.interactive_brokers');
    assert.equal(mappingKey('interactive brokers'), mappingKey('INTERACTIVE BROKERS'));
  });

  it('encodes a Chinese name, since keys allow only a-z, 0-9, "_" and "."', () => {
    assert.equal(mappingKey('國泰'), 'csv_mapping.ue59c8be6b3b0');
    for (const name of ['國泰證券 複委託', 'Cathay 國泰', 'Firstrade', '永豐金 Sub-brokerage']) {
      assert.match(mappingKey(name), /^[a-z][a-z0-9_.]*$/, name);
    }
    assert.notEqual(mappingKey('國泰'), mappingKey('富邦'));
  });
});

describe('parseSavedMapping', () => {
  it('reads what the import saves, and nothing else', () => {
    const mapping = guess(US_STATEMENT, 1);
    assert.deepEqual(parseSavedMapping({ broker: 'Firstrade', mapping }), { broker: 'Firstrade', mapping });
    assert.equal(parseSavedMapping({ broker: '', mapping }), undefined);
    assert.equal(parseSavedMapping({ broker: 'Firstrade', mapping: {} }), undefined);
    assert.equal(parseSavedMapping(42), undefined);
  });
});

describe('reconcile', () => {
  const saved = { ...guess(US_STATEMENT, 1), note: 'Transaction ID', currency: null };

  it('keeps every saved column the new file still has', () => {
    const { mapping, lost } = reconcile(saved, readStatement(US_STATEMENT, ',', 1).headers, guess(US_STATEMENT, 1));
    assert.deepEqual(mapping, saved);
    assert.deepEqual(lost, []);
  });

  it('falls back to the guess for columns a new export renamed, and names them', () => {
    const renamed = US_STATEMENT.replace('"Symbol"', '"Ticker"').replace('"Fees"', '"Reg Fee"').replace('"Transaction ID"', '"Ref"');
    const { mapping, lost } = reconcile(saved, readStatement(renamed, ',', 1).headers, guess(renamed, 1));
    assert.equal(mapping.ticker, 'Ticker');
    assert.deepEqual(mapping.fee, ['Commission']);
    assert.equal(mapping.note, null);
    assert.equal(mapping.currency, null);
    assert.deepEqual(lost, ['Symbol', 'Fees', 'Transaction ID']);
  });
});
