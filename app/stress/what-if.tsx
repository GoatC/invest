import { Bi } from '@/components/bi';
import type { StressData } from '@/lib/data';
import { percent, twd } from '@/lib/format';
import { DIRECTION, leverageText, type Bilingual } from '@/lib/i18n';
import { classReturns, combinedDrawdown, positionPath, type Replay, type Scenario, type StressSettings, type WhatIf } from '@/lib/models/stress';
import { queryAmount, queryDirection, queryLeverage, queryText, tenths } from '@/lib/what-if';

type Params = Record<string, string | string[] | undefined>;

/** Leverage the what-if offers: 1.0× to 10.0× in 0.1× steps. */
const STEPS = tenths(1, 10);

/** The what-if position from the query (wc, wd, wl, wm); undefined until a class is picked. */
export function whatIfFrom(params: Params, data: StressData, total: number): WhatIf | undefined {
  const classId = queryText(params, 'wc');
  if (!classId || !data.classNames.some((entry) => entry.id === classId)) return undefined;
  return {
    classId,
    direction: queryDirection(params, 'wd'),
    leverage: queryLeverage(params, 'wl', 1, 10, 1),
    marginTwd: queryAmount(params, 'wm', Math.max(1000, Math.round(total * 0.05))),
  };
}

interface Row {
  key: string;
  name: Bilingual;
  base: Replay;
  start: string;
  returns: (index: number) => number | undefined;
}

/**
 * F10 with a made-up position added: a long or short of one asset class, leveraged, with its own
 * money. Each scenario shows what the position alone would do (lowest own money, margin call,
 * wiped out) and the portfolio's deepest fall without and with it.
 */
