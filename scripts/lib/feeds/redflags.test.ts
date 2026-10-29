import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auditorChange, fullTextUrl, moenvPenalties, moenvUrl, secGoingConcern, secSubmissions, submissionsUrl, twseMaterial, twseProfiles } from './redflags.ts';

/** The shape of data.sec.gov/submissions, cut down to the columns read. */
const SUBMISSIONS = JSON.stringify({
  cik: '320193',
  sic: '3571',
  sicDescription: 'Electronic Computers',
  filings: {
    recent: {
      accessionNumber: ['0000320193-26-000100', '0000320193-25-000050', '0000320193-24-000010', '0000320193-22-000001'],
      filingDate: ['2026-08-01', '2025-03-04', '2024-02-02', '2022-01-05'],
      reportDate: ['2026-07-31', '2025-03-01', '', '2022-01-03'],
      form: ['8-K', '8-K', '8-K/A', '8-K'],
      items: ['2.02,9.01', '4.01,9.01', '4.02', '4.02'],
      primaryDocument: ['a.htm', 'b.htm', 'c.htm', 'd.htm'],
    },
  },
});

describe('SEC submissions', () => {
  it('reads the SIC industry and the 8-K Items 4.01 and 4.02 from the window on, dated by the event', () => {
    const { sic, industry, events } = secSubmissions(SUBMISSIONS, 'AAPL', '2023-10-28');
    assert.equal(sic, 3571);
    assert.equal(industry, 'Electronic Computers');
    assert.deepEqual(
      events.map((event) => [event.indicator, event.date, event.ref, event.title]),
      [
        ['auditor_change', '2025-03-01', '0000320193-25-000050:4.01', '8-K Item 4.01, filed 2025-03-04'],
        ['restatement', '2024-02-02', '0000320193-24-000010:4.02', '8-K/A Item 4.02, filed 2024-02-02'],
      ],
    );
    assert.equal(events[0]?.url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000050/b.htm');
    assert.equal(submissionsUrl(320193), 'https://data.sec.gov/submissions/CIK0000320193.json');
  });

  it('refuses a reply without filings', () => {
    assert.throws(() => secSubmissions('{"cik": "1"}', 'X', '2020-01-01'), /no recent filings/);
    assert.throws(() => secSubmissions('<html>', 'X', '2020-01-01'), /not JSON/);
  });
});

describe('EDGAR full-text search', () => {
  it('asks for the going-concern phrases in one company\'s 10-Ks over the window', () => {
    const url = new URL(fullTextUrl(863894, '2023-10-28', '2026-10-28'));
    assert.equal(url.searchParams.get('ciks'), '0000863894');
    assert.equal(url.searchParams.get('forms'), '10-K');
    assert.equal(url.searchParams.get('startdt'), '2023-10-28');
    assert.match(url.searchParams.get('q') ?? '', /^"substantial doubt about the Company's ability to continue as a going concern" OR /);
  });

  it('gives one event per filing, its exhibits found too counted once', () => {
    const reply = JSON.stringify({
      hits: {
        hits: [
          { _id: '0001437749-25-038089:veru.htm', _source: { adsh: '0001437749-25-038089', file_date: '2025-12-17', period_ending: '2025-09-30', form: '10-K' } },
          { _id: '0001437749-25-038089:ex23.htm', _source: { adsh: '0001437749-25-038089', file_date: '2025-12-17', period_ending: '2025-09-30', form: '10-K' } },
          { _id: '0001437749-24-000001:veru.htm', _source: { adsh: '0001437749-24-000001', file_date: '2024-12-16', form: '10-K' } },
        ],
      },
    });
    const events = secGoingConcern(reply, 'VERU', 863894);
    assert.deepEqual(events.map((event) => [event.date, event.ref, event.title]), [
      ['2025-12-17', '0001437749-25-038089', '10-K for 2025-09-30: substantial doubt about going concern'],
      ['2024-12-16', '0001437749-24-000001', '10-K: substantial doubt about going concern'],
    ]);
    assert.deepEqual(secGoingConcern('{"hits": {"total": {"value": 0}, "hits": []}}', 'AAPL', 320193), []);
    assert.throws(() => secGoingConcern('{}', 'AAPL', 320193), /no hits list/);
  });
});

describe('TWSE company profiles and announcements', () => {
  it("reads a company's industry code and name, audit firm and business ID", () => {
    const reply = JSON.stringify([
      { 出表日期: '1151027', 公司代號: '2330', 產業別: '24', 營利事業統一編號: '22099131', 簽證會計師事務所: '勤業眾信聯合會計師事務所' },
      { 出表日期: '1151027', 公司代號: '1101', 產業別: '01', 營利事業統一編號: '11913502', 簽證會計師事務所: '資誠聯合會計師事務所' },
    ]);
    assert.deepEqual(twseProfiles(reply, new Set(['2330'])).get('2330'), { industryCode: '24', industry: '半導體業', auditor: '勤業眾信聯合會計師事務所', businessId: '22099131' });
    assert.equal(twseProfiles(reply, new Set(['2330'])).size, 1);
  });

  it('finds a restatement, going-concern doubt and an auditor change, and leaves a rotation inside the firm out', () => {
    const row = (code: string, subject: string, body = '', time = '173000') => ({ 出表日期: '1151028', 發言日期: '1151027', 發言時間: time, 公司代號: code, '主旨 ': subject, 說明: body });
    const reply = JSON.stringify([
      row('2330', '公告本公司重編113年度財務報告', '', '170000'),
      row('2330', '公告本公司更換簽證會計師', '1.變動原因：會計師事務所內部組織調整', '171000'),
      row('9999', '公告本公司更換簽證會計師', '1.變動原因：公司營運需要'),
      row('2330', '更正本公司115年9月份背書保證資訊', '', '172000'),
      row('2330', '本公司會計師出具繼續經營能力存在重大不確定性之查核報告', '', '173500'),
    ]);
    const events = twseMaterial(reply, new Set(['2330', '9999']));
    assert.deepEqual(events.map((event) => [event.ticker, event.indicator, event.date]), [
      ['2330', 'restatement', '2026-10-27'],
      ['9999', 'auditor_change', '2026-10-27'],
      ['2330', 'going_concern', '2026-10-27'],
    ]);
    assert.equal(events[0]?.ref, '1151027-170000-restatement');
  });

  it('turns a change of audit firm between two nights into an event', () => {
    assert.equal(auditorChange('2330', '勤業眾信聯合會計師事務所', '勤業眾信聯合會計師事務所', '2026-10-28'), undefined);
    assert.equal(auditorChange('2330', null, '勤業眾信聯合會計師事務所', '2026-10-28'), undefined);
    assert.equal(auditorChange('2330', 'A 事務所', 'B 事務所', '2026-10-28')?.title, '簽證會計師事務所：A 事務所 → B 事務所');
  });
});

describe('Ministry of Environment penalties', () => {
  it('filters by business ID and keeps the penalties in the window, not one revoked on appeal', () => {
    const url = new URL(moenvUrl('KEY', '22099131'));
    assert.equal(url.searchParams.get('filters'), 'ban,EQ,22099131');
    const reply = JSON.stringify([
      { document_no: '40-115-070014', penalty_date: '2026-07-28', penalty_money: '6000', transgress_type: '事業廢棄物', transgress_law: '廢棄物清理法第31條', fac_name: '台積電', appeal_or_rescind: '' },
      { document_no: '21-110-000001', penalty_date: '2021-01-21', penalty_money: '27000', transgress_type: '水污染', fac_name: '台積電' },
      { document_no: '21-115-000002', penalty_date: '2026-02-01', penalty_money: '100000', transgress_type: '空氣污染', fac_name: '台積電', appeal_or_rescind: '訴願撤銷' },
    ]);
    const events = moenvPenalties(reply, '2330', '2023-10-28');
    assert.deepEqual(events.map((event) => [event.ref, event.date, event.value, event.title]), [['40-115-070014', '2026-07-28', 6000, '事業廢棄物：廢棄物清理法第31條（台積電）']]);
  });
});
