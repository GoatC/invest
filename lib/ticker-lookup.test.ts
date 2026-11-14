import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chartUrl, fromChart, lookupSymbols, lookupTicker, productTypeOf, TWSE_DAY_ALL, twseNames } from './ticker-lookup';

/** Yahoo's chart reply, cut to what is read (the shape of a real reply on 2026-11-15). */
const chart = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }], error: null } });
const NOT_FOUND = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };

describe('looking up a ticker the app does not know (proposal G05)', () => {
  it('looks in Taiwan for a code of digits, else in the US and then London', () => {
    assert.deepEqual(lookupSymbols('2330'), [{ symbol: '2330.TW', market: 'TW' }, { symbol: '2330.TWO', market: 'TW' }]);
    assert.deepEqual(lookupSymbols('00990a'), [{ symbol: '00990A.TW', market: 'TW' }, { symbol: '00990A.TWO', market: 'TW' }]);
    assert.deepEqual(lookupSymbols(' nvda '), [{ symbol: 'NVDA', market: 'US' }, { symbol: 'NVDA.L', market: 'UK' }]);
    assert.deepEqual(lookupSymbols('VT/../x'), []);
  });

  it('tells the product type from the kind and the name; a theme ETF stays an equity ETF for Hugo to change', () => {
    assert.equal(productTypeOf('EQUITY', 'NVIDIA Corporation'), 'stock');
    assert.equal(productTypeOf('ETF', 'SPDR Gold MiniShares'), 'gold');
    assert.equal(productTypeOf('ETF', 'SPDR Bloomberg 1-3 Month T-Bill ETF'), 'cash_mmf');
    assert.equal(productTypeOf('ETF', 'Vanguard Total World Bond ETF'), 'bond_etf');
    assert.equal(productTypeOf('ETF', 'iShares Core Global Aggregate Bond UCITS ETF'), 'bond_etf');
    assert.equal(productTypeOf('ETF', 'Vanguard Total World Stock Index Fund ETF Shares'), 'equity_etf');
    assert.equal(productTypeOf('MUTUALFUND', 'x'), null);
  });

  it('reads a US stock, a London UCITS fund and a Taiwan ETF with its Chinese name', () => {
    assert.deepEqual(fromChart(chart({ instrumentType: 'EQUITY', currency: 'USD', longName: 'NVIDIA Corporation' }), 'US'), { name: 'NVIDIA Corporation', market: 'US', productType: 'stock', currency: 'USD', domicile: 'US' });
    assert.deepEqual(fromChart(chart({ instrumentType: 'ETF', currency: 'USD', longName: 'iShares Core S&P 500 UCITS ETF USD (Acc)' }), 'UK'), { name: 'iShares Core S&P 500 UCITS ETF USD (Acc)', market: 'UK', productType: 'equity_etf', currency: 'USD', domicile: 'IE' });
    assert.deepEqual(fromChart(chart({ instrumentType: 'ETF', currency: 'TWD', longName: 'Fubon TWSE Corporate Governance 100 ETF' }), 'TW', '富邦公司治理'), { name: '富邦公司治理', market: 'TW', productType: 'equity_etf', currency: 'TWD', domicile: 'TW' });
    assert.equal(fromChart(chart({ instrumentType: 'ETF', currency: 'GBp', longName: 'Some London Fund' }), 'UK')?.currency, 'GBP');
  });

  it('finds nothing in a reply for a ticker Yahoo does not know', () => {
    assert.equal(fromChart(NOT_FOUND, 'US'), null);
    assert.equal(fromChart(null, 'US'), null);
  });

  it('reads TWSE’s list as code to Chinese name', () => {
    const names = twseNames([{ Date: '1151114', Code: '00692', Name: '富邦公司治理' }, { Code: '2330', Name: '台積電' }, { junk: 1 }]);
    assert.equal(names.get('00692'), '富邦公司治理');
    assert.equal(names.get('2330'), '台積電');
    assert.equal(names.size, 2);
  });

  it('tries the next place when the first does not know the ticker, and gives up quietly when the web cannot be reached', async () => {
    const replies: Record<string, unknown> = {
      [chartUrl('AGGU')]: NOT_FOUND,
      [chartUrl('AGGU.L')]: chart({ instrumentType: 'ETF', currency: 'USD', longName: 'iShares Core Global Aggregate Bond UCITS ETF USD Hedged (Acc)' }),
      [chartUrl('2330.TW')]: chart({ instrumentType: 'EQUITY', currency: 'TWD', longName: 'Taiwan Semiconductor Manufacturing Company Limited' }),
      [TWSE_DAY_ALL]: [{ Code: '2330', Name: '台積電' }],
    };
    const get = async (url: string) => {
      if (!(url in replies)) throw new Error('offline');
      return replies[url];
    };
    assert.deepEqual(await lookupTicker('aggu', get), { name: 'iShares Core Global Aggregate Bond UCITS ETF USD Hedged (Acc)', market: 'UK', productType: 'bond_etf', currency: 'USD', domicile: 'IE' });
    assert.deepEqual(await lookupTicker('2330', get), { name: '台積電', market: 'TW', productType: 'stock', currency: 'TWD', domicile: 'TW' });
    assert.equal(await lookupTicker('ZZZZQ', get), null);
  });
});
