import Link from 'next/link';

import { Bi } from '@/components/bi';
import { Info } from '@/components/info';
import type { requireSession } from '@/lib/auth';
import { DataError, loadRedFlagData, loadWorkbench, orDataError, type WorkbenchData } from '@/lib/data';
import { money, percent, signedPercent } from '@/lib/format';
import { LABELS } from '@/lib/i18n';
import type { ValuationSettings } from '@/lib/models/intrinsic';
import type { Assessment } from '@/lib/models/red-flags';
import { LIGHT_ICON, lightText } from '@/lib/red-flag-text';

import { watchStock } from './actions';
import { ValuationSettingsForm } from './forms';
import { alertBasis, MODEL, percentField, scenarioFields, ZONE } from './shared';

type Params = Record<string, string | string[] | undefined>;
type Supabase = Awaited<ReturnType<typeof requireSession>>['supabase'];

const text = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

/**
 * F12's watchlist and its defaults, on the holdings page (they had a page of their own): each
 * watched or held stock's value against its price, its zone and its red-flag light. Each stock's
 * workbench stays at /valuation?t=…. Reads `valuation`, `valuation-error` and `missing` from the
 * address, which the valuation actions redirect with.
 */
export async function ValuationOverview({ supabase, today, params }: { supabase: Supabase; today: string; params: Params }) {
  const data = await orDataError(loadWorkbench(supabase, today));
  if (data instanceof DataError || !data.settings) {
    return (
      <p className="banner info" role="status" id="valuation">
        <Bi
          en={`Could not read the valuations (${data instanceof DataError ? `${data.table}: ${data.detail}` : 'config valuation is missing'}); if the app was just updated, run npx supabase db push.`}
          zh={`無法讀取估值（${data instanceof DataError ? `${data.table}：${data.detail}` : '找不到 config 的 valuation'}）；如果剛更新過程式，請執行 npx supabase db push。`}
        />
      </p>
    );
  }
  const flags = await orDataError(loadRedFlagData(supabase, today));
  const lights = new Map(flags instanceof DataError ? [] : flags.companies.map((company) => [company.security.ticker, company.assessment]));
  return <Watchlist data={data} settings={data.settings} today={today} saved={params['valuation'] === 'settings'} error={text(params['valuation-error'])} missing={text(params['missing'])} lights={lights} />;
}

