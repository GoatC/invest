import { Bi, Zh } from '@/components/bi';
import { DeleteForm } from '@/components/delete-form';
import { DataProblem } from '@/components/data-problem';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import { VolatilityChart } from '@/components/volatility-chart';
import { requireSession } from '@/lib/auth';
import { DataError, loadNewsAlerts, loadNewsSettings, loadShadowLog, loadVolatilityData, NEWS_PAGE_DAYS, orDataError, type VolatilityData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { signedPercent, twd } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { type MarketEvent } from '@/lib/models/events';
import type { NewsAlert, NewsSettings } from '@/lib/models/news';
import { hitRates, HORIZONS, type ShadowRow } from '@/lib/models/shadow';
import { COMPONENT_SHORT, COMPONENT_TEXT, bandOf, figureText } from '@/lib/volatility-text';

import { deleteMarketEvent } from './actions';
import { EventForm, NewsSettingsForm, VolatilitySettingsForm } from './forms';

type Params = Record<string, string | string[] | undefined>;

/** Rows shown before a list folds the rest under "more". */
const SHOWN = 5;
const SAVED: Bilingual = { en: 'Saved', zh: '已儲存' };
const NONE: Bilingual = { en: 'None yet', zh: '尚無' };
const MORE: Bilingual = { en: 'More', zh: '更多' };
const SETTINGS: Bilingual = { en: 'Settings', zh: '設定' };

/** "11-07 15:40" in Taipei. */
function taipeiShort(at: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return `${parts['month']}-${parts['day']} ${parts['hour']}:${parts['minute']}`;
}

/**
 * N8 (added 2026-11-06): the volatility score, breaking news, the alert record and the coming
 * events. Few words (CLAUDE.md): figures as tiles, explanations behind ⓘ, lists and settings folded.
 */
export default async function VolatilityPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const saved = typeof params['saved'] === 'string' ? params['saved'] : undefined;
  const today = taipeiToday();
  const shadow = orDataError(loadShadowLog(supabase));
  const news = orDataError(
    loadNewsSettings(supabase).then(async (settings) => ({ settings, alerts: settings ? await loadNewsAlerts(supabase, settings, new Date(Date.now() - NEWS_PAGE_DAYS * 86_400_000).toISOString()) : null })),
  );
  let data: VolatilityData;
  try {
    data = await loadVolatilityData(supabase, today);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  if (!data.settings || !data.today) return <DataProblem table="config" detail="volatility is missing or malformed" />;
  const result = data.today;
  const band = result.score === null ? null : bandOf(result.score);
  const newest = result.components.reduce<string | null>((max, row) => (row.date && (!max || row.date > max) ? row.date : max), null);
  const facts: Fact[] = [
    { label: { en: 'Score', zh: '分數' }, value: result.score === null ? '—' : `${result.score.toFixed(1)}/10`, note: band?.label ?? { en: 'Data too old', zh: '資料過舊' }, tone: band?.tone ?? 'watch' },
    { label: { en: 'Updated', zh: '更新' }, value: newest ?? '—', tone: data.lastRun ? (data.lastRun.status === 'ok' ? 'ok' : data.lastRun.status === 'partial' ? 'watch' : 'alert') : 'none' },
  ];
  return (
    <>
      <section className="card form">
        <h1>
          <Zh {...LABELS.volatility} />
        </h1>
        <Facts facts={facts} />
        <VolatilityChart points={data.history ?? []} />
        <details>
          <summary>
            <Bi en={`Components · ${Math.round(result.coverage * 100)}% covered`} zh={`成分 · 涵蓋 ${Math.round(result.coverage * 100)}%`} />
          </summary>
          <div className="table-wrap">
            <table className="compact" id="volatility-components">
              <thead>
                <tr>
                  <th />
                  <th className="num">
                    <Bi en="Figure" zh="數值" />
                  </th>
                  <th className="num">0–10</th>
                </tr>
              </thead>
              <tbody>
                {result.components.map((row) => (
                  <tr key={row.id} className={row.status === 'ok' && row.weight > 0 ? undefined : 'muted'}>
                    <td>
                      <Bi {...COMPONENT_SHORT[row.id]} />
                    </td>
                    <td className="num">{figureText(row.id, row.value)}</td>
                    <td className="num">{row.status === 'stale' ? <Bi en="old" zh="舊" /> : row.subScore === null ? '—' : row.subScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <Info>
          <Bi
            en={`Each component scores 0 at its calm figure and 10 at its panic figure (see Settings); the score is 1 + 0.9 × their weighted mean. Figures older than ${data.settings.maxAgeDays} days are left out; under ${Math.round(data.settings.minCoverage * 100)}% of the weight there is no score. Crossing 6 (tense) or 8 (panic) pushes a warning (VOLATILITY_ALERT), even in the quiet hours; below 4 a small hedge (VOLATILITY_HEDGE). Sources: ${result.components.map((row) => `${COMPONENT_TEXT[row.id].name.en}, ${COMPONENT_TEXT[row.id].source}`).join('; ')}. Market data only; not advice.`}
            zh={`每個成分在平靜值得 0 分、恐慌值得 10 分（見設定）；總分 = 1 ＋ 0.9 × 加權平均。超過 ${data.settings.maxAgeDays} 天的數值不計入；涵蓋權重低於 ${Math.round(data.settings.minCoverage * 100)}% 時不計分。穿越 6（緊張）或 8（恐慌）時推播警示（VOLATILITY_ALERT），安靜時段照送；低於 4 時小量避險（VOLATILITY_HEDGE）。來源：${result.components.map((row) => `${COMPONENT_TEXT[row.id].name.zh}，${COMPONENT_TEXT[row.id].source}`).join('；')}。僅為市場數據，不構成投資建議。`}
          />
        </Info>
        <details id="settings" open={saved === 'settings'}>
          <summary>
            <Bi {...SETTINGS} />
          </summary>
          {saved === 'settings' && (
            <p className="banner ok" role="status">
              <Bi {...SAVED} />
            </p>
          )}
          <VolatilitySettingsForm settings={data.settings} />
        </details>
      </section>
      <News data={await news} saved={saved} />
      <ShadowLog rows={await shadow} />
      <Events events={data.events ?? null} leadDays={data.settings.events.leadDays} saved={saved} />
    </>
  );
}

/** Breaking news (step 4): topics many outlets report at once, far above their usual count. */
function News({ data, saved }: { data: { settings: NewsSettings | undefined; alerts: NewsAlert[] | null } | DataError; saved?: string }) {
  if (data instanceof DataError) return <DataProblem table={data.table} detail={data.detail} />;
  const { settings, alerts } = data;
  const line = (alert: NewsAlert) => {
    const top = alert.headlines[0];
    return (
      <li key={alert.id}>
        <span className="nowrap">{taipeiShort(alert.detectedAt)}</span> <Bi {...alert.topic.name} /> · {alert.sources}{' '}
        {top && (
          <a href={top.url} target="_blank" rel="noreferrer">
            {top.title}
          </a>
        )}
      </li>
    );
  };
  return (
    <section className="card form" id="news">
      <h2>
        <Bi en="Breaking news" zh="前沿新聞" />
      </h2>
      {saved === 'news' && (
        <p className="banner ok" role="status">
          <Bi {...SAVED} />
        </p>
      )}
      {!settings || alerts === null ? (
        <p className="muted">
          <Bi en="Not set up: npx supabase db push" zh="尚未設定：npx supabase db push" />
        </p>
      ) : alerts.length === 0 ? (
        <p className="muted">
          <Bi {...NONE} />
        </p>
      ) : (
        <>
          <ul className="compact-list" id="news-list">
            {alerts.slice(0, SHOWN).map(line)}
          </ul>
          {alerts.length > SHOWN && (
            <details>
              <summary>
                <Bi {...MORE} />
              </summary>
              <ul className="compact-list">{alerts.slice(SHOWN).map(line)}</ul>
            </details>
          )}
        </>
      )}
      {settings && (
        <>
          <Info>
            <Bi
              en={`Every 30 minutes Google News (English and Chinese) is asked for each topic's terms over the last ${settings.windowHours} hours, and the different outlets are counted. A topic alerts at ${settings.minSources} outlets or more and ${settings.spike} times its usual count (the median of the last ${settings.baselineDays} days; before half a day of counts, ${settings.spike * settings.minSources} outlets), once per ${settings.cooldownHours} hours${settings.pushInQuietHours ? ', even in the quiet hours' : ''}. The figure after the topic is the outlets counted. If Google News fails, CNBC, MarketWatch and cnyes stand in. Free feeds, no language model.`}
              zh={`每 30 分鐘以各主題的關鍵詞查詢 Google 新聞（英文與中文）近 ${settings.windowHours} 小時的報導，統計不同媒體家數。達 ${settings.minSources} 家以上、且為平常家數（近 ${settings.baselineDays} 天中位數；累積不到半天時為 ${settings.spike * settings.minSources} 家）的 ${settings.spike} 倍時通知，每 ${settings.cooldownHours} 小時最多一次${settings.pushInQuietHours ? '，安靜時段照送' : ''}。主題後的數字是報導家數。Google 新聞失敗時改用 CNBC、MarketWatch、鉅亨網。免費來源，不使用語言模型。`}
            />
          </Info>
          <details open={saved === 'news'}>
            <summary>
              <Bi {...SETTINGS} />
            </summary>
            <NewsSettingsForm settings={settings} />
          </details>
        </>
      )}
    </section>
  );
}

const BAND_TEXT: Record<string, Bilingual> = {
  calm: { en: 'Hedge', zh: '避險' },
  tense: { en: 'Tense', zh: '緊張' },
  panic: { en: 'Panic', zh: '恐慌' },
};

/** The alert record (step 3): how each alert's and hedge's proposed trades did afterwards, traded or not. */
function ShadowLog({ rows }: { rows: ShadowRow[] | DataError }) {
  if (rows instanceof DataError) return <DataProblem table={rows.table} detail={rows.detail} />;
  const rate = hitRates(rows)[20];
  const fact: Fact = {
    label: { en: 'Hit rate, 20 days', zh: '命中率（20 日）' },
    value: rate.hitRate === null ? '—' : `${Math.round(rate.hitRate * 100)}%`,
    ...(rate.measured > 0 ? { note: { en: `${rate.measured} measured`, zh: `${rate.measured} 份` } } : {}),
    tone: rate.hitRate === null ? 'none' : rate.hitRate >= 0.5 ? 'ok' : 'watch',
  };
  return (
    <section className="card form" id="shadow">
      <h2>
        <Bi en="Alert record" zh="影子紀錄" />
      </h2>
      <Facts facts={[fact]} />
      {rows.length > 0 && (
        <details>
          <summary>
            <Bi en={`Warnings (${rows.length})`} zh={`警示（${rows.length}）`} />
          </summary>
          <div className="table-wrap">
            <table className="compact" id="shadow-list">
              <thead>
                <tr>
                  <th />
                  <th />
                  <th />
                  {HORIZONS.map((sessions) => (
                    <th key={sessions} className="num">
                      {sessions}d
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const band = row.proposal.detail.volatility;
                  return (
                    <tr key={row.proposal.id}>
                      <td className="nowrap">
                        <a href={`/#proposal-${row.proposal.id}`}>{row.proposal.date}</a>
                      </td>
                      <td>
                        {band ? <Bi {...(BAND_TEXT[band.band] ?? { en: band.band, zh: band.band })} /> : '—'} {band?.score.toFixed(1)}
                      </td>
                      <td className="small">{row.trades.map((one) => `${one.side === 'buy' ? '+' : '−'}${one.ticker} ${twd(one.amountTwd)}`).join(' · ') || '—'}</td>
                      {HORIZONS.map((sessions) => (
                        <td key={sessions} className="num">
                          {row.returns[sessions] === null ? '…' : signedPercent(row.returns[sessions])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <Info>
        <Bi
          en="Each alert and hedge warning, traded or not: its trades from the price drafted at to the close 5, 20 and 60 trading days later, amount-weighted (a buy gains when the price rises, a sale when it falls); strategic cash, exchange rates and dividends left out. A hit is a return above 0. Judge it over several alerts before real money follows them."
          zh="每則警報與避險警示（不論是否下單）：各筆交易自提出價到 5、20、60 個交易日後收盤的報酬，依金額加權（買進漲則賺、賣出跌則賺），不計戰略現金、匯率與股利。報酬大於 0 即命中。請累積多次後再決定是否以真錢跟隨。"
        />
      </Info>
    </section>
  );
}

/** The coming events (step 2): from the feeds and typed in, a reminder pushed before each. */
function Events({ events, leadDays, saved }: { events: MarketEvent[] | null; leadDays: number; saved?: string }) {
  const row = (event: MarketEvent) => (
    <tr key={event.id ?? `${event.kind}${event.date}${event.name.en}`}>
      <td className="nowrap">
        {event.date.slice(5)}
        {event.time ? ` ${event.time}` : ''}
      </td>
      <td>
        <Bi {...event.name} />
      </td>
      <td>
        {event.source === 'typed' && event.id !== undefined && (
          <details>
            <summary>
              <Bi {...LABELS.delete} />
            </summary>
            <DeleteForm id={event.id} action={deleteMarketEvent} confirm={{ en: `Delete ${event.name.en} on ${event.date}?`, zh: `刪除 ${event.date} 的${event.name.zh}？` }} />
          </details>
        )}
      </td>
    </tr>
  );
  return (
    <section className="card form" id="events">
      <h2>
        <Bi en="Coming events" zh="近期事件" />
      </h2>
      {(saved === 'event' || saved === 'event-deleted') && (
        <p className="banner ok" role="status">
          <Bi {...SAVED} />
        </p>
      )}
      {events === null ? (
        <p className="muted">
          <Bi en="Not set up: npx supabase db push" zh="尚未設定：npx supabase db push" />
        </p>
      ) : events.length === 0 ? (
        <p className="muted">
          <Bi {...NONE} />
        </p>
      ) : (
        <div className="table-wrap">
          <table className="compact" id="event-list">
            <tbody>{events.slice(0, SHOWN).map(row)}</tbody>
          </table>
          {events.length > SHOWN && (
            <details>
              <summary>
                <Bi {...MORE} />
              </summary>
              <table className="compact">
                <tbody>{events.slice(SHOWN).map(row)}</tbody>
              </table>
            </details>
          )}
        </div>
      )}
      <details>
        <summary>
          <Bi en="Add" zh="新增" />
        </summary>
        <EventForm />
      </details>
      <Info>
        <Bi
          en={`Taipei times. FOMC decisions come from the Fed's calendar, US CPI and the jobs report from FRED's, reloaded twice a day; Taiwan's central bank meetings (its yearly press release) and elections are typed in here. A reminder is pushed ${leadDays} days before each, after the quiet hours, with no orders.`}
          zh={`台北時間。聯準會決議取自聯準會日程，美國 CPI 與非農就業取自 FRED，每天更新兩次；央行理監事會議（每年新聞稿）與選舉在此自行輸入。每個事件前 ${leadDays} 天推播提醒（安靜時段後送出），不附下單清單。`}
        />
      </Info>
    </section>
  );
}
