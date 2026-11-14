import Link from 'next/link';

import { AllocationDonut } from '@/components/allocation-charts';
import { Bi, Zh } from '@/components/bi';
import { Info } from '@/components/info';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadAllocationData, type AllocationData } from '@/lib/data';
import { percent, points, twd } from '@/lib/format';
import { DRIFT_ICON, DRIFT_STATUS, LABELS, POOL, SLEEVE, type Bilingual } from '@/lib/i18n';
import { allocation, classDrifts, satelliteCheck, sleeveTargets, type ClassDrift, type DriftStatus, type SatelliteCheck } from '@/lib/models/allocation';
import { targetReturn } from '@/lib/models/cma';
import type { Scope } from '@/lib/models/performance';
import { buildPortfolio, type Portfolio } from '@/lib/models/portfolio';

type Params = Record<string, string | string[] | undefined>;

/** The pools the donut can show; the targets are set on the regular pool, so it comes first. */
const SCOPES: readonly Scope[] = ['regular', 'all', 'windfall'];

const SCOPE: Record<Scope, Bilingual> = {
  regular: POOL.regular,
  all: { en: 'Both pools', zh: '兩個資金池' },
  windfall: POOL.windfall,
};

const SAVED: Record<string, Bilingual> = {
  targets: { en: 'Targets saved; the edit history keeps the old ones.', zh: '已儲存目標權重，修改紀錄中保留舊值。' },
  assumptions: { en: 'Capital market assumptions saved.', zh: '已儲存資本市場假設。' },
};