function Watchlist({ data, settings, today, saved, error, missing, lights }: { data: WorkbenchData; settings: ValuationSettings; today: string; saved: boolean; error?: string | undefined; missing?: string | undefined; lights: ReadonlyMap<string, Assessment> }) {
  const addable = [...data.others, ...data.stocks.filter((stock) => !stock.watch).map((stock) => stock.security)].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return (
    <>
      <section className="card form" id="valuation">
        <h2>
          <Bi en="Valuation, single stocks" zh="估值（個股）" />
        </h2>
        <p className="equation">
          <Bi en="Margin of safety = (value − price) ÷ value" zh="安全邊際 ＝（內在價值 − 股價）÷ 內在價值" />
        </p>
        {(error || missing) && (
          <p className="banner danger" role="alert">
            <Bi en={missing ? `${missing} is not a watched or held single stock.` : `Could not save: ${error}`} zh={missing ? `${missing} 不是觀察中或持有的個股。` : `無法儲存：${error}`} />
          </p>
        )}
        {data.stocks.length === 0 ? (
          <p className="muted">
            <Bi en="No single stock watched or held yet." zh="尚無觀察中或持有的個股。" />
          </p>
        ) : (
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.ticker} />
                  </th>
                  <th className="num">
                    <Bi en="Price" zh="股價" />
                  </th>
                  <th className="num">
                    <Bi en="Value, base" zh="內在價值（基本）" />
                  </th>
                  <th className="num">
                    <Bi en="Margin of safety" zh="安全邊際" />
                  </th>
                  <th>
                    <Bi en="Zone" zh="區間" />
                  </th>
                  <th className="num">
                    <Bi en="To buy / trim" zh="距買入／減碼" />
                  </th>
                  <th>
                    <Bi {...LABELS.redFlags} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.stocks.map((bench) => {
                  const basis = alertBasis(bench, data.rules);
                  const zone = basis.zone ? ZONE[basis.zone.zone] : undefined;
                  return (
                    <tr key={bench.security.ticker}>
                      <td>
                        <Link href={`/valuation?t=${encodeURIComponent(bench.security.ticker)}`}>{bench.security.ticker}</Link>
                        {bench.held && (
                          <span className="badge">
                            <Bi en="held" zh="持有" />
                          </span>
                        )}
                        {bench.watch && !bench.watch.active && (
                          <span className="badge warn">
                            <Bi en="alerts off" zh="警報關閉" />
                          </span>
                        )}
                        <div className="muted small">{bench.security.name}</div>
                      </td>
                      <td className="num">{basis.price ? money(basis.price.close, bench.security.currency) : '—'}</td>
                      <td className="num">
                        {basis.saved ? money(basis.saved.base, bench.security.currency) : '—'}
                        <div className="muted small">
                          {basis.saved ? <Bi en={`${MODEL[basis.saved.model].en} · ${basis.saved.date}`} zh={`${MODEL[basis.saved.model].zh} · ${basis.saved.date}`} /> : <Bi en="not saved" zh="尚未儲存" />}
                        </div>
                      </td>
                      <td className="num">{basis.margin === undefined ? '—' : signedPercent(basis.margin)}</td>
                      <td className="nowrap">
                        {zone ? (
                          <>
                            <span className={`status-icon ${zone.tone === 'alert' ? 'rebalance' : zone.tone}`} aria-hidden="true">
                              {zone.tone === 'ok' ? '✓' : zone.tone === 'watch' ? '!' : '✕'}
                            </span>{' '}
                            <Bi {...zone.label} />
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num nowrap">{basis.zone ? `−${percent(basis.zone.toBuy)} / +${percent(basis.zone.toTrim)}` : '—'}</td>
                      <td className="nowrap">
                        {(() => {
                          const flag = lights.get(bench.security.ticker);
                          if (!flag) return '—';
                          const icon = LIGHT_ICON[flag.light ?? 'none'];
                          return (
                            <Link href={`/red-flags?t=${encodeURIComponent(bench.security.ticker)}`}>
                              <span className={`status-icon ${icon.className}`} aria-hidden="true">
                                {icon.icon}
                              </span>
                              <Bi {...lightText(flag.light)} />
                              <div className="muted small">{percent(flag.coverage / 100, 0)}</div>
                            </Link>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Info>
          <Bi
            en="Each stock is valued a share, bear / base / bull, by a two-stage DCF of its free cash flow to the firm at WACC, Gordon's dividend model and its P/E, P/B and EV/EBITDA against its peers and its own five years. The alerts read the base value of the model chosen for the stock, as last saved; the nightly job saves it again after each new quarter's filing."
            zh="每檔個股以三種方法估算每股內在價值（悲觀／基本／樂觀）：以 WACC 折現的兩階段公司自由現金流 DCF、Gordon 股利折現，以及相對同業與自身五年的本益比、股價淨值比、EV/EBITDA。警報採用該股所選模型最後儲存的基本情境數值；每夜排程在新一季財報公布後重新儲存。"
          />
        </Info>
        {addable.length > 0 && (
          <form action={watchStock} className="row">
            <select name="ticker" aria-label="Stock 個股" defaultValue={addable[0]?.ticker}>
              {addable.map((security) => (
                <option key={security.ticker} value={security.ticker}>
                  {security.ticker} {security.name}
                </option>
              ))}
            </select>
            <button type="submit" className="button">
              <Bi en="Watch" zh="加入觀察清單" />
            </button>
          </form>
        )}
        <p className="muted small">
          <Bi en="A stock not listed: add it to the securities below as a single stock." zh="清單中沒有的個股：請先在下方「證券主檔」以個股新增。" />
        </p>
      </section>

      <section className="card form" id="valuation-settings">
        <details open={saved}>
          <summary>
            <Bi en="Valuation defaults" zh="估值預設值" />
          </summary>
          {saved && (
            <p className="banner ok" role="status">
              <Bi en="Defaults saved." zh="已儲存預設值。" />
            </p>
          )}
          <ValuationSettingsForm
            markets={Object.keys(settings.taxRate)}
            initial={{
              model: settings.model,
              years: String(settings.years),
              ...scenarioFields('growth', settings.growth),
              ...scenarioFields('terminal', settings.terminal),
              debtSpread: percentField(settings.debtSpread),
              ...Object.fromEntries(Object.entries(settings.taxRate).map(([market, value]) => [`tax_${market}`, percentField(value)])),
              historyYears: String(settings.historyYears),
              minQuarters: String(settings.minQuarters),
            }}
            today={today}
            checkedOn={settings.checked}
          />
        </details>
      </section>
    </>
  );
}

