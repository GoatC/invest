import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { Facts } from '@/components/facts';
import { Info } from '@/components/info';
import { ExposureTreemap, type TreemapBox } from '@/components/look-through-charts';
import { requireSession } from '@/lib/auth';
import { DataError, loadLookThroughData, type LookThroughData } from '@/lib/data';
import { percent, twd } from '@/lib/format';
import { feedLabel, LABELS, type Bilingual } from '@/lib/i18n';
import { ASSET_TYPE, countryText, currencyText, sectorText } from '@/lib/look-through-text';
import type { Exposure, LookThrough, Slice } from '@/lib/models/look-through';

import { LookThroughSettingsForm } from './forms';

type Params = Record<string, string | string[] | undefined>;

/** Sectors in colour: the largest seven take a slot each, the rest share the grey. */
const COLOURED = 7;

function routes(exposure: Exposure): Bilingual {
  const parts = Object.entries(exposure.via).sort((a, b) => b[1] - a[1]);
  return {
    en: parts.map(([route, value]) => `${route === 'direct' ? 'direct' : route} ${twd(value)}`).join(' · '),
    zh: parts.map(([route, value]) => `${route === 'direct' ? '直接持有' : route} ${twd(value)}`).join(' · '),
  };
}

function Slices({ id, title, slices, label }: { id: string; title: Bilingual; slices: readonly Slice[]; label: (key: string) => Bilingual }) {
  return (
    <div id={id}>
      <h3>
        <Bi {...title} />
      </h3>
      <table className="compact">
        <tbody>
          {slices.slice(0, 12).map((slice) => (
            <tr key={slice.key}>
              <td>
                <Bi {...label(slice.key)} />
              </td>
              <td className="num">{percent(slice.share)}</td>
              <td className="num muted">{twd(slice.valueTwd)}</td>
            </tr>
          ))}
          {slices.length > 12 && (
            <tr>
              <td className="muted">
                <Bi en={`${slices.length - 12} more`} zh={`另外 ${slices.length - 12} 項`} />
              </td>
              <td className="num muted">{percent(slices.slice(12).reduce((sum, slice) => sum + slice.share, 0))}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** F14 (PRD Module C): the whole portfolio with every fund opened up. */
export default async function LookThroughPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  let data: LookThroughData;
  try {
    data = await loadLookThroughData(supabase);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  if (!data.settings || !data.result) return <DataProblem table="config" detail="look_through is missing or malformed" />;
  return <View data={data} result={data.result} saved={params['saved'] === 'settings'} />;
}

function View({ data, result, saved }: { data: LookThroughData; result: LookThrough; saved: boolean }) {
  const settings = data.settings as NonNullable<LookThroughData['settings']>;
  const coloured = result.sectors.filter((slice) => slice.key !== 'unclassified').slice(0, COLOURED).map((slice) => slice.key);
  const slotOf = (sector: string | null) => {
    const index = sector ? coloured.indexOf(sector) : -1;
    return index < 0 ? null : index;
  };
  const boxes: TreemapBox[] = result.companies.map((exposure) => ({ name: exposure.ticker && !exposure.name.includes(exposure.ticker) ? `${exposure.name} (${exposure.ticker})` : exposure.name, valueTwd: exposure.valueTwd, share: exposure.valueTwd / result.totalTwd, slot: slotOf(exposure.sector), sector: sectorText(exposure.sector) }));
  if (result.otherCompaniesTwd > 0) boxes.push({ name: `+${result.otherCompaniesCount}`, valueTwd: result.otherCompaniesTwd, share: result.otherCompaniesTwd / result.totalTwd, slot: null, sector: { en: `${result.otherCompaniesCount} other companies`, zh: `其他 ${result.otherCompaniesCount} 家公司` } });
  const legend = [...coloured.map((sector, slot) => ({ label: sectorText(sector), slot })), { label: { en: 'Other sectors, not classified, the rest', zh: '其他產業、未分類與其餘公司' }, slot: null }];
  const top = result.companies[0];
  const costs = new Map(data.fundCosts.map((fund) => [fund.ticker, fund]));
  const domicile = new Map(data.securities.map((security) => [security.ticker, security.domicile]));
  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.lookThrough} />
        </h1>
        <p className="equation">
          <Bi en="Company exposure = Σ fund value × the company's weight in the fund + the value held directly" zh="公司曝險 ＝ Σ 基金市值 × 該公司在基金中的權重 ＋ 直接持有市值" />
        </p>
        <Facts
          facts={[
            { label: { en: 'Portfolio, both pools', zh: '投資組合（兩個資金池）' }, value: twd(result.totalTwd) },
            { label: { en: 'Looked through', zh: '已展開' }, value: percent(result.lookedThrough), note: { en: 'the rest is funds without a holdings file', zh: '其餘為沒有成分股檔案的基金' }, tone: result.lookedThrough >= 0.5 ? 'ok' : 'watch' },
            { label: { en: 'Companies', zh: '公司數' }, value: String(result.companies.length + result.otherCompaniesCount) },
            ...(top ? [{ label: { en: 'Largest company', zh: '最大曝險公司' }, value: `${top.name} ${percent(top.valueTwd / result.totalTwd)}` }] : []),
          ]}
        />
        {boxes.length > 0 ? (
          <ExposureTreemap boxes={boxes} legend={legend} label={{ en: 'Exposure to each company, core and satellite together', zh: '核心與衛星合併後的各公司曝險' }} />
        ) : (
          <p className="muted">
            <Bi en="No company held yet, directly or through a fund with a holdings file." zh="尚未持有任何公司（直接持有或透過有成分股檔案的基金）。" />
          </p>
        )}
        <div className="table-wrap">
          <table className="compact" id="companies">
            <thead>
              <tr>
                <th>
                  <Bi en="Company" zh="公司" />
                </th>
                <th>
                  <Bi en="Country · sector" zh="國家 · 產業" />
                </th>
                <th className="num">
                  <Bi en="Exposure" zh="曝險" />
                </th>
                <th className="num">
                  <Bi en="Share" zh="比例" />
                </th>
                <th>
                  <Bi en="Through" zh="來源" />
                </th>
              </tr>
            </thead>
            <tbody>
              {result.companies.map((exposure) => (
                <tr key={exposure.key}>
                  <td>
                    {exposure.name}
                    {exposure.ticker && <div className="muted small">{exposure.ticker}</div>}
                  </td>
                  <td className="small">
                    <Bi en={`${countryText(exposure.country ?? 'unknown').en} · ${sectorText(exposure.sector).en}`} zh={`${countryText(exposure.country ?? 'unknown').zh} · ${sectorText(exposure.sector).zh}`} />
                  </td>
                  <td className="num">{twd(exposure.valueTwd)}</td>
                  <td className="num">{percent(exposure.valueTwd / result.totalTwd, 2)}</td>
                  <td className="small">
                    <Bi {...routes(exposure)} />
                  </td>
                </tr>
              ))}
              {result.otherCompaniesCount > 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    <Bi en={`${result.otherCompaniesCount} other companies`} zh={`其他 ${result.otherCompaniesCount} 家公司`} />
                  </td>
                  <td className="num">{twd(result.otherCompaniesTwd)}</td>
                  <td className="num">{percent(result.otherCompaniesTwd / result.totalTwd, 2)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Info>
          <Bi
            en="Each fund is opened up with its issuer's newest holdings file, read by the nightly job once a month (Vanguard for VT and VOO, Fubon for 00692); a company is matched across funds and direct holdings by its ISIN's country and ticker, so TSMC through VT, through 00692 and held directly is one line. Countries are where the issuer is registered, not where it trades; sectors are GICS, from the Select Sector SPDR funds for S&P 500 members and from the TWSE industry for Taiwan companies. A fund without a holdings file counts whole, in its trade currency."
            zh="每檔基金以發行商最新的成分股檔案展開，由每夜排程每月讀取一次（VT、VOO 取自 Vanguard，00692 取自富邦）；公司以 ISIN 國家與代號在各基金與直接持股間比對，因此透過 VT、00692 與直接持有的台積電合併為一列。國家為發行公司註冊地，不是交易所在地；產業為 GICS，S&P 500 成分股取自 Select Sector SPDR 基金，台股取自證交所產業別。沒有成分股檔案的基金以整檔計算，幣別為其交易幣別。"
          />
        </Info>
      </section>
      <section className="card form" id="exposure">
        <h2>
          <Bi en="Country, sector and currency" zh="國家、產業與幣別" />
        </h2>
        <div className="grid-two">
          <Slices id="countries" title={{ en: 'Country (issuer)', zh: '國家（發行公司）' }} slices={result.countries} label={countryText} />
          <Slices id="sectors" title={{ en: 'Sector, of the equity looked through', zh: '產業（已展開的股票）' }} slices={result.sectors} label={(key) => sectorText(key)} />
          <Slices id="currencies" title={{ en: 'Currency', zh: '幣別' }} slices={result.currencies} label={currencyText} />
          <Slices id="asset-types" title={{ en: 'Asset type', zh: '資產類型' }} slices={result.assetTypes} label={(key) => ASSET_TYPE[key as keyof typeof ASSET_TYPE] ?? { en: key, zh: key }} />
        </div>
      </section>
      <section className="card form" id="funds">
        <h2>
          <Bi en="Funds" zh="基金" />
        </h2>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi {...LABELS.ticker} />
                </th>
                <th className="num">
                  <Bi en="Value" zh="市值" />
                </th>
                <th>
                  <Bi en="Holdings file" zh="成分股檔案" />
                </th>
                <th>
                  <Bi en="Domicile" zh="註冊地" />
                </th>
                <th className="num">TER</th>
                <th className="num">
                  <Bi en="Tracking diff." zh="追蹤差異" />
                </th>
              </tr>
            </thead>
            <tbody>
              {result.funds.map((fund) => {
                const cost = costs.get(fund.ticker);
                const home = cost?.domicile ?? domicile.get(fund.ticker) ?? '—';
                return (
                  <tr key={fund.ticker}>
                    <td>{fund.ticker}</td>
                    <td className="num">{twd(fund.valueTwd)}</td>
                    <td className="small">
                      {fund.asOf ? (
                        <Bi
                          en={`${fund.asOf} · ${feedLabel(fund.source ?? '').en} · ${fund.constituents} lines, ${percent(fund.named, 0)} named`}
                          zh={`${fund.asOf} · ${feedLabel(fund.source ?? '').zh} · ${fund.constituents} 檔，列名 ${percent(fund.named, 0)}`}
                        />
                      ) : (
                        <Bi en="None: counted whole" zh="無：以整檔計算" />
                      )}
                    </td>
                    <td className="small">
                      {home}
                      {home === 'US' && (
                        <div className="muted">
                          <Bi en="30% withholding, US estate tax" zh="股利預扣 30%、美國遺產稅" />
                        </div>
                      )}
                    </td>
                    <td className="num">{cost?.ter === null || cost?.ter === undefined ? '—' : percent(cost.ter, 2)}</td>
                    <td className="num">{cost?.trackingDifference === null || cost?.trackingDifference === undefined ? '—' : percent(cost.trackingDifference, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          <Bi en="TER and tracking difference from the fund costs on the Costs page." zh="總費用率與追蹤差異取自「費用與稅務」頁的基金成本。" />{' '}
          <Link href="/costs">
            <Bi en="Costs" zh="費用與稅務" />
          </Link>
        </p>
        {result.overlaps.length > 0 && (
          <>
            <h3>
              <Bi en="Overlap between funds" zh="基金間重疊" />
            </h3>
            <table className="compact" id="overlaps">
              <tbody>
                {result.overlaps.map((pair) => (
                  <tr key={`${pair.a}-${pair.b}`}>
                    <td>
                      {pair.a} × {pair.b}
                    </td>
                    <td className="num">{percent(pair.overlap)}</td>
                    <td className="small muted">
                      <Bi en={`${pair.common} companies in both`} zh={`共同持有 ${pair.common} 家公司`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="equation">
              <Bi en="Overlap = Σ over the companies both hold of the smaller weight" zh="重疊度 ＝ Σ 兩檔共同持有公司的較小權重" />
            </p>
          </>
        )}
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
        <LookThroughSettingsForm settings={settings} />
      </section>
    </>
  );
}
