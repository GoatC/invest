import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  brokerChoices,
  brokerValue,
  costOverPlan,
  fundChoices,
  fundCostValue,
  fundDrag,
  minimumUpTo,
  orderCost,
  planForCosts,
  portfolioCost,
  quoteOrder,
  readBrokers,
  readFeeSettings,
  readFundCosts,
  readSchedule,
  readTaxSettings,
  scheduleFee,
  taxSettingsValue,
  twCommission,
  twTransactionTax,
  type Broker,
  type FeeSettings,
  type FundCost,
  type TaxSettings,
} from './costs';
import { futureValue } from './projection';
import { holding } from './test-helpers';

const TAX: TaxSettings = {
  withholding: { US: 0.3, IE: 0.15, TW: 0 },
  twTransactionTax: { stock: 0.003, etf: 0.001, bondEtf: 0 },
  amt: { overseasFloorTwd: 1_000_000, exemptionTwd: 7_500_000, rate: 0.2 },
  nhi: { rate: 0.0211, singlePaymentTwd: 20_000, maxPaymentTwd: 10_000_000 },
  usEstate: { minRate: 0.18, maxRate: 0.4 },
};

function broker(overrides: Partial<Broker> = {}): Broker {
  return {
    id: 'cathay',
    nameEn: 'Cathay',
    nameZh: '國泰',
    usStock: { rate: 0.0008, min: 0, max: null, flat: null },
    usEtf: { rate: 0, min: 0, max: null, flat: 3 },
    usDca: { rate: 0, min: 0, max: null, flat: 0.1 },
    uk: null,
    lseEtfs: null,
    custodyRate: 0,
    fxSpread: null,
    promoUntil: '2026-12-31',
    noteEn: '',
    noteZh: '',
    source: '',
    checked: null,
    ...overrides,
  };
}

/** A listed-rate broker: 0.5% with a US$35 minimum. */
const LISTED = broker({ id: 'listed', nameEn: 'Listed rate', nameZh: '牌告', usStock: { rate: 0.005, min: 35, max: null, flat: null }, usEtf: null, usDca: null, promoUntil: null });

function fund(overrides: Partial<FundCost> = {}): FundCost {
  return {
    ticker: 'VT',
    name: 'Vanguard Total World Stock ETF',
    assetClassId: 'us_global_equity',
    domicile: 'US',
    market: 'US',
    distribution: 'dist',
    ter: 0.0006,
    yield: 0.018,
    withholding: null,
    trackingDifference: null,
    noteEn: '',
    noteZh: '',
    source: '',
    checked: null,
    ...overrides,
  };
}

const SETTINGS: FeeSettings = { brokerId: 'cathay', tw: { rate: 0.001425, discount: 1, minTwd: 20 }, fxSpread: 0.001 };

/** The PRD F2 acceptance plan: NT$10,000 a month at 6% for 30 years. */
const PLAN = { pv: 0, pmt: 10_000, stepUp: 0, expectedReturn: 0.06, inflation: 0.02, years: 30 };

describe('fee schedules', () => {
  it('charges the flat fee, else the rate within the minimum and the maximum', () => {
    assert.equal(scheduleFee({ rate: 0.0008, min: 0, max: null, flat: null }, 155), 0.124);
    assert.equal(scheduleFee({ rate: 0, min: 0, max: null, flat: 3 }, 155), 3);
    assert.equal(scheduleFee({ rate: 0.005, min: 35, max: null, flat: null }, 155), 35);
    assert.equal(scheduleFee({ rate: 0.001, min: 0, max: 1, flat: null }, 2000), 1);
    assert.equal(scheduleFee({ rate: 0, min: 0, max: null, flat: 3 }, 0), 0);
  });

  it('says up to what order the minimum fee applies', () => {
    assert.equal(minimumUpTo({ rate: 0.005, min: 35, max: null, flat: null }), 7000);
    assert.equal(minimumUpTo({ rate: 0, min: 0, max: null, flat: 3 }), null);
    assert.equal(minimumUpTo({ rate: 0.0008, min: 0, max: null, flat: null }), null);
  });

  it('charges a Taiwan order 0.1425% × the discount, rounded down, at least the minimum, and a sale the transaction tax', () => {
    assert.equal(twCommission(5000, { rate: 0.001425, discount: 1, minTwd: 20 }), 20);
    assert.equal(twCommission(100_000, { rate: 0.001425, discount: 0.6, minTwd: 20 }), 85);
    assert.equal(twTransactionTax(9200, 'equity_etf', TAX), 9);
    assert.equal(twTransactionTax(7215, 'stock', TAX), 21);
    assert.equal(twTransactionTax(50_000, 'bond_etf', TAX), 0);
  });
});