export function WhatIfSection({
  data,
  settings,
  replays,
  custom,
  customShocks,
  whatIf,
  total,
  scenario,
}: {
  data: StressData;
  settings: StressSettings;
  replays: Array<{ scenario: Scenario; replay: Replay }>;
  custom: Replay;
  customShocks: Record<string, number>;
  whatIf: WhatIf | undefined;
  total: number;
  scenario: string;
}) {
  const callShare = data.leverage.marginCallShare;
  const rows: Row[] = whatIf
    ? [
        ...replays.map(({ scenario: entry, replay }) => {
          const series = classReturns(entry, settings.map, whatIf.classId);
          return { key: entry.id, name: { en: entry.nameEn, zh: entry.nameZh }, base: replay, start: entry.from, returns: (index: number) => series?.[index] };
        }),
        {
          key: 'custom',
          name: { en: 'Your own shock', zh: '自訂衝擊' },
          base: custom,
          start: custom.months[1]?.month ?? custom.months[0]?.month ?? '',
          returns: (index: number) => (index === 0 ? (customShocks[whatIf.classId] ?? 0) : (data.expected[whatIf.classId] ?? 0) / 12),
        },
      ]
    : [];
  const unmapped = whatIf !== undefined && settings.map[whatIf.classId] === undefined;
  return (
    <section className="card form" id="what-if">
      <h2>
        <Bi en="What if: a long or short position with leverage" zh="假設情境：加入做多／做空與槓桿部位" />
      </h2>
      <p className="muted small">
        <Bi
          en="Add a position you do not hold, follow one asset class's series, and see what each scenario would have done to it and to the whole portfolio. A short gains when the class falls; leverage multiplies both ways, and the broker closes the position once its own money is gone. Analysis only: nothing is saved."
          zh="加入一個你沒有持有的部位，跟著某個資產類別的走勢，看看每個情境會對它和整個投資組合造成什麼影響。做空在類別下跌時獲利；槓桿會放大漲跌兩個方向，自有資金虧光時券商就會平倉。僅供分析，不會儲存。"
        />
      </p>
      <form method="get" action="/stress#what-if" className="form-grid">
        <input type="hidden" name="s" value={scenario} />
        <label className="field">
          <Bi en="Follows asset class" zh="跟隨資產類別" />
          <select name="wc" defaultValue={whatIf?.classId ?? data.classNames[0]?.id}>
            {data.classNames.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {`${entry.nameEn} ${entry.nameZh}`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <Bi en="Direction" zh="多空方向" />
          <select name="wd" defaultValue={whatIf?.direction ?? 'long'}>
            <option value="long">{`${DIRECTION.long.en} ${DIRECTION.long.zh}`}</option>
            <option value="short">{`${DIRECTION.short.en} ${DIRECTION.short.zh}`}</option>
          </select>
        </label>
        <label className="field">
          <Bi en="Leverage (0.1× steps)" zh="槓桿（0.1 倍級距）" />
          <select name="wl" defaultValue={(whatIf?.leverage ?? 1).toFixed(1)}>
            {STEPS.map((step) => (
              <option key={step} value={step.toFixed(1)}>
                {leverageText(step)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <Bi en="Own money (TWD)" zh="自有資金（台幣）" />
          <input name="wm" inputMode="decimal" defaultValue={String(whatIf?.marginTwd ?? Math.max(1000, Math.round(total * 0.05)))} />
        </label>
        <div className="row">
          <button type="submit" className="button primary">
            <Bi en="Replay with it" zh="加入後重新計算" />
          </button>
        </div>
      </form>
      {unmapped && (
        <p className="banner warn">
          <Bi en="That class has no scenario series, so the position stays flat." zh="這個類別沒有對應的情境資料，部位會維持不變。" />
        </p>
      )}
      {whatIf && (
        <>
          <p className="small">
            <Bi
              en={`${DIRECTION[whatIf.direction].en}, ${leverageText(whatIf.leverage)}: ${twd(whatIf.marginTwd)} of own money moves ${twd(whatIf.marginTwd * whatIf.leverage)}. A ${percent(1 / whatIf.leverage, 1)} ${whatIf.direction === 'long' ? 'fall' : 'rise'} uses it up.`}
              zh={`${DIRECTION[whatIf.direction].zh}，${leverageText(whatIf.leverage)}：${twd(whatIf.marginTwd)} 的自有資金帶動 ${twd(whatIf.marginTwd * whatIf.leverage)} 的部位，${whatIf.direction === 'long' ? '下跌' : '上漲'} ${percent(1 / whatIf.leverage, 1)} 就會虧光。`}
            />
          </p>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>
                    <Bi en="Scenario" zh="情境" />
                  </th>
                  <th className="num">
                    <Bi en="Lowest own money" zh="自有資金最低" />
                  </th>
                  <th>
                    <Bi en="Margin call" zh="追繳保證金" />
                  </th>
                  <th>
                    <Bi en="Wiped out" zh="虧光平倉" />
                  </th>
                  <th className="num">
                    <Bi en="Deepest fall, without → with" zh="最深跌幅，加入前 → 後" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const path = positionPath(whatIf, row.start, row.base.months.length - 1, row.returns, callShare);
                  const withIt = combinedDrawdown(row.base, path);
                  return (
                    <tr key={row.key}>
                      <td>
                        <Bi {...row.name} />
                      </td>
                      <td className="num">{percent(path.worstShare, 0)}</td>
                      <td className="nowrap">{path.callMonth ?? '—'}</td>
                      <td className="nowrap">{path.wipedMonth ?? '—'}</td>
                      <td className="num">
                        {`${percent(row.base.maxDrawdown, 1)} → ${percent(withIt.maxDrawdown, 1)}`}
                        <div className="muted small">{twd(withIt.maxDrawdownTwd)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            <Bi
              en={`Monthly steps: a crash within a month can wipe out a leveraged position before a month-end shows it. Borrowing cost, short-borrow fees and dividends a short pays are left out.${callShare === null ? '' : ` Margin call: own money at ${percent(callShare, 0)} of what was put in (config leverage).`}`}
              zh={`以月為單位計算：月中的崩跌可能在月底數字出現前就讓槓桿部位虧光。未計入融資利息、借券費與做空須支付的股利。${callShare === null ? '' : `追繳保證金：自有資金剩下投入的 ${percent(callShare, 0)}（config leverage）。`}`}
            />
          </p>
        </>
      )}
    </section>
  );
}
