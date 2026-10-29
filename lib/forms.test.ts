import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { afterSecurityAdded, formFields, parseId, shortfallMessage } from './forms';

describe('formFields', () => {
  it('keeps text fields and drops files', () => {
    const form = new FormData();
    form.set('ticker', 'VT');
    form.set('file', new Blob(['x']), 'statement.csv');
    assert.deepEqual(formFields(form), { ticker: 'VT' });
  });
});

describe('parseId', () => {
  it('accepts positive whole numbers only', () => {
    assert.equal(parseId('12'), 12);
    for (const raw of [undefined, null, '', '0', '-3', '1.5', '1e3', 'abc', '99999999999999999999']) {
      assert.equal(parseId(raw), undefined, String(raw));
    }
  });
});

describe('afterSecurityAdded', () => {
  it('goes back to the trade being edited', () => {
    assert.equal(afterSecurityAdded('/holdings/42', 'AAPL'), '/holdings/42');
  });

  it('shows the close-this-tab note for the CSV import', () => {
    assert.equal(afterSecurityAdded('tab', 'BRK.B'), '/securities/new?added=BRK.B');
  });

  it('opens a new trade in the ticker otherwise, ignoring outside or odd paths', () => {
    for (const next of [undefined, '', '/holdings/new', 'https://example.com', '//example.com', '/holdings/42/../../x']) {
      assert.equal(afterSecurityAdded(next, 'VT'), '/holdings?ticker=VT#add-trade', String(next));
    }
  });
});

describe('shortfallMessage', () => {
  it('names the sell and the missing quantity in both languages', () => {
    const message = shortfallMessage({ ticker: 'VT', pool: 'regular', tradeDate: '2026-10-15', missingQty: 1.5 });
    assert.equal(message.en, 'This leaves the VT sell on 2026-10-15 1.5 units larger than the holding.');
    assert.equal(message.zh, '這會讓 2026-10-15 賣出的 VT 比持有數量多 1.5 單位。');
  });
});