describe('orderCost', () => {
  const settings = { broker: broker(), tw: SETTINGS.tw, tax: TAX };

  it('estimates a Taiwan buy and sale in TWD, the sale with its tax', () => {
    assert.deepEqual(orderCost({ side: 'buy', qty: 3, price: 2405, currency: 'TWD', fxRate: 1 }, { market: 'TW', productType: 'stock' }, settings), { fee: 20, tax: 0, feeTwd: 20, taxTwd: 0, known: true });
    assert.deepEqual(orderCost({ side: 'sell', qty: 100, price: 92, currency: 'TWD', fxRate: 1 }, { market: 'TW', productType: 'equity_etf' }, settings), { fee: 20, tax: 9, feeTwd: 20, taxTwd: 9, known: true });
  });

  it("estimates a 複委託 order in dollars from the chosen broker's ETF or share schedule", () => {
    const etf = orderCost({ side: 'buy', qty: 2, price: 157.8, currency: 'USD', fxRate: 32.4 }, { market: 'US', productType: 'equity_etf' }, settings);
    assert.equal(etf.fee, 3);
    assert.ok(Math.abs(etf.feeTwd - 97.2) < 1e-9);
    const share = orderCost({ side: 'buy', qty: 1, price: 236, currency: 'USD', fxRate: 32.4 }, { market: 'US', productType: 'stock' }, settings);
    assert.equal(share.fee, 0.19);
  });

  it('knows nothing without a broker chosen, or for London when the broker has no London prices', () => {
    assert.equal(orderCost({ side: 'buy', qty: 1, price: 100, currency: 'USD', fxRate: 32 }, { market: 'US', productType: 'equity_etf' }, { ...settings, broker: null }).known, false);
    assert.equal(orderCost({ side: 'buy', qty: 1, price: 5.8, currency: 'USD', fxRate: 32 }, { market: 'UK', productType: 'bond_etf' }, settings).known, false);
  });
});

describe('fund drag', () => {
  it('adds the TER and the yield lost to withholding at the domicile’s rate, or the fund’s own', () => {
    const vt = fundDrag(fund(), TAX);
    assert.equal(vt.withholding, 0.3);
    assert.ok(Math.abs((vt.withholdingDrag ?? 0) - 0.0054) < 1e-12);
    assert.ok(Math.abs((vt.total ?? 0) - 0.006) < 1e-12);
    const cspx = fundDrag(fund({ ticker: 'CSPX', domicile: 'IE', market: 'UK', distribution: 'acc', ter: 0.0007, yield: 0.012 }), TAX);
    assert.ok(Math.abs((cspx.total ?? 0) - 0.0025) < 1e-12);
    const vwra = fundDrag(fund({ ticker: 'VWRA', domicile: 'IE', market: 'UK', ter: 0.0019, withholding: 0.09 }), TAX);
    assert.ok(Math.abs((vwra.total ?? 0) - (0.0019 + 0.018 * 0.09)) < 1e-12);
  });

  it('needs the yield only when something is withheld on it', () => {
    assert.equal(fundDrag(fund({ yield: null }), TAX).total, null);
    assert.equal(fundDrag(fund({ ticker: '00692', domicile: 'TW', market: 'TW', ter: 0.00185, yield: null }), TAX).total, 0.00185);
    assert.equal(fundDrag(fund({ ticker: 'GLDM', ter: 0.001, yield: 0 }), undefined).total, 0.001);
    assert.equal(fundDrag(fund({ ter: null }), TAX).total, null);
  });

  it("totals the holdings' yearly cost, custody on what is held abroad, and the value not known yet", () => {
    const funds = new Map([
      ['VT', fund()],
      ['00692', fund({ ticker: '00692', domicile: 'TW', market: 'TW', ter: 0.00185, yield: null })],
    ]);
    const cost = portfolioCost(
      [
        holding({ valueTwd: 100_000 }),
        holding({ key: 'regular:00692', ticker: '00692', market: 'TW', currency: 'TWD', valueTwd: 50_000 }),
        holding({ key: 'manual:1', ticker: null, market: null, productType: 'gold', valueTwd: 20_000 }),
        holding({ key: 'regular:AAPL', ticker: 'AAPL', productType: 'stock', valueTwd: 7_646 }),
        holding({ key: 'regular:BIL', ticker: 'BIL', valueTwd: null }),
      ],
      funds,
      TAX,
      broker({ custodyRate: 0.001 }),
    );
    assert.deepEqual(
      cost.rows.map((row) => [row.key, row.yearlyTwd === null ? null : Math.round(row.yearlyTwd * 100) / 100]),
      [
        ['regular:VT', 700],
        ['regular:00692', 92.5],
        ['manual:1', 0],
        ['regular:AAPL', null],
      ],
    );
    assert.equal(cost.valueTwd, 177_646);
    assert.equal(cost.unknownTwd, 7_646);
    assert.ok(Math.abs(cost.yearlyTwd - 792.5) < 1e-9);
    assert.ok(Math.abs((cost.rate ?? 0) - 792.5 / 170_000) < 1e-12);
  });
});

