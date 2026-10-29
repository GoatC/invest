import Link from 'next/link';

import { AllocationDonut, DriftChart, type DriftRow } from '@/components/allocation-charts';
import { Bi, Zh } from '@/components/bi';
import { Info } from '@/components/info';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadAllocationData, type AllocationData } from '@/lib/data';
import { percent, points } from '@/lib/format';
import { DRIFT_ICON, DRIFT_STATUS, LABELS, POOL, SLEEVE, type Bilingual } from '@/lib/i18n';
import { allocation, classDrifts, satelliteCheck, sleeveTargets, type DriftStatus } from '@/lib/models/allocation';
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
  const rows: DriftRow[] = drifts.map((row) => ({
    id: row.assetClass.id,
    label: { en: row.assetClass.nameEn, zh: row.assetClass.nameZh },
    target: row.assetClass.targetWeight,
    weight: row.weight,
    drift: row.drift,
    band: row.band,
    status: row.status,
  }));
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
          <DriftChart
            rows={rows}
            label={{
              en: 'Horizontal bar chart of each asset class’s drift from its target, coloured by status; the table below lists the values.',
              zh: '各資產類別與目標權重偏離的橫條圖，依狀態上色；下方表格列出數值。',
            }}
          />
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
        </>
      )}
    </section>
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
                      <td className="muted small">{assumption?.source ?? <Bi en="Not set yet" zh="尚未設定" />}</td>
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
        <Link key={option} href={option === 'regular' ? '/allocation' : `/allocation?scope=${option}`} aria-current={option === scope ? 'true' : undefined} scroll={false}>
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
      en: 'The 5/25 band and the amber share live in the database (rules F8_DRIFT, config drift_display), not in code. Proposals and pushes for drift arrive with the rules engine (step 9) and Web Push (step 10).',
      zh: '5/25 門檻與黃色比例存在資料庫（rules 表 F8_DRIFT、config 表 drift_display），不寫在程式中。偏離的提案與推播將在規則引擎（第 9 步）與推播（第 10 步）完成。',
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