function one(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function AllocationPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const scope = SCOPES.find((option) => option === one(params, 'scope')) ?? 'regular';
  const saved = SAVED[one(params, 'saved') ?? ''];
  let data: AllocationData;
  try {
    data = await loadAllocationData(supabase);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const portfolio = buildPortfolio(data);

  return (
    <>
      <section className="card form">
        <h1>
          <Zh {...LABELS.allocation} />
        </h1>
        {saved && (
          <p className="banner ok" role="status">
            <Bi {...saved} />
          </p>
        )}
      </section>
      <Drift data={data} portfolio={portfolio} />
      <AssumptionsCard data={data} />
      <ScopeFilter scope={scope} />
      <Donut data={data} portfolio={portfolio} scope={scope} />
      <Method />
    </>
  );
}

function StatusCell({ status, core }: { status: DriftStatus; core: boolean }) {
  if (status === 'unchecked' && core) return <>—</>;
  return (
    <span className="nowrap">
      <span className={`status-icon ${status}`} aria-hidden="true">
        {DRIFT_ICON[status]}
      </span>{' '}
      <Bi {...DRIFT_STATUS[status]} />
    </span>
  );
}

function Drift({ data, portfolio }: { data: AllocationData; portfolio: Portfolio }) {
  const total = portfolio.pool.totalTwd;
  const drifts = classDrifts(portfolio.classes, data.bands, total);
  const satellite = satelliteCheck(portfolio.pool, data.caps);
  return (
    <section className="card form">
      <div className="row spread">
        <h2>
          <Bi en="Drift from the targets, regular pool" zh="與目標權重的偏離（一般資金池）" />
        </h2>
        <Link href="/allocation/targets">
          <Bi en="Edit targets" zh="修改目標權重" />
        </Link>
      </div>
      {total <= 0 ? (
        <p className="muted">
          <Bi en="The regular pool holds nothing priced yet, so there is no drift to show." zh="一般資金池目前沒有已計價的持有，因此沒有偏離可顯示。" />
        </p>
      ) : (
        <>
          <Info>
            <Bi
              en="Drift = actual weight − target, in percentage points (pp). A core class turns amber past half of its F8 band and red past the band itself, where F8 drafts a rebalance: 5 pp, or a quarter of the target if that is smaller (the 5/25 rule). Satellite classes are watched by R2 as a whole."
              zh="偏離＝實際權重－目標權重，單位為百分點（pp）。核心類別超過 F8 門檻的一半轉為黃色，超過門檻本身轉為紅色，此時 F8 會產生再平衡清單：門檻為 5 個百分點，或目標的四分之一（取較小者，即 5/25 規則）。衛星類別由 R2 以整體衡量。"
            />
          </Info>
          {!data.bands && (
            <p className="banner info">
              <Bi en="The F8_DRIFT rule is off in the rules table, so no class is coloured." zh="rules 表中的 F8_DRIFT 規則未啟用，因此不顯示顏色。" />
            </p>
          )}
          <BandBars drifts={drifts} satellite={satellite} total={total} />
          <details>
            <summary>
              <Bi en="Show as a table" zh="以表格顯示" />
            </summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.assetClass} />
                  </th>
                  <th className="num">
                    <Bi {...LABELS.target} />
                  </th>
                  <th className="num">
                    <Bi {...LABELS.actual} />
                  </th>
                  <th className="num">
                    <Bi {...LABELS.drift} />
                  </th>
                  <th className="num">
                    <Bi en="F8 band" zh="F8 門檻" />
                  </th>
                  <th>
                    <Bi en="Status" zh="狀態" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {drifts.map((row) => (
                  <tr key={row.assetClass.id}>
                    <td>
                      <Bi en={row.assetClass.nameEn} zh={row.assetClass.nameZh} />
                      <div className="muted small">
                        <Bi {...SLEEVE[row.assetClass.sleeve]} />
                      </div>
                    </td>
                    <td className="num">{percent(row.assetClass.targetWeight)}</td>
                    <td className="num">{percent(row.weight)}</td>
                    <td className="num">{points(row.drift)}</td>
                    <td className="num">{row.band === null ? '—' : `±${points(row.band).replace(/^[+−]/, '')}`}</td>
                    <td>
                      <StatusCell status={row.status} core={row.assetClass.sleeve === 'core'} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {satellite && (
                <tfoot>
                  <tr>
                    <td>
                      <strong>
                        <Bi en="Satellite sleeve (R2)" zh="衛星部位（R2）" />
                      </strong>
                      <div className="muted small">
                        <Bi en={`Trimmed back to ${percent(satellite.target)} above ${percent(satellite.trigger)}`} zh={`超過 ${percent(satellite.trigger)} 時減碼回 ${percent(satellite.target)}`} />
                      </div>
                    </td>
                    <td className="num">{percent(satellite.target)}</td>
                    <td className="num">{percent(satellite.weight)}</td>
                    <td className="num">{points(satellite.weight - satellite.target)}</td>
                    <td className="num">{`+${points(satellite.trigger - satellite.target).replace(/^[+−]/, '')}`}</td>
                    <td>
                      <StatusCell status={satellite.status} core={false} />
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          </details>
        </>
      )}
    </section>
  );
}

const BAND_ICON: Record<DriftStatus, string> = { ok: '✓', watch: '!', rebalance: '✕', unchecked: '' };

/** One class on the scale: its weight filled, its target a tick, its F8 band a paler stripe, the TWD over or under. */
function BandRow({ label, line, weight, target, band, status, top, gapTwd }: { label: Bilingual; line: string; weight: number; target: number; band: number | null; status: DriftStatus; top: number; gapTwd: number | null }) {
  const at = (value: number) => `${Math.max(0, Math.min(100, (value / top) * 100)).toFixed(1)}%`;
  return (
    <li className="band-row" data-line={line}>
      <div className="band-top">
        <span>
          {BAND_ICON[status] && (
            <span className={`status-icon ${status}`} aria-hidden="true">
              {BAND_ICON[status]}
            </span>
          )}
          <Bi {...label} label />
        </span>
        <span className="band-figures">
          <b>{percent(weight)}</b> ／ {percent(target, 0)}
        </span>
      </div>
      <div className="band-track" role="img" aria-label={`${label.zh} 實際 ${percent(weight)}，目標 ${percent(target, 0)}`}>
        {band !== null && <i className="band" style={{ left: at(Math.max(0, target - band)), width: at(Math.min(top, target + band) - Math.max(0, target - band)) }} />}
        <i className={`fill ${status}`} style={{ width: at(weight) }} />
        <i className="tick" style={{ left: at(target) }} />
      </div>
      {gapTwd !== null && Math.abs(gapTwd) >= 1 && (
        <div className="band-gap">
          <Bi en={`${gapTwd > 0 ? 'over by' : 'under by'} ${twd(Math.abs(gapTwd))}`} zh={`${gapTwd > 0 ? '多' : '少'} ${twd(Math.abs(gapTwd))}`} />
        </div>
      )}
    </li>
  );
}

/**
 * F6's drift as bars on one scale (PRD Section 5, "Phone redesign", step 4): a core class past its
 * paler stripe is where F8 drafts a rebalance; the satellite classes are watched together by R2.
 */
function BandBars({ drifts, satellite, total }: { drifts: readonly ClassDrift[]; satellite: SatelliteCheck | undefined; total: number }) {
  const core = drifts.filter((row) => row.assetClass.sleeve === 'core');
  const others = drifts.filter((row) => row.assetClass.sleeve !== 'core');
  // One scale for every bar: a little past the largest weight, target or band edge.
  const top = Math.max(0.1, ...drifts.flatMap((row) => [row.weight, row.assetClass.targetWeight + (row.band ?? 0)])) * 1.06;
  const sum = (rows: readonly ClassDrift[], pick: (row: ClassDrift) => number) => rows.reduce((totalSoFar, row) => totalSoFar + pick(row), 0);
  const row = (drift: ClassDrift) => (
    <BandRow
      key={drift.assetClass.id}
      label={{ en: drift.assetClass.nameEn, zh: drift.assetClass.nameZh }}
      line={drift.assetClass.id}
      weight={drift.weight}
      target={drift.assetClass.targetWeight}
      band={drift.band}
      status={drift.status}
      top={top}
      gapTwd={drift.assetClass.sleeve === 'core' ? drift.drift * total : null}
    />
  );
  return (
    <div className="bands">
      <div className="band-group">
        <h3>
          <Bi {...SLEEVE.core} /> {percent(sum(core, (drift) => drift.weight))}
          <small>
            <Bi en={`target ${percent(sum(core, (drift) => drift.assetClass.targetWeight), 0)}`} zh={`目標 ${percent(sum(core, (drift) => drift.assetClass.targetWeight), 0)}`} />
          </small>
        </h3>
        <ul>{core.map(row)}</ul>
      </div>
      {others.length > 0 && (
        <div className="band-group">
          <h3>
            <Bi {...SLEEVE.satellite} /> {percent(satellite?.weight ?? sum(others, (drift) => drift.weight))}
            {satellite && (
              <small>
                <span className={`status-icon ${satellite.status}`} aria-hidden="true">
                  {BAND_ICON[satellite.status]}
                </span>
                <Bi en={`target ${percent(satellite.target, 0)} · trigger ${percent(satellite.trigger, 0)}`} zh={`目標 ${percent(satellite.target, 0)}・上限 ${percent(satellite.trigger, 0)}`} />
              </small>
            )}
          </h3>
          <ul>{others.map(row)}</ul>
        </div>
      )}
      <ul className="chart-legend">
        {(['ok', 'watch', 'rebalance'] as const).map((status) => (
          <li key={status}>
            <span className={`status-icon ${status}`} aria-hidden="true">
              {DRIFT_ICON[status]}
            </span>
            <Bi {...DRIFT_STATUS[status]} />
          </li>
        ))}
        <li>
          <span className="chart-key line" style={{ background: 'var(--text)' }} aria-hidden="true" />
          <Bi {...LABELS.target} />
        </li>
        <li>
          <span className="chart-key rect" style={{ background: 'var(--accent-soft)' }} aria-hidden="true" />
          <Bi en="F8 band" zh="F8 門檻" />
        </li>
      </ul>
    </div>
  );
}

function AssumptionsCard({ data }: { data: AllocationData }) {
  const saved = data.assumptions;
  const mix = saved ? targetReturn(data.assetClasses, saved.assumptions) : null;
  return (
    <section className="card form">
      <div className="row spread">
        <h2>
          <Bi en="Capital market assumptions" zh="資本市場假設" />
        </h2>
        <Link href="/allocation/assumptions">
          <Bi en="Edit assumptions" zh="修改假設" />
        </Link>
      </div>
      {!saved ? (
        <p className="banner warn">
          <Bi en="The cma setting is missing from the database: run npx supabase db push." zh="資料庫中找不到 cma 設定：請執行 npx supabase db push。" />
        </p>
      ) : (
        <>
          <Info>
            <Bi
              en={`Your expected yearly return and volatility per class, which the compounding calculator (F2) reads, and Monte Carlo (F5) and the efficient frontier (F7) will.${saved.verifiedOn ? ` Last reviewed on ${saved.verifiedOn}.` : ''}`}
              zh={`各類別的預期年報酬與年化波動度，供複利計算機（F2）使用，之後也供蒙地卡羅（F5）與效率前緣（F7）使用。${saved.verifiedOn ? `最後檢視日期：${saved.verifiedOn}。` : ''}`}
            />
          </Info>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.assetClass} />
                  </th>
                  <th className="num">
                    <Bi en="Expected return" zh="預期年報酬" />
                  </th>
                  <th className="num">
                    <Bi en="Volatility" zh="年化波動度" />
                  </th>
                  <th>
                    <Bi en="Source" zh="來源" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.classSettings.map((assetClass) => {
                  const assumption = saved.assumptions[assetClass.id];
                  return (
                    <tr key={assetClass.id}>
                      <td>
                        <Bi en={assetClass.nameEn} zh={assetClass.nameZh} />
                      </td>
                      <td className="num">{assumption ? percent(assumption.expectedReturn) : '—'}</td>
                      <td className="num">{assumption ? percent(assumption.volatility) : '—'}</td>
                      <td className="muted small">
                        {assumption?.auto ? (
                          <Link href="/allocation/assumptions#auto">
                            <Bi en="Auto-scored" zh="自動評分" /> {assumption.auto.asOf}
                          </Link>
                        ) : (
                          (assumption?.source ?? <Bi en="Not set yet" zh="尚未設定" />)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            {mix === null ? (
              <Bi
                en="Expected return: once every class has an assumption."
                zh="預期報酬：每個類別都設定假設後顯示。"
              />
            ) : (
              <Bi
                en={`The target mix expects about ${percent(mix)} a year: each class's target weight times its expected return.`}
                zh={`目標組合的預期年報酬約 ${percent(mix)}：各類別目標權重乘以其預期報酬後加總。`}
              />
            )}
          </p>
        </>
      )}
    </section>
  );
}

function ScopeFilter({ scope }: { scope: Scope }) {
  return (
    <div className="segmented" role="group" aria-label="Pool 資金池">
      <span className="label">
        <Bi en="Donut for" zh="圓餅圖資金池" />
      </span>
      {SCOPES.map((option) => (
        <Link prefetch key={option} href={option === 'regular' ? '/allocation' : `/allocation?scope=${option}`} aria-current={option === scope ? 'true' : undefined} scroll={false}>
          <Bi {...SCOPE[option]} />
        </Link>
      ))}
    </div>
  );
}

function Donut({ data, portfolio, scope }: { data: AllocationData; portfolio: Portfolio; scope: Scope }) {
  // The SAA's 80/20 is a target for the regular pool only.
  const split = allocation(portfolio.holdings, scope, scope === 'regular' ? sleeveTargets(data.assetClasses) : undefined);
  return (
    <section className="card form">
      <h2>
        <Bi en="Allocation donuts" zh="資產配置圓餅圖" />
      </h2>
      <Info>
        <Bi
          en="Listing country is where a fund trades, not what it owns: VT trades in the US but holds the world. Non-listed assets (physical gold, savings) count as not listed."
          zh="上市國家是交易所所在地，不等於實際投資地區：VT 在美國上市，但投資全球。非上市資產（實體黃金、存款）列為非上市。"
        />
      </Info>
      {split.totalTwd <= 0 ? (
        <p className="muted">
          <Bi en="This pool holds nothing priced yet." zh="這個資金池目前沒有已計價的持有。" />
        </p>
      ) : (
        <AllocationDonut
          slices={split.slices}
          withTarget={scope === 'regular'}
          label={{ en: 'Donut chart of the allocation; the table below lists every slice.', zh: '資產配置圓餅圖；下方表格列出每個區塊。' }}
        />
      )}
      {split.unpriced.length > 0 && (
        <p className="muted small">
          <Bi
            en={`Left out until priced: ${split.unpriced.map((holding) => holding.ticker ?? holding.label).join(', ')}.`}
            zh={`尚未計價，暫不列入：${split.unpriced.map((holding) => holding.ticker ?? holding.label).join('、')}。`}
          />
        </p>
      )}
    </section>
  );
}

function Method() {
  const notes: Bilingual[] = [
    {
      en: 'Actual weight: each class’s market value ÷ the regular pool, valued as on the holdings page; the windfall pool is left out, as the targets are set on regular contributions.',
      zh: '實際權重：各類別市值 ÷ 一般資金池，估值方式與持倉頁相同；大額資金池不計入，因為目標權重以一般投入資金為基礎。',
    },
    {
      en: 'The 5/25 band and the amber share live in the database (rules F8_DRIFT, config drift_display), not in code. Warnings and pushes for drift arrive with the rules engine (step 9) and Web Push (step 10).',
      zh: '5/25 門檻與黃色比例存在資料庫（rules 表 F8_DRIFT、config 表 drift_display），不寫在程式中。偏離的警示與推播將在規則引擎（第 9 步）與推播（第 10 步）完成。',
    },
    {
      en: 'The nightly job saves each day’s class weights with the NAV snapshot, so drift can be followed over time later.',
      zh: '每夜排程會把每天的類別權重存在淨值快照中，之後可以追蹤偏離的變化。',
    },
  ];
  return (
    <section className="card">
      <details>
        <summary>
          <Bi en="How these are worked out" zh="計算方式" />
        </summary>
        <ul>
          {notes.map((note) => (
            <li key={note.en}>
              <Bi {...note} />
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