describe('brokers on a typical order', () => {
  it('adds the fee in dollars and the FX spread, as a share of the order', () => {
    const quote = quoteOrder({ rate: 0, min: 0, max: null, flat: 3 }, 5000, 32, 0.001);
    assert.deepEqual(quote, { feeUsd: 3, feeTwd: 96, fxTwd: 5, costTwd: 101, share: 0.0202 });
    assert.equal(quoteOrder(null, 5000, 32, 0.001), null);
  });

  it('ranks brokers by their cost over the plan, and flags a minimum fee and an ended promotion', () => {
    const choices = brokerChoices([LISTED, broker({ promoUntil: '2026-03-31' })], { plan: PLAN, foreignShare: 0.68, orderTwd: 5000, usdTwd: 32, settings: SETTINGS, today: '2026-10-22' });
    assert.deepEqual(
      choices.map((choice) => choice.broker.id),
      ['cathay', 'listed'],
    );
    const [cathay, listed] = choices as [(typeof choices)[number], (typeof choices)[number]];
    assert.equal(cathay.promoEnded, true);
    assert.equal(cathay.dca?.feeUsd, 0.1);
    assert.equal(listed.minimumUpToUsd, 7000);
    // US$35 on a US$156 order is 22.4%, plus 0.1% FX.
    assert.ok(Math.abs((listed.order?.share ?? 0) - (35 * 32 + 5) / 5000) < 1e-12);
    assert.ok((listed.overPlan?.cost ?? 0) > (cathay.overPlan?.cost ?? 0));
  });
});

describe('costOverPlan', () => {
  it('takes a trading cost off every contribution: with no starting value, that share of the final value', () => {
    const cost = costOverPlan(PLAN, 0, 0.01);
    // PRD Section 11: NT$10,000 a month at 6% for 30 years ≈ NT$10,045,000.
    assert.ok(Math.abs(cost.base - 10_045_000) < 1_000);
    assert.ok(Math.abs(cost.cost - cost.base * 0.01) < 1e-6);
  });

  it('takes a yearly drag off the expected return, month by month', () => {
    const cost = costOverPlan(PLAN, 0.01, 0);
    const after = futureValue({ pv: 0, pmt: 10_000, g: 0, months: 360, r: 0.05 / 12 });
    assert.ok(Math.abs(cost.after - after) < 1e-6);
    assert.ok(Math.abs(cost.cost - (cost.base - after)) < 1e-6);
  });
});

