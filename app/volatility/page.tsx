import { Bi, Zh } from '@/components/bi';
import { DeleteForm } from '@/components/delete-form';
import { DataProblem } from '@/components/data-problem';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import { VolatilityChart } from '@/components/volatility-chart';
import { requireSession } from '@/lib/auth';
import { DataError, EVENT_PAGE_DAYS, loadVolatilityData, type VolatilityData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { LABELS } from '@/lib/i18n';
import { KIND_NAMES, whenText, type MarketEvent } from '@/lib/models/events';
import { COMPONENT_TEXT, STATUS_TEXT, bandOf, figureText } from '@/lib/volatility-text';

import { deleteMarketEvent } from './actions';
import { EventForm, VolatilitySettingsForm } from './forms';

type Params = Record<string, string | string[] | undefined>;

const RUN_STATUS = { ok: { en: 'OK', zh: '正常' }, partial: { en: 'Partly loaded', zh: '部分載入' }, failed: { en: 'Failed', zh: '失敗' } } as const;

/** N8 (added 2026-11-06): how stressed the markets are today, 1 calm to 10 panic, and what makes up the score. */
export default async function VolatilityPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
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
    {
      label: { en: 'Volatility score', zh: '波動分數' },
      value: result.score === null ? '—' : `${result.score.toFixed(1)} / 10`,
      note: band?.label ?? { en: 'Not enough fresh figures', zh: '近期數值不足' },
      tone: band?.tone ?? 'none',
    },
    {
      label: { en: 'Weight covered', zh: '涵蓋權重' },
      value: `${Math.round(result.coverage * 100)}%`,
      note: { en: `${Math.round(data.settings.minCoverage * 100)}% needed`, zh: `需 ${Math.round(data.settings.minCoverage * 100)}%` },
      tone: result.coverage + 1e-9 >= data.settings.minCoverage ? 'ok' : 'watch',
    },
    {
      label: { en: 'Newest close', zh: '最新收盤' },
      value: newest ?? '—',
      note: data.lastRun ? { en: `Job: ${RUN_STATUS[data.lastRun.status].en}, ${data.lastRun.finishedAt.slice(0, 16).replace('T', ' ')} UTC`, zh: `排程：${RUN_STATUS[data.lastRun.status].zh}，${data.lastRun.finishedAt.slice(0, 16).replace('T', ' ')} UTC` } : { en: 'The job has not run yet', zh: '排程尚未執行' },
      tone: data.lastRun ? (data.lastRun.status === 'ok' ? 'ok' : data.lastRun.status === 'partial' ? 'watch' : 'alert') : 'none',
    },
  ];
  return (
    <>
      <section className="card form">
        <h1>
          <Zh {...LABELS.volatility} />
        </h1>
        <p className="muted small">
          <Bi en={`Scored ${today} · the score's alert and proposals come in a later step; events are reminded of ${data.settings.events.leadDays} days ahead`} zh={`${today} 計分 · 分數的警報與提案將於後續步驟加入；事件於 ${data.settings.events.leadDays} 天前提醒`} />
        </p>
        <Facts facts={facts} />
        <VolatilityChart points={data.history ?? []} />
        <div className="table-wrap">
          <table className="compact" id="volatility-components">
            <thead>
              <tr>
                <th>
                  <Bi en="Component" zh="成分" />
                </th>
                <th className="num">
                  <Bi en="Figure" zh="數值" />
                </th>
                <th className="num">
                  <Bi en="Calm → panic" zh="平靜 → 恐慌" />
                </th>
                <th className="num">
                  <Bi en="Score 0–10" zh="分數 0–10" />
                </th>
                <th className="num">
                  <Bi en="Weight" zh="權重" />
                </th>
                <th>
                  <Bi en="Status" zh="狀態" />
                </th>
              </tr>
            </thead>
            <tbody>
              {result.components.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Bi {...COMPONENT_TEXT[row.id].name} /> <span className="muted small">{COMPONENT_TEXT[row.id].source}</span>
                  </td>
                  <td className="num">
                    {figureText(row.id, row.value)}
                    {row.date && <span className="muted small"> {row.date}</span>}
                  </td>
                  <td className="num">
                    {figureText(row.id, row.calm)} → {figureText(row.id, row.panic)}
                  </td>
                  <td className="num">{row.subScore === null ? '—' : row.subScore.toFixed(1)}</td>
                  <td className="num">{row.weight}</td>
                  <td>
                    <Bi {...STATUS_TEXT[row.weight === 0 ? 'missing' : row.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Info>
          <Bi
            en={`Each component scores 0 at or below its calm figure and 10 at or above its panic figure, in a straight line between. The score is 1 + 0.9 × the weighted mean of the scores counted, so all calm reads 1 and all at panic 10. A figure older than ${data.settings.maxAgeDays} days is left out and the others re-weighted; under ${Math.round(data.settings.minCoverage * 100)}% of the weight there is no score. VIX ÷ VIX3M above 1 means short-term fear is above the 3-month outlook, which happened on about 8% of days since 2010. The policy-uncertainty index counts newspaper articles on uncertainty, economy and policy: the news side, at no cost. Bands: 1–4 calm, 4–6 normal, 6–8 tense, 8–10 panic. Market data only; it is not advice.`}
            zh={`每個成分在平靜值以下得 0 分、恐慌值以上得 10 分，中間依直線換算。總分為 1 ＋ 0.9 ×（計入成分的加權平均分數），因此全部平靜為 1 分、全部恐慌為 10 分。超過 ${data.settings.maxAgeDays} 天的數值不計入，其餘重新加權；涵蓋權重低於 ${Math.round(data.settings.minCoverage * 100)}% 時不計分。VIX ÷ VIX3M 大於 1 表示短期恐慌高於 3 個月預期，2010 年以來約 8% 的交易日出現。政策不確定性指數統計報紙中「不確定、經濟、政策」同時出現的文章數，是免費的新聞面指標。區段：1–4 平靜、4–6 一般、6–8 緊張、8–10 恐慌。僅為市場數據，不構成投資建議。`}
          />
        </Info>
      </section>
      <Events events={data.events ?? null} leadDays={data.settings.events.leadDays} saved={typeof params['saved'] === 'string' ? params['saved'] : undefined} />
      <section className="card form" id="settings">
        <h2>
          <Bi en="Settings" zh="設定" />
        </h2>
        {params['saved'] === 'settings' && (
          <p className="banner ok" role="status">
            <Bi en="Saved; the change is in the edit history." zh="已儲存；修改已記錄在修改紀錄中。" />
          </p>
        )}
        <VolatilitySettingsForm settings={data.settings} />
      </section>
    </>
  );
}

const SOURCE_TEXT: Record<MarketEvent['source'], string> = { fed: 'Federal Reserve', fred: 'FRED', typed: 'typed 自行輸入' };

/** The coming events (step 2): from the feeds and typed in, a reminder pushed before each. */
function Events({ events, leadDays, saved }: { events: MarketEvent[] | null; leadDays: number; saved?: string }) {
  return (
    <section className="card form" id="events">
      <h2>
        <Bi en="Coming events" zh="近期事件" />
      </h2>
      {saved === 'event' && (
        <p className="banner ok" role="status">
          <Bi en="Event added." zh="已新增事件。" />
        </p>
      )}
      {saved === 'event-deleted' && (
        <p className="banner ok" role="status">
          <Bi en="Event deleted; it stays in the edit history." zh="已刪除事件；保留在修改紀錄中。" />
        </p>
      )}
      {events === null ? (
        <p className="muted">
          <Bi en="The event calendar is not set up yet: run npx supabase db push." zh="事件日曆尚未設定：請執行 npx supabase db push。" />
        </p>
      ) : events.length === 0 ? (
        <p className="muted">
          <Bi en={`No event in the next ${EVENT_PAGE_DAYS} days yet; the volatility job loads the Fed's and FRED's calendars.`} zh={`未來 ${EVENT_PAGE_DAYS} 天尚無事件；波動排程會載入聯準會與 FRED 的日程。`} />
        </p>
      ) : (
        <div className="table-wrap">
          <table className="compact" id="event-list">
            <thead>
              <tr>
                <th>
                  <Bi en="Taipei time" zh="台北時間" />
                </th>
                <th>
                  <Bi en="Event" zh="事件" />
                </th>
                <th>
                  <Bi en="Source" zh="來源" />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const when = whenText(event);
                return (
                  <tr key={event.id ?? `${event.kind}${event.date}${event.name.en}`}>
                    <td className="nowrap">
                      <Bi {...when} />
                    </td>
                    <td>
                      <Bi {...event.name} />
                      {event.kind === 'other' || event.name.en === KIND_NAMES[event.kind].en ? null : <span className="muted small"> {KIND_NAMES[event.kind].en}</span>}
                      {event.note && <span className="muted small"> · {event.note}</span>}
                    </td>
                    <td className="small">{SOURCE_TEXT[event.source]}</td>
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
              })}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary>
          <Bi en="Add an event" zh="新增事件" />
        </summary>
        <EventForm />
      </details>
      <Info>
        <Bi
          en={`FOMC rate decisions come from the Fed's calendar (the second day of each meeting, 14:00 New York), US CPI and the jobs report from FRED's release calendar; the volatility job reloads them twice a day. Taiwan's central bank publishes its board meetings once a year in a press release: type next year's in here, and elections or anything else too. A reminder is pushed ${leadDays} days before each event, once, after the quiet hours. Implied volatility usually rises before an event and falls after it, so a reminder proposes no orders.`}
          zh={`聯準會利率決議取自聯準會日程（每次會議第二天，紐約時間 14:00），美國 CPI 與非農就業取自 FRED 公布時程；波動排程每天重新載入兩次。央行每年以新聞稿公布理監事會議日期：請在這裡輸入明年的日期，選舉或其他事件也可輸入。每個事件前 ${leadDays} 天推播一次提醒（安靜時段後送出）。事件前隱含波動率通常上升、事件後回落，因此提醒不附下單清單。`}
        />
      </Info>
    </section>
  );
}
