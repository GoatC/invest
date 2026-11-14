import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { logoUrl, markText } from './ticker-mark';

describe('a holding’s mark in the iOS shell (proposal C03)', () => {
  it('asks for a logo by the ticker, with the market’s suffix', () => {
    assert.equal(logoUrl('NVDA', 'US'), 'https://financialmodelingprep.com/image-stock/NVDA.png');
    assert.equal(logoUrl('2330', 'TW'), 'https://financialmodelingprep.com/image-stock/2330.TW.png');
    assert.equal(logoUrl('aggu', 'UK'), 'https://financialmodelingprep.com/image-stock/AGGU.L.png');
  });

  it('asks for none for a non-listed asset or a ticker that is not one', () => {
    assert.equal(logoUrl(null, null), null);
    assert.equal(logoUrl('VT', null), null);
    assert.equal(logoUrl('VT/../x', 'US'), null);
    assert.equal(logoUrl('', 'US'), null);
  });

  it('puts the whole ticker on the badge, or the first two characters of a label', () => {
    assert.equal(markText('00692', '富邦公司治理'), '00692');
    assert.equal(markText('009816', '凱基台灣TOP50'), '009816');
    assert.equal(markText(null, '實體黃金（克）'), '實體');
    assert.equal(markText('BRK.B', ''), 'BRK.B');
  });
});