describe('planForCosts', () => {
  const unsaved = { start: null, pv: null, pmt: null, stepUp: 0, expectedReturn: null, inflation: 0.02, years: 30 };

  it("uses the saved plan, else the calculator's starting values, and nothing without an expected return", () => {
    const saved = { ...unsaved, start: '2026-11', pv: 0, pmt: 10_000, expectedReturn: 0.06 };
    assert.deepEqual(planForCosts(saved, { poolTwd: 1, dcaTwd: 1, mixReturn: 0.01 }), { plan: { start: '2026-11', pv: 0, pmt: 10_000, stepUp: 0, expectedReturn: 0.06, inflation: 0.02, years: 30 }, saved: true });
    assert.deepEqual(planForCosts(unsaved, { poolTwd: 97_501, dcaTwd: 10_000, mixReturn: 0.05 }), { plan: { pv: 97_501, pmt: 10_000, stepUp: 0, expectedReturn: 0.05, inflation: 0.02, years: 30 }, saved: false });
    assert.equal(planForCosts(unsaved, { poolTwd: 97_501, dcaTwd: 10_000, mixReturn: null }), null);
    assert.equal(planForCosts(undefined, { poolTwd: 1, dcaTwd: 1, mixReturn: 0.05 }), null);
  });
});

describe('fundChoices', () => {
  it('ranks the funds of a class by their cost over its slice of the plan, with the trading cost where it is known', () => {
    const input = { plan: PLAN, target: 0.28, orderTwd: 5000, usdTwd: 32, broker: broker(), settings: SETTINGS, tax: TAX };
    const choices = fundChoices([fund(), fund({ ticker: 'VWRA', domicile: 'IE', market: 'UK', distribution: 'acc', ter: 0.0019, withholding: 0.09 })], input);
    assert.deepEqual(
      choices.map((choice) => choice.fund.ticker),
      ['VWRA', 'VT'],
    );
    assert.equal(choices[0]?.tradeShare, null);
    // The plan buys monthly, so the DCA price applies: US$0.1 (NT$3.2) plus 0.1% FX (NT$5) on NT$5,000.
    const share = (0.1 * 32 + 5) / 5000;
    assert.ok(Math.abs((choices[1]?.tradeShare ?? 0) - share) < 1e-12);
    const slice = { ...PLAN, pmt: 2800 };
    assert.ok(Math.abs((choices[1]?.overPlan?.cost ?? 0) - costOverPlan(slice, 0.006, share).cost) < 1e-6);
    // Without a DCA price, the ETF price applies: US$3 on NT$5,000 plus 0.1% FX.
    const etfOnly = fundChoices([fund()], { ...input, broker: broker({ usDca: null }) });
    assert.equal(etfOnly[0]?.tradeShare, 0.0202);
  });
});

describe('reading the config rows', () => {
  it('reads brokers back as written, and leaves out entries without an id or a name', () => {
    const written = [brokerValue(broker()), brokerValue(LISTED), { id: 'Bad id', name_en: 'x' }, { id: 'noname' }];
    const read = readBrokers(written);
    assert.deepEqual(
      read.map((entry) => entry.id),
      ['cathay', 'listed'],
    );
    assert.deepEqual(read[0], broker());
    assert.deepEqual(readSchedule({ min: 5 }), null);
  });

  it('reads fund costs back as written, without duplicates or unknown markets', () => {
    const read = readFundCosts([fundCostValue(fund()), fundCostValue(fund()), { ...fundCostValue(fund({ ticker: 'X' })), market: 'JP' }]);
    assert.deepEqual(read, [fund()]);
  });

  it('reads the tax settings whole or not at all, and the fee settings defensively', () => {
    assert.deepEqual(readTaxSettings(taxSettingsValue(TAX)), TAX);
    const value = taxSettingsValue(TAX);
    assert.equal(readTaxSettings({ ...value, nhi: {} }), undefined);
    assert.deepEqual(readFeeSettings({ broker: 'cathay', tw: { rate: 0.001425, discount: 1, min_twd: 20 }, fx_spread: 0.001 }), SETTINGS);
    assert.deepEqual(readFeeSettings(null), { brokerId: null, tw: null, fxSpread: null });
  });
});
