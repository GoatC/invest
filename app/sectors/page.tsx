import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { Info } from '@/components/info';
import { SectorBubbles, SectorHeatmap, SectorTreemap, type Bubble, type HeatRow, type SectorBox } from '@/components/sector-charts';
import { requireSession } from '@/lib/auth';
import { DataError, loadSectorData, type SectorData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { percent, signedPercent, twd } from '@/lib/format';
import { LABELS, POOL, type Bilingual } from '@/lib/i18n';
import { countryText, sectorText } from '@/lib/look-through-text';
import { PERIODS, type Period, type SectorRow, type SectorView } from '@/lib/models/sectors';

import { SectorSettingsForm } from './forms';

type Params = Record<string, string | string[] | undefined>;
type View = 'heatmap' | 'treemap' | 'bubble';
type MarketFilter = 'all' | 'US' | 'TW';
type PoolFilter = 'all' | 'regular' | 'windfall';

const VIEWS: Record<View, Bilingual> = {
  heatmap: { en: 'Heatmap', zh: '熱力圖' },
  treemap: { en: 'Treemap', zh: '板塊圖' },
  bubble: { en: 'Bubbles', zh: '泡泡圖' },
};
const PERIOD: Record<Period, Bilingual> = {
  '1W': { en: '1 week', zh: '1 週' },
  '1M': { en: '1 month', zh: '1 月' },
  '3M': { en: '3 months', zh: '3 月' },
  YTD: { en: 'Year to date', zh: '今年以來' },
  '1Y': { en: '1 year', zh: '1 年' },
};
const MARKET: Record<MarketFilter, Bilingual> = { all: { en: 'Both markets', zh: '兩個市場' }, US: { en: 'US', zh: '美國' }, TW: { en: 'Taiwan', zh: '台灣' } };
const POOLS: Record<PoolFilter, Bilingual> = { all: { en: 'Both pools', zh: '兩個資金池' }, regular: POOL.regular, windfall: POOL.windfall };

function pick<T extends string>(raw: string | string[] | undefined, options: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (options as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function rowLabel(row: SectorRow): string {
  const sector = sectorText(row.sector);
  return `${sector.en} ${sector.zh} · ${row.market === 'US' ? 'US 美' : 'TW 台'}`;
}

/** Links that keep the other choices: the page's tabs, period, market and pool. */
function Segmented<T extends string>({ label, value, options, labels, href }: { label: Bilingual; value: T; options: readonly T[]; labels: Record<T, Bilingual>; href: (value: T) => string }) {
  return (
    <div className="segmented" role="group" aria-label={`${label.en} ${label.zh}`}>
      <span className="label">
        <Bi {...label} />
      </span>
      {options.map((option) => (
        <Link key={option} href={href(option)} aria-current={option === value ? 'true' : undefined}>
          <Bi {...labels[option]} />
        </Link>
      ))}
    </div>
  );
}

/** N7 (PRD Module C): which sectors are moving, and how much of the portfolio sits in each. */
export default async function SectorsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const view = pick<View>(params['view'], ['heatmap', 'treemap', 'bubble'], 'heatmap');
  const period = pick<Period>(params['period'], PERIODS, '1M');
  const market = pick<MarketFilter>(params['market'], ['all', 'US', 'TW'], 'all');
  const pool = pick<PoolFilter>(params['pool'], ['all', 'regular', 'windfall'], 'all');
  const sector = typeof params['sector'] === 'string' ? params['sector'] : undefined;
  let data: SectorData;
  try {
    data = await loadSectorData(supabase, taipeiToday(), pool === 'all' ? undefined : pool);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  if (!data.settings || !data.view) return <DataProblem table="config" detail="sectors or look_through is missing or malformed" />;
  const href = (changes: Partial<{ view: View; period: Period; market: MarketFilter; pool: PoolFilter; sector: string }>) => {
    const next = new URLSearchParams({ view, period, market, pool, ...changes });
    return `/sectors?${next}`;
  };
  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.sectors} />
        </h1>
        <p className="muted small">
          <Bi
            en={`Closes to ${data.view.asOf ?? '—'} · display only: no rule, no push`}
            zh={`收盤價至 ${data.view.asOf ?? '—'} · 僅供參考：不設規則、不推播`}
          />
        </p>
        <div className="filters">
          <Segmented label={{ en: 'Chart', zh: '圖表' }} value={view} options={['heatmap', 'treemap', 'bubble'] as const} labels={VIEWS} href={(one) => href({ view: one })} />
          {view !== 'treemap' && <Segmented label={{ en: 'Market', zh: '市場' }} value={market} options={['all', 'US', 'TW'] as const} labels={MARKET} href={(one) => href({ market: one })} />}
          {view === 'treemap' && <Segmented label={{ en: 'Period', zh: '期間' }} value={period} options={PERIODS} labels={PERIOD} href={(one) => href({ period: one })} />}
          {view !== 'heatmap' && <Segmented label={LABELS.pool} value={pool} options={['all', 'regular', 'windfall'] as const} labels={POOLS} href={(one) => href({ pool: one })} />}
        </div>
        {view === 'heatmap' && <Heatmap view={data.view} market={market} convention={data.settings.colour} />}
        {view === 'treemap' && <Treemap view={data.view} period={period} convention={data.settings.colour} data={data} sector={sector} href={(one) => href({ sector: one })} />}
        {view === 'bubble' && <Bubbles view={data.view} market={market} />}
        <Info>
          <Bi
            en="US sectors are priced by the Select Sector SPDR funds (dividends reinvested), Taiwan's by the TWSE industry indices (price indices, without dividends), each mapped to one of the 11 GICS sectors in the settings below; a sector with several Taiwan indices takes their average. Exposure comes from the look-through: each company held through the funds or directly, by its sector and country; companies elsewhere count in the treemap but have no proxy here. Volatility is the standard deviation of the last 52 weekly returns × √52."
            zh="美國產業以 Select Sector SPDR 基金計價（股利再投入），台灣產業以證交所類股指數計價（價格指數，不含股利），各自對應到下方設定中的 GICS 11 個產業；同一產業有多個台灣指數時取平均。曝險取自合併透視：透過基金或直接持有的每家公司，依其產業與國家歸類；其他國家的公司計入板塊圖，但這裡沒有代理指數。波動度為最近 52 週週報酬的標準差 × √52。"
          />
        </Info>
      </section>
      <section className="card form" id="settings">
        <h2>
          <Bi en="Settings" zh="設定" />
        </h2>
        {params['saved'] === 'settings' && (
          <p className="banner ok" role="status">
            <Bi en="Saved; the change is in the edit history." zh="已儲存；修改已記錄在修改紀錄中。" />
          </p>
        )}
        <SectorSettingsForm settings={data.settings} />
      </section>
    </>
  );
}

function Heatmap({ view, market, convention }: { view: SectorView; market: MarketFilter; convention: 'red_up' | 'green_up' }) {
  const rows = view.rows.filter((row) => market === 'all' || row.market === market);
  const heat: HeatRow[] = rows.map((row) => ({ label: rowLabel(row), values: PERIODS.map((period) => row.returns[period]) }));
  return (
    <>
      <SectorHeatmap rows={heat} columns={PERIODS.map((period) => PERIOD[period])} convention={convention} label={{ en: 'Each sector’s return by period', zh: '各產業各期間報酬' }} />
      <div className="table-wrap">
        <table className="compact" id="sector-returns">
          <thead>
            <tr>
              <th>
                <Bi en="Sector" zh="產業" />
              </th>
              {PERIODS.map((period) => (
                <th key={period} className="num">
                  <Bi {...PERIOD[period]} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.sector}-${row.market}`}>
                <td>
                  <Bi {...sectorText(row.sector)} /> <span className="muted small">{row.market === 'US' ? 'US' : 'TW'} · {row.proxies.map((id) => id.replace(/^TW_/, '')).join(', ')}</span>
                </td>
                {PERIODS.map((period) => (
                  <td key={period} className="num">
                    {row.returns[period] === null ? '—' : signedPercent(row.returns[period])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Treemap({ view, period, convention, data, sector, href }: { view: SectorView; period: Period; convention: 'red_up' | 'green_up'; data: SectorData; sector?: string; href: (sector: string) => string }) {
  const tiles = view.tiles.filter((tile) => tile.exposureTwd > 0);
  const boxes: SectorBox[] = tiles.map((tile) => ({ name: sectorText(tile.sector).en, exposureTwd: tile.exposureTwd, share: tile.share, value: tile.returns[period] }));
  const companies = sector ? (data.exposures ?? []).filter((exposure) => exposure.assetType === 'equity' && !exposure.whole && (exposure.sector ?? 'unclassified') === sector).sort((a, b) => b.valueTwd - a.valueTwd) : [];
  return (
    <>
      {boxes.length > 0 ? (
        <SectorTreemap boxes={boxes} convention={convention} label={{ en: 'The portfolio’s exposure by sector, coloured by return', zh: '投資組合各產業曝險，依報酬上色' }} />
      ) : (
        <p className="muted">
          <Bi en="No equity looked through in this pool yet." zh="此資金池尚無已展開的股票。" />
        </p>
      )}
      <div className="table-wrap">
        <table className="compact" id="sector-exposure">
          <thead>
            <tr>
              <th>
                <Bi en="Sector" zh="產業" />
              </th>
              <th className="num">
                <Bi en="Exposure" zh="曝險" />
              </th>
              <th className="num">
                <Bi en="Share" zh="比例" />
              </th>
              <th className="num">
                <Bi en="US · TW · elsewhere" zh="美 · 台 · 其他" />
              </th>
              <th className="num">
                <Bi {...PERIOD[period]} />
              </th>
            </tr>
          </thead>
          <tbody>
            {tiles.map((tile) => (
              <tr key={tile.sector}>
                <td>
                  <Link href={href(tile.sector)}>
                    <Bi {...sectorText(tile.sector)} />
                  </Link>
                </td>
                <td className="num">{twd(tile.exposureTwd)}</td>
                <td className="num">{percent(tile.share)}</td>
                <td className="num small">
                  {percent(tile.byMarket.US / tile.exposureTwd, 0)} · {percent(tile.byMarket.TW / tile.exposureTwd, 0)} · {percent(tile.byMarket.other / tile.exposureTwd, 0)}
                </td>
                <td className="num">{tile.returns[period] === null ? '—' : signedPercent(tile.returns[period])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sector && (
        <div id="sector-companies">
          <h3>
            <Bi {...sectorText(sector)} />
          </h3>
          <ul className="compact-list">
            {companies.slice(0, 25).map((exposure) => (
              <li key={exposure.key}>
                {exposure.name} <span className="muted small">{countryText(exposure.country ?? 'unknown').en}</span> · {twd(exposure.valueTwd)} ·{' '}
                <span className="small">
                  {Object.entries(exposure.via)
                    .sort((a, b) => b[1] - a[1])
                    .map(([route, value]) => `${route === 'direct' ? 'direct 直接' : route} ${twd(value)}`)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          {companies.length > 25 && (
            <p className="muted small">
              <Bi en={`${companies.length - 25} more on the Look-through page`} zh={`另外 ${companies.length - 25} 家見「合併透視」頁`} />
            </p>
          )}
        </div>
      )}
    </>
  );
}

function Bubbles({ view, market }: { view: SectorView; market: MarketFilter }) {
  const rows = view.rows.filter((row) => (market === 'all' || row.market === market) && row.returns['1Y'] !== null && row.volatility !== null);
  const bubbles: Bubble[] = rows.map((row) => ({ label: `${sectorText(row.sector).en} ${row.market}`, market: row.market, ret: row.returns['1Y'] as number, volatility: row.volatility as number, exposureTwd: row.exposureTwd }));
  return (
    <>
      <SectorBubbles bubbles={bubbles} portfolio={view.portfolio} label={{ en: 'Each sector’s 1-year return against its volatility, sized by exposure', zh: '各產業一年報酬對波動度，大小為曝險' }} />
      <div className="table-wrap">
        <table className="compact" id="sector-risk">
          <thead>
            <tr>
              <th>
                <Bi en="Sector" zh="產業" />
              </th>
              <th className="num">
                <Bi en="1-year return" zh="一年報酬" />
              </th>
              <th className="num">
                <Bi en="Volatility" zh="波動度" />
              </th>
              <th className="num">
                <Bi en="Exposure" zh="曝險" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.sector}-${row.market}`}>
                <td>
                  <Bi {...sectorText(row.sector)} /> <span className="muted small">{row.market}</span>
                </td>
                <td className="num">{signedPercent(row.returns['1Y'])}</td>
                <td className="num">{percent(row.volatility)}</td>
                <td className="num">{twd(row.exposureTwd)}</td>
              </tr>
            ))}
            {view.portfolio && (
              <tr>
                <td>
                  <strong>
                    <Bi en="Portfolio, by exposure" zh="投資組合（依曝險加權）" />
                  </strong>
                </td>
                <td className="num">{signedPercent(view.portfolio.ret)}</td>
                <td className="num">{percent(view.portfolio.volatility)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
