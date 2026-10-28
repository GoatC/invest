import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { DeleteForm } from '@/components/delete-form';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import { FlagGrid, type FlagGridRow } from '@/components/red-flag-charts';
import { requireSession } from '@/lib/auth';
import { DataError, loadRedFlagData, type FlagCompany, type RedFlagData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { money, percent } from '@/lib/format';
import { feedLabel, LABELS, type Bilingual } from '@/lib/i18n';
import { ALTMAN, BENEISH, companyKind, currentRun, GOVERNANCE_TIERS, INDICATORS, type IndicatorResult, type Level, type RedFlagSettings, type Status } from '@/lib/models/red-flags';
import { INDICATOR, INDICATOR_SHORT, LIGHT_ICON, lightText, ruleText, STATUS_TEXT, whyText } from '@/lib/red-flag-text';

import { deleteFlagEntry } from './actions';
import { EntryForm, FlagSettingsForm } from './forms';

type Params = Record<string, string | string[] | undefined>;

const TONE: Record<Level, Fact['tone']> = { green: 'ok', amber: 'watch', red: 'alert' };
const KIND: Record<ReturnType<typeof companyKind>, Bilingual> = {
  manufacturer: { en: 'Manufacturer: Altman Z', zh: '製造業：Altman Z' },
  other: { en: 'Not a manufacturer: Altman Z″', zh: '非製造業：Altman Z″' },
  financial: { en: 'Bank or insurer', zh: '銀行或保險業' },
  unknown: { en: 'Industry not known yet: Z″', zh: '尚未取得產業：Z″' },
};

function Light({ status }: { status: Status }) {
  const icon = LIGHT_ICON[status];
  return (
    <span className="nowrap">
      <span className={`status-icon ${icon.className}`} aria-hidden="true">
        {icon.icon}
      </span>{' '}
      <Bi {...STATUS_TEXT[status]} />
    </span>
  );
}

/** The figure an indicator shows: a score to two decimals, a count, a tier. */
function figure(row: IndicatorResult): string {
  if (row.value === null) return '—';
  if (row.indicator === 'beneish_m' || row.indicator === 'altman_z') return row.value.toFixed(2);
  if (row.indicator === 'governance_rating') return `≤ ${row.value}%`;
  if (row.indicator === 'excluded_business') return row.value > 0 ? (row.matched ?? '✕') : '—';
  return String(row.value);
}

/** N3 (PRD Module C): the red-flag light of every single stock held or watched, beside F12's watchlist. */
export default async function RedFlagsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: RedFlagData;
  try {
    data = await loadRedFlagData(supabase, today);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  if (!data.settings) return <DataProblem table="config" detail="red_flags is missing or malformed" />;
  const ticker = typeof params['t'] === 'string' ? params['t'] : undefined;
  const company = ticker ? data.companies.find((one) => one.security.ticker === ticker) : undefined;
  if (company) return <Company company={company} settings={data.settings} today={today} saved={typeof params['saved'] === 'string' ? params['saved'] : undefined} />;
  return <Overview data={data} settings={data.settings} saved={params['saved'] === 'settings'} missing={ticker} />;
}

function Overview({ data, settings, saved, missing }: { data: RedFlagData; settings: RedFlagSettings; saved: boolean; missing?: string }) {
  const columns = INDICATORS.map((indicator) => INDICATOR_SHORT[indicator]);
  const rows: FlagGridRow[] = data.companies.map((company) => ({
    ticker: company.security.ticker,
    cells: company.assessment.indicators.map((row) => ({ status: row.status, value: figure(row) })),
  }));
  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.redFlags} />
        </h1>
        <p className="equation">
          <Bi en="Light = the worst level among the indicators covered · display only" zh="燈號 ＝ 有資料的指標中最差的等級 · 僅供參考" />
        </p>
        {missing && (
          <p className="banner danger" role="alert">
            <Bi en={`${missing} is not a single stock held or watched.`} zh={`${missing} 不是持有或觀察中的個股。`} />
          </p>
        )}
        {data.companies.length === 0 ? (
          <p className="muted">
            <Bi en="No single stock held or watched yet." zh="尚無持有或觀察中的個股。" />
          </p>
        ) : (
          <>
            <FlagGrid rows={rows} columns={columns} label={{ en: 'Each company’s indicators by level', zh: '各公司指標燈號' }} />
            <div className="table-wrap">
              <table className="compact">
                <thead>
                  <tr>
                    <th>
                      <Bi {...LABELS.ticker} />
                    </th>
                    <th>
                      <Bi en="Light" zh="燈號" />
                    </th>
                    <th className="num">
                      <Bi en="Coverage" zh="覆蓋率" />
                    </th>
                    <th>
                      <Bi en="Fired" zh="觸發指標" />
                    </th>
                    <th>
                      <Bi en="Weekly scan" zh="每週掃描" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.companies.map((company) => {
                    const { assessment } = company;
                    const run = currentRun(company.scans);
                    return (
                      <tr key={company.security.ticker}>
                        <td>
                          <Link href={`/red-flags?t=${encodeURIComponent(company.security.ticker)}`}>{company.security.ticker}</Link>
                          {company.held && (
                            <span className="badge">
                              <Bi en="held" zh="持有" />
                            </span>
                          )}
                          <div className="muted small">{company.security.name}</div>
                        </td>
                        <td>{assessment.light ? <Light status={assessment.light} /> : <Light status="none" />}</td>
                        <td className="num">
                          {percent(assessment.coverage / 100, 0)}
                          <div className="muted small">
                            {assessment.covered} / {assessment.applicable}
                          </div>
                        </td>
                        <td>
                          {assessment.fired.length === 0 ? (
                            '—'
                          ) : (
                            <Bi en={assessment.fired.map((indicator) => INDICATOR[indicator].en).join(', ')} zh={assessment.fired.map((indicator) => INDICATOR[indicator].zh).join('、')} />
                          )}
                        </td>
                        <td className="small">
                          {run ? (
                            <Bi en={`${lightText(run.light).en} since ${run.since}${run.before ? `, ${lightText(run.before).en.toLowerCase()} before` : ''}`} zh={`自 ${run.since} 起${lightText(run.light).zh}${run.before ? `，之前${lightText(run.before).zh}` : ''}`} />
                          ) : (
                            <Bi en="Not scanned yet" zh="尚未掃描" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Info>
          <ul className="compact-list">
            {INDICATORS.map((indicator) => (
              <li key={indicator}>
                <strong>
                  <Bi {...INDICATOR[indicator]} />
                </strong>
                : <Bi {...ruleText(indicator, settings)} />
              </li>
            ))}
          </ul>
          <p>
            <Bi
              en="The light is worked out now from the saved filings, events and your entries. Once a week the nightly job reads each company's 8-K items and going-concern search (SEC) or its environmental penalties (Ministry of Environment), and saves the scan the two N3 rules compare: a held stock whose light worsens prompts a review; a satellite stock turning red drafts its exit. No free source gives full ESG scores, so coverage shows the share of the indicators that apply which data covers."
              zh="燈號依已存的財報、事件與你的紀錄即時計算。每夜排程每週讀取一次各公司的 8-K 項目與繼續經營全文搜尋（SEC）或環境裁罰（環境部），並存下兩條 N3 規則比較用的掃描：持股燈號轉差時提醒檢視；衛星持股轉紅時產生出場清單。沒有免費來源提供完整 ESG 評分，因此覆蓋率顯示有資料的適用指標比例。"
            />
          </p>
        </Info>
      </section>
      <section className="card form" id="settings">
        <h2>
          <Bi en="Settings" zh="設定" />
        </h2>
        {saved && (
          <p className="banner ok" role="status">
            <Bi en="Saved; the change is in the edit history." zh="已儲存；修改已記錄在修改紀錄中。" />
          </p>
        )}
        <FlagSettingsForm settings={settings} />
      </section>
    </>
  );
}

/** What an indicator read, as one line: the period and parts of a score, the events, the entry. */
function Detail({ row, currency }: { row: IndicatorResult; currency: string | null }) {
  const why = whyText(row);
  const lines: Bilingual[] = [];
  if (row.periodEnd) lines.push({ en: `Twelve months to ${row.periodEnd}${row.priorEnd ? ` against ${row.priorEnd}` : ''}`, zh: `截至 ${row.periodEnd} 的近四季${row.priorEnd ? `，對照 ${row.priorEnd}` : ''}` });
  if (row.variant) lines.push(row.variant === 'Z' ? { en: `Z, equity at ${row.equityBasis === 'market' ? 'market value' : 'book value (no price in the filings’ currency)'}`, zh: `Z，權益以${row.equityBasis === 'market' ? '市值' : '帳面價值（股價幣別與財報不同）'}計` } : { en: 'Z″, equity at book value', zh: 'Z″，權益以帳面價值計' });
  if (row.years) lines.push({ en: row.years.map((year) => `${year.end}: OCF ${(year.ocf / 1e6).toFixed(0)}M vs NI ${(year.netIncome / 1e6).toFixed(0)}M`).join(' · '), zh: row.years.map((year) => `${year.end}：營業現金流 ${(year.ocf / 1e6).toFixed(0)}M 對淨利 ${(year.netIncome / 1e6).toFixed(0)}M`).join(' · ') });
  if (row.checkedOn) lines.push({ en: `Checked ${row.checkedOn}${row.since ? `, reading since ${row.since}` : ''}`, zh: `檢查於 ${row.checkedOn}${row.since ? `，自 ${row.since} 起讀取` : ''}` });
  if (row.entry) lines.push({ en: `Your entry as of ${row.entry.asOf}${row.entry.note ? `: ${row.entry.note}` : ''}`, zh: `你的紀錄（${row.entry.asOf}）${row.entry.note ? `：${row.entry.note}` : ''}` });
  return (
    <>
      {why && (
        <div className="muted small">
          <Bi {...why} />
        </div>
      )}
      {lines.map((line) => (
        <div key={line.en} className="muted small">
          <Bi {...line} />
        </div>
      ))}
      {(row.events ?? []).map((event) => (
        <div key={`${event.source}-${event.date}-${event.title}`} className="small">
          {event.date} · {event.url ? <a href={event.url} rel="noreferrer" target="_blank">{event.title}</a> : event.title}
          {event.value ? ` · ${money(event.value, currency ?? 'TWD', 0)}` : ''} <span className="muted">({feedLabel(event.source).en})</span>
        </div>
      ))}
    </>
  );
}

function Company({ company, settings, today, saved }: { company: FlagCompany; settings: RedFlagSettings; today: string; saved?: string }) {
  const { assessment, security, profile } = company;
  const kind = companyKind(security.market, profile, settings);
  const beneish = assessment.indicators.find((row) => row.indicator === 'beneish_m');
  const altman = assessment.indicators.find((row) => row.indicator === 'altman_z');
  const facts: Fact[] = [
    { label: { en: 'Light', zh: '燈號' }, value: <Bi {...lightText(assessment.light)} />, ...(assessment.light ? { tone: TONE[assessment.light] } : {}) },
    { label: { en: 'Coverage', zh: '覆蓋率' }, value: percent(assessment.coverage / 100, 0), note: { en: `${assessment.covered} of ${assessment.applicable} indicators`, zh: `${assessment.applicable} 項中 ${assessment.covered} 項` } },
    { label: { en: 'Industry', zh: '產業' }, value: profile?.industry ?? '—', note: KIND[kind] },
    { label: { en: 'Last scan', zh: '最近掃描' }, value: company.scans[0]?.date ?? '—' },
  ];
  return (
    <>
      <section className="card form">
        <p>
          <Link href="/red-flags">
            <Bi en="← All companies" zh="← 所有公司" />
          </Link>
        </p>
        <h1>
          {security.ticker} <span className="muted">{security.name}</span>
        </h1>
        <Facts facts={facts} />
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="Indicator" zh="指標" />
                </th>
                <th>
                  <Bi en="Level" zh="燈號" />
                </th>
                <th className="num">
                  <Bi en="Figure" zh="數值" />
                </th>
                <th>
                  <Bi en="What it read" zh="依據" />
                </th>
              </tr>
            </thead>
            <tbody>
              {assessment.indicators.map((row) => (
                <tr key={row.indicator}>
                  <td>
                    <Bi {...INDICATOR[row.indicator]} />
                    <div className="muted small">
                      <Bi {...ruleText(row.indicator, settings)} />
                    </div>
                  </td>
                  <td>
                    <Light status={row.status} />
                  </td>
                  <td className="num">{figure(row)}</td>
                  <td>
                    <Detail row={row} currency={security.market === 'US' ? 'USD' : 'TWD'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {beneish?.parts && (
          <Info label={{ en: 'Beneish M, worked out', zh: 'Beneish M 計算方式' }}>
            <p className="formula">
              M = {BENEISH.constant} + {(Object.keys(beneish.parts) as Array<keyof typeof BENEISH>).map((key) => `${BENEISH[key]} × ${key} ${(beneish.parts?.[key] as number).toFixed(3)}`).join(' + ')} = {beneish.value?.toFixed(3)}
            </p>
            <Bi
              en="DSRI receivables to sales, GMI gross margin, AQI asset quality, SGI sales growth, DEPI depreciation, SGAI SG&A to sales, TATA accruals to assets, LVGI leverage: each this year against the year before."
              zh="DSRI 應收帳款占營收、GMI 毛利率、AQI 資產品質、SGI 營收成長、DEPI 折舊、SGAI 管銷費用占營收、TATA 應計項目占資產、LVGI 槓桿：皆為今年對照前一年。"
            />
          </Info>
        )}
        {altman?.parts && altman.variant && (
          <Info label={{ en: 'Altman Z, worked out', zh: 'Altman Z 計算方式' }}>
            <p className="formula">
              {altman.variant === 'Z' ? 'Z' : 'Z″'} = {Object.entries(ALTMAN[altman.variant]).map(([key, weight]) => `${weight} × ${key} ${(altman.parts?.[key] ?? 0).toFixed(3)}`).join(' + ')} = {altman.value?.toFixed(3)}
            </p>
            <Bi
              en="X1 working capital, X2 retained earnings, X3 EBIT and X5 sales, each over total assets; X4 the equity over total liabilities."
              zh="X1 營運資金、X2 保留盈餘、X3 息前稅前利益、X5 營收，皆除以總資產；X4 為權益除以總負債。"
            />
          </Info>
        )}
      </section>
      <section className="card form" id="entries">
        <h2>
          <Bi en="Your entries" zh="自行登錄" />
        </h2>
        {saved === 'entry' && (
          <p className="banner ok" role="status">
            <Bi en="Saved, and the company scanned again." zh="已儲存，並重新掃描。" />
          </p>
        )}
        {saved === 'deleted' && (
          <p className="banner ok" role="status">
            <Bi en="Deleted, and the company scanned again." zh="已刪除，並重新掃描。" />
          </p>
        )}
        {company.entries.length === 0 ? (
          <p className="muted">
            <Bi en="None yet." zh="尚無紀錄。" />
          </p>
        ) : (
          <ul className="compact-list">
            {company.entries.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.asOf}</strong> <Bi {...INDICATOR[entry.indicator]} />:{' '}
                {entry.indicator === 'governance_rating' ? `≤ ${entry.value}% (${GOVERNANCE_TIERS.indexOf(entry.value as (typeof GOVERNANCE_TIERS)[number]) + 1} / ${GOVERNANCE_TIERS.length})` : entry.value} {entry.note && <span className="muted">· {entry.note}</span>}
                <DeleteForm id={entry.id} action={deleteFlagEntry} confirm={{ en: 'Delete this entry?', zh: '確定刪除這筆紀錄？' }} />
              </li>
            ))}
          </ul>
        )}
        <EntryForm ticker={security.ticker} market={security.market} today={today} />
        <Info>
          <Bi
            en={
              security.market === 'TW'
                ? 'Governance: the tier from TWSE’s yearly corporate governance evaluation (cgc.twse.com.tw), which blocks scripts. Auditor changes, restatements and going-concern doubt before the nightly job first read the announcements: search MOPS (公開資訊觀測站) and type what you found.'
                : 'Environmental penalties: search the company’s facilities on EPA ECHO (echo.epa.gov), as its records name facilities, not companies, and type what you found in the last years.'
            }
            zh={
              security.market === 'TW'
                ? '公司治理：證交所每年公司治理評鑑的級距（cgc.twse.com.tw，會擋程式）。每夜排程開始讀取重大訊息之前的更換會計師、財報重編與繼續經營疑慮：請到公開資訊觀測站查詢後輸入。'
                : '環境裁罰：請到 EPA ECHO（echo.epa.gov）查詢該公司的工廠（紀錄以工廠而非公司命名），輸入近幾年找到的結果。'
            }
          />
        </Info>
      </section>
      {company.scans.length > 0 && (
        <section className="card form">
          <h2>
            <Bi en="Weekly scans" zh="每週掃描" />
          </h2>
          <ul className="compact-list">
            {company.scans.slice(0, 12).map((scan) => (
              <li key={scan.date}>
                {scan.date} · {scan.light ? <Light status={scan.light} /> : <Light status="none" />} · {percent(scan.coverage / 100, 0)}
                {scan.fired.length > 0 && (
                  <>
                    {' '}
                    · <Bi en={scan.fired.map((indicator) => INDICATOR[indicator].en).join(', ')} zh={scan.fired.map((indicator) => INDICATOR[indicator].zh).join('、')} />
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
