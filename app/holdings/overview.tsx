import Link from 'next/link';
import type { ReactNode } from 'react';

import { Bi } from '@/components/bi';
import { Facts } from '@/components/facts';
import { Info } from '@/components/info';
import type { requireSession } from '@/lib/auth';
import { DataError, loadHoldingCloses, loadRedFlagData, loadSectorSettings, loadWorkbench, orDataError, type AllocationData, type Proposal, type RuleRecord } from '@/lib/data';
import { addDays } from '@/lib/dates';
import { percent, signedTwd, twd } from '@/lib/format';
import { DIRECTION, leverageText, POOL, type Bilingual } from '@/lib/i18n';
import { classDrifts } from '@/lib/models/allocation';
import { maxBuyClasses } from '@/lib/models/engine';
import { cellSignal, closesSince, costStrip, holdingSignals, lastMove, nextBuyClasses, SIGNAL_COLUMNS, treemap, type CostStrip, type Move, type Signal, type SignalColumn, type SignalKind } from '@/lib/models/holding-view';
import { zoneOf } from '@/lib/models/intrinsic';
import type { Portfolio } from '@/lib/models/portfolio';
import { positionKey } from '@/lib/models/positions';
import type { ClosePoint } from '@/lib/models/price-history';
import { capBreaches } from '@/lib/models/rules';
import { restateTrades } from '@/lib/models/splits';
import type { Holding } from '@/lib/models/valuation';
import { nextFiling, savedFor } from '@/lib/models/workbench';

type Supabase = Awaited<ReturnType<typeof requireSession>>['supabase'];

/** The ways to look at the holdings; the first is what the page opens on. */
export const VIEWS = ['cards', 'rank', 'cost', 'map', 'signals'] as const;
export type View = (typeof VIEWS)[number];

const VIEW: Record<View, Bilingual> = {
  cards: { en: 'Cards', zh: '卡片' },
  rank: { en: 'Ranking', zh: '排行' },
  cost: { en: 'Cost', zh: '買點' },
  map: { en: 'Map', zh: '板塊' },
  signals: { en: 'Signals', zh: '訊號' },
};

const COLUMN: Record<SignalColumn, Bilingual> = {
  rule: { en: 'Rule', zh: '規則' },
  value: { en: 'Value', zh: '估值' },
  flag: { en: 'Flags', zh: '紅旗' },
  mix: { en: 'Mix', zh: '配置' },
  event: { en: 'Event', zh: '事件' },
};

const ICON: Record<SignalKind, string> = { act: '✕', watch: '!', buy: '＋', wait: '…', ok: '✓', info: '' };
const KIND: Array<{ kind: SignalKind; label: Bilingual }> = [
  { kind: 'act', label: { en: 'Act', zh: '需處理' } },
  { kind: 'watch', label: { en: 'Watch', zh: '留意' } },
  { kind: 'buy', label: { en: 'Buy', zh: '可買進' } },
  { kind: 'ok', label: { en: 'Fine', zh: '正常' } },
  { kind: 'wait', label: { en: 'Due', zh: '事件將至' } },
];

/** How far back the closes are read (the 52-week range), and how much of it a card draws. */
const RANGE_DAYS = 366;
const CARD_DAYS = 92;
/** A filing this many days ahead or nearer is named on the holding. */
const FILING_DAYS = 7;

interface Row {
  holding: Holding;
  ticker: string;
  closes: ClosePoint[];
  move: Move | null;
  /** Value against cost, as a fraction; null when either is unknown. */
  total: number | null;
  /** Share of the regular pool; null for a windfall line. */
  weight: number | null;
  avgCost: number | null;
  last: number | null;
  /** Buys of the line, dated and priced in today's units. */
  buys: Array<{ date: string; price: number }>;
  strip: CostStrip | null;
  signals: Signal[];
}

function moveText(value: number | null, digits = 1): string {
  if (value === null) return '—';
  if (Math.abs(value) < 0.5 / 10 ** (digits + 2)) return percent(0, digits);
  return `${value > 0 ? '▲' : '▼'}${percent(Math.abs(value), digits)}`;
}

function tone(value: number | null): string {
  return value === null || Math.abs(value) < 0.0005 ? 'flat' : value > 0 ? 'up' : 'down';
}

/**
 * The holdings at a glance (PRD Section 5, "Phone redesign", step 3): the last session's move in
 * TWD, then one of five views of the listed holdings, picked by `view` in the address. Every signal
 * comes from a rule the app already runs; a part that cannot be read leaves its signals out.
 */
export async function HoldingsOverview({ supabase, data, portfolio, today, view, proposals, rules }: { supabase: Supabase; data: AllocationData; portfolio: Portfolio; today: string; view: View; proposals: readonly Proposal[]; rules: readonly RuleRecord[] }) {
  const listed = portfolio.holdings.filter((holding): holding is Holding & { ticker: string } => holding.ticker !== null);
  if (listed.length === 0) return null;
  const [closes, workbench, flags, sectors] = await Promise.all([
    orDataError(loadHoldingCloses(supabase, listed.map((holding) => holding.ticker), addDays(today, -RANGE_DAYS))),
    orDataError(loadWorkbench(supabase, today)),
    orDataError(loadRedFlagData(supabase, today)),
    orDataError(loadSectorSettings(supabase)),
  ]);
  const closesOf = closes instanceof DataError ? new Map<string, ClosePoint[]>() : closes;
  const colour = sectors instanceof DataError || !sectors ? 'red_up' : sectors.colour;

  const total = portfolio.pool.totalTwd;
  const positions = new Map(portfolio.positions.map((position) => [positionKey(position.pool, position.ticker, position.direction), position]));
  const trades = restateTrades(data.trades, data.splits);
  const breaches = new Map(capBreaches(portfolio.holdings, data.caps).filter((breach) => breach.rule === 'R1').map((breach) => [breach.subject, breach]));
  const lights = new Map(flags instanceof DataError ? [] : flags.companies.map((company) => [company.security.ticker, company.assessment.light]));
  const benches = new Map(workbench instanceof DataError ? [] : workbench.stocks.map((bench) => [bench.security.ticker, bench]));
  const drifts = classDrifts(portfolio.classes, data.bands, total);
  const driftOf = new Map(drifts.map((row) => [row.assetClass.id, row]));
  const nextBuy = new Set(nextBuyClasses(drifts, Math.min(maxBuyClasses(rules), drifts.length)));
  const waiting = new Set(proposals.filter((proposal) => proposal.status === 'open').flatMap((proposal) => proposal.orders.flatMap((order) => ('ticker' in order && typeof order.ticker === 'string' ? [order.ticker] : []))));
  const securities = new Map(data.securities.map((security) => [security.ticker, security]));

  const rows: Row[] = listed.map((holding) => {
    const series = closesOf.get(holding.ticker) ?? [];
    const position = positions.get(holding.key);
    const long = holding.direction === 'long';
    const avgCost = long && position && position.qty > 0 ? position.costLocal / position.qty : null;
    const last = series[series.length - 1]?.close ?? data.prices.find((price) => price.ticker === holding.ticker)?.close ?? null;
    const buys = long ? trades.filter((trade) => trade.ticker === holding.ticker && trade.pool === holding.pool && trade.side === 'buy' && (trade.direction ?? 'long') === 'long').map((trade) => ({ date: trade.tradeDate, price: trade.price })) : [];
    const bench = benches.get(holding.ticker);
    const saved = bench ? savedFor(bench.saved, holding.ticker, bench.assumed.model)[0] : undefined;
    const buy = bench?.watch?.buy ?? (workbench instanceof DataError ? null : workbench.rules.buy);
    const trim = bench?.watch?.trim ?? (workbench instanceof DataError ? null : workbench.rules.trim);
    const zone = saved && last !== null && buy !== null && trim !== null ? zoneOf(last, saved.base, { buy, trim }) : undefined;
    const filing = bench ? nextFiling(bench.security.market, bench.series.quarters) : undefined;
    const drift = holding.pool === 'regular' && long ? driftOf.get(holding.assetClassId) : undefined;
    const breach = holding.pool === 'regular' ? breaches.get(holding.ticker) : undefined;
    return {
      holding,
      ticker: holding.ticker,
      closes: series,
      move: lastMove(series),
      total: holding.valueTwd !== null && holding.costTwd ? holding.valueTwd / holding.costTwd - 1 : null,
      weight: holding.pool === 'regular' && holding.exposureTwd !== null && total > 0 ? holding.exposureTwd / total : null,
      avgCost,
      last,
      buys,
      strip: costStrip({ avgCost, last, closes: series, lots: buys.map((lot) => lot.price), buyPrice: zone?.buyPrice ?? null, trimPrice: zone?.trimPrice ?? null }),
      signals: holdingSignals({
        ticker: holding.ticker,
        ...(breach ? { breach: { weight: breach.weight, limit: breach.limit } } : {}),
        ...(holding.productType === 'stock' && lights.has(holding.ticker) ? { light: lights.get(holding.ticker) ?? null } : {}),
        ...(zone ? { zone } : {}),
        ...(drift && drift.status !== 'unchecked' ? { drift: { status: drift.status, drift: drift.drift, nextBuy: nextBuy.has(holding.assetClassId) } } : {}),
        ...(filing && filing.date >= today && filing.date <= addDays(today, FILING_DAYS) ? { filing: { date: filing.date } } : {}),
        ...(waiting.has(holding.ticker) ? { proposal: true } : {}),
      }),
    };
  });

  // The last session in TWD: each line's value now against its value a session ago, the currencies held still.
  const moved = rows.filter((row) => row.move && row.holding.valueTwd !== null);
  const dayTwd = moved.reduce((sum, row) => sum + (row.holding.valueTwd ?? 0) * (1 - 1 / (1 + (row.move?.change ?? 0))), 0);
  const base = moved.reduce((sum, row) => sum + (row.holding.valueTwd ?? 0), 0) - dayTwd;
  const newest = moved.map((row) => row.move?.date ?? '').sort().pop();
  const nameOf = (ticker: string) => securities.get(ticker)?.name ?? ticker;

  return (
    <section className={`card form glance ${colour === 'green_up' ? 'green-up' : 'red-up'}`} id="glance">
      <div className="row spread">
        <h2>
          <Bi en="At a glance" zh="持股一覽" />
        </h2>
        <div className="segmented" role="group" aria-label="View 檢視">
          {VIEWS.map((option) => (
            <Link prefetch key={option} href={option === 'cards' ? '/holdings#glance' : `/holdings?view=${option}#glance`} aria-current={option === view ? 'true' : undefined} scroll={false}>
              <Bi {...VIEW[option]} />
            </Link>
          ))}
        </div>
      </div>
      {moved.length > 0 && (
        <Facts
          facts={[
            {
              label: { en: 'Last session', zh: '最近交易日' },
              value: <span className={tone(base > 0 ? dayTwd / base : null)}>{signedTwd(dayTwd)}</span>,
              note: { en: `${moveText(base > 0 ? dayTwd / base : null)} · ${newest ?? ''}`, zh: `${moveText(base > 0 ? dayTwd / base : null)} · ${newest ?? ''} 收盤` },
            },
          ]}
        />
      )}
      {view === 'cards' && <Cards rows={rows} nameOf={nameOf} today={today} marginCallShare={data.leverage.marginCallShare} />}
      {view === 'rank' && <Rank rows={rows} />}
      {view === 'cost' && <Cost rows={rows} />}
      {view === 'map' && <TreeMap rows={rows} portfolio={portfolio} />}
      {view === 'signals' && <Matrix rows={rows} />}
      <Info>
        <Bi
          en="The last session is the newest close against the one before it, loaded every night: not a live quote, and the currencies are held still. Total is market value against cost in TWD. ▲ marks a buy at its recorded price, the dashed line the average cost. Signals come from the app's own rules: R1's cap, the red-flag light (N3), the class's drift (F8; the next contribution buys the two most underweight core classes), the buy and trim zones (F12), a filing due within seven days, a proposal waiting."
          zh="最近交易日＝最新收盤對前一個收盤，每夜載入，不是即時報價，且不計匯率變動。累計＝台幣市值對成本。▲ 為買進（登錄的成交價），虛線為平均成本。訊號全部來自 App 既有的規則：R1 個股上限、紅旗燈號（N3）、所屬類別的偏離（F8；下次扣款優先補最低配的兩個核心類別）、買入區與減碼區（F12）、七天內的財報日、規則警示。"
        />
      </Info>
    </section>
  );
}

function Chip({ signal }: { signal: Signal }) {
  const body = (
    <>
      {ICON[signal.kind] && (
        <i className={`sig-dot ${signal.kind}`} aria-hidden="true">
          {ICON[signal.kind]}
        </i>
      )}
      <span lang="zh-Hant" title={signal.label.en}>
        {signal.label.zh}
      </span>
    </>
  );
  return signal.href ? (
    <Link href={signal.href} className={`sig ${signal.kind}`} prefetch={false}>
      {body}
    </Link>
  ) : (
    <span className={`sig ${signal.kind}`}>{body}</span>
  );
}

/** Three months of closes as a line, each buy a triangle under its day, the average cost a dashed line. */
function Spark({ row, from }: { row: Row; from: string }) {
  const points = closesSince(row.closes, from);
  if (points.length < 2) return <div className="spark-empty" />;
  const [W, H] = [168, 46];
  const values = points.map((point) => point.close);
  const cost = row.avgCost;
  const low = Math.min(...values, ...(cost === null ? [] : [cost]));
  const high = Math.max(...values, ...(cost === null ? [] : [cost]));
  const span = high - low || 1;
  const x = (index: number) => 3 + (index * (W - 6)) / (points.length - 1);
  const y = (value: number) => H - 7 - ((value - low) * (H - 14)) / span;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(point.close).toFixed(1)}`).join(' ');
  const marks = row.buys.flatMap((buy) => {
    const index = points.findIndex((point) => point.date >= buy.date);
    return index === -1 || buy.date < (points[0]?.date ?? '') ? [] : [index];
  });
  const end = points.length - 1;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${row.ticker} 近三個月收盤、買點與平均成本`}>
      <path d={`${path} L${x(end).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`} fill="var(--chart-1)" opacity="0.08" />
      {cost !== null && <line x1="3" x2={W - 3} y1={y(cost).toFixed(1)} y2={y(cost).toFixed(1)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />}
      <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {marks.map((index, key) => (
        <path key={key} d={`M${x(index).toFixed(1)} ${(y(points[index]?.close ?? low) + 3).toFixed(1)} l-4.2 7 h8.4 z`} fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.2" />
      ))}
      <circle cx={x(end).toFixed(1)} cy={y(points[end]?.close ?? low).toFixed(1)} r="3.2" fill="var(--chart-1)" stroke="var(--surface)" strokeWidth="1.5" />
    </svg>
  );
}

function Moves({ row }: { row: Row }) {
  return (
    <div className="moves">
      <span className={tone(row.move?.change ?? null)}>
        <b>{moveText(row.move?.change ?? null)}</b>
        <small>
          <Bi en="Day" zh="今日" label />
        </small>
      </span>
      <span className={tone(row.total)}>
        <b>{moveText(row.total)}</b>
        <small>
          <Bi en="Total" zh="累計" label />
        </small>
      </span>
    </div>
  );
}

function Badges({ holding, marginCallShare }: { holding: Holding; marginCallShare: number | null }) {
  const plain = holding.direction === 'long' && Math.abs(holding.leverage - 1) < 1e-9;
  const left = holding.valueTwd !== null && holding.costTwd ? holding.valueTwd / holding.costTwd : null;
  return (
    <>
      {holding.pool === 'windfall' && (
        <span className="sig info">
          <Bi {...POOL.windfall} />
        </span>
      )}
      {!plain && (
        <span className="sig info">
          <Bi {...DIRECTION[holding.direction]} /> {leverageText(holding.leverage)}
        </span>
      )}
      {!plain && left !== null && marginCallShare !== null && left <= marginCallShare && (
        <span className="sig act">
          <i className="sig-dot act" aria-hidden="true">
            ✕
          </i>
          <Bi en={`Own money down to ${percent(left)}`} zh={`自有資金剩 ${percent(left)}`} />
        </span>
      )}
    </>
  );
}

function Cards({ rows, nameOf, today, marginCallShare }: { rows: readonly Row[]; nameOf: (ticker: string) => string; today: string; marginCallShare: number | null }) {
  const from = addDays(today, -CARD_DAYS);
  const ordered = [...rows].sort((a, b) => (b.holding.valueTwd ?? 0) - (a.holding.valueTwd ?? 0));
  return (
    <ul className="hold-cards">
      {ordered.map((row) => (
        <li key={row.holding.key} className="hold-card">
          <div className="hold-top">
            <Link href={`/holdings/chart/${encodeURIComponent(row.ticker)}`} className="hold-name">
              <b>{row.ticker}</b>
              <span>{nameOf(row.ticker)}</span>
            </Link>
            <span className="hold-value">
              <b>{twd(row.holding.valueTwd)}</b>
              {row.weight !== null && <small>{percent(row.weight)}</small>}
            </span>
          </div>
          <div className="hold-mid">
            <Spark row={row} from={from} />
            <Moves row={row} />
          </div>
          <div className="sigs">
            <Badges holding={row.holding} marginCallShare={marginCallShare} />
            {row.signals.map((signal) => (
              <Chip key={`${signal.column}${signal.label.en}`} signal={signal} />
            ))}
            {row.closes.length === 0 && (
              <span className="sig wait">
                <i className="sig-dot wait" aria-hidden="true">
                  …
                </i>
                <Bi en="waiting for tonight's prices" zh="等待今晚排程" />
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A bar on a track whose zero line sits at `zero` % from the left; `unit` is the gain one % of the track stands for, the same on both sides. */
function ZeroBar({ value, unit, zero }: { value: number | null; unit: number; zero: number }) {
  const style = { '--zero': `${zero}%` } as React.CSSProperties;
  if (value === null || unit <= 0) return <div className="zero-bar" style={style} />;
  const width = Math.abs(value) / unit;
  return (
    <div className="zero-bar" style={style}>
      <i className={value >= 0 ? 'pos' : 'neg'} style={{ left: `${(value >= 0 ? zero : zero - width).toFixed(1)}%`, width: `${width.toFixed(1)}%` }} />
    </div>
  );
}

function Rank({ rows }: { rows: readonly Row[] }) {
  const ordered = [...rows].sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity));
  const gains = ordered.map((row) => row.total ?? 0);
  const [best, worst] = [Math.max(0, ...gains), Math.max(0, ...gains.map((gain) => -gain))];
  // The zero line leaves the losses the room their size needs; one scale serves both sides.
  const zero = worst > 0 ? Math.min(50, Math.max(10, (worst / (best + worst)) * 100)) : 0;
  const unit = Math.max(best / (100 - zero), zero > 0 ? worst / zero : 0) || 1;
  return (
    <div className="rank" role="table" aria-label="Gain ranking 損益排行">
      <div className="rank-row rank-head" role="row">
        <span role="columnheader" />
        <span role="columnheader" />
        <span role="columnheader">
          <Bi en="Total" zh="累計" label />
        </span>
        <span role="columnheader">
          <Bi en="Day" zh="今日" label />
        </span>
      </div>
      {ordered.map((row) => (
        <div key={row.holding.key} className="rank-row" role="row">
          <Link href={`/holdings/chart/${encodeURIComponent(row.ticker)}`} className="tk" role="cell">
            {row.ticker}
          </Link>
          <span role="cell">
            <ZeroBar value={row.total} unit={unit} zero={zero} />
          </span>
          <b className={tone(row.total)} role="cell">
            {moveText(row.total)}
          </b>
          <span className={tone(row.move?.change ?? null)} role="cell">
            {moveText(row.move?.change ?? null)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Cost({ rows }: { rows: readonly Row[] }) {
  const strips = rows.filter((row): row is Row & { strip: CostStrip } => row.strip !== null);
  if (strips.length === 0) {
    return (
      <p className="muted">
        <Bi en="No priced long holding yet." zh="尚無已計價的做多持股。" />
      </p>
    );
  }
  // One scale for every row: the widest reach of a range, a buy or the price, to the next 5%.
  const reach = Math.max(0.1, ...strips.flatMap((row) => [Math.abs(row.strip.low), Math.abs(row.strip.high), ...row.strip.lots.map(Math.abs)]));
  const edge = Math.ceil(reach * 20) / 20;
  const [W, MID] = [236, 118];
  const x = (value: number) => MID + (Math.max(-edge, Math.min(edge, value)) / edge) * (MID - 8);
  return (
    <div className="cost">
      <ul className="chart-legend">
        <li>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M6 2 l-4.6 8 h9.2 z" fill="var(--accent)" />
          </svg>
          <Bi en="Buy" zh="買進" />
        </li>
        <li>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" fill="var(--up)" />
          </svg>
          <Bi en="Price" zh="現價" />
        </li>
        <li>
          <svg viewBox="0 0 18 12" aria-hidden="true">
            <rect y="3" width="18" height="6" rx="3" fill="var(--border)" />
          </svg>
          <Bi en="52-week range" zh="52 週高低" />
        </li>
        <li>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <line x1="6" x2="6" y1="0" y2="12" stroke="var(--muted)" strokeDasharray="3 3" />
          </svg>
          <Bi en="Average cost" zh="平均成本" />
        </li>
      </ul>
      {strips.map((row) => (
        <div key={row.holding.key} className="cost-row">
          <Link href={`/holdings/chart/${encodeURIComponent(row.ticker)}`} className="tk">
            {row.ticker}
          </Link>
          <svg viewBox={`0 0 ${W} 46`} role="img" aria-label={`${row.ticker} 現價相對平均成本 ${moveText(row.strip.now)}`}>
            {row.strip.buyZone !== null && row.strip.buyZone > -edge && (
              <>
                <rect x="0" y="5" width={x(row.strip.buyZone).toFixed(1)} height="26" rx="4" fill="var(--ok-bg)" />
                <text x="4" y="42" className="cost-zone">
                  買入區
                </text>
              </>
            )}
            {row.strip.trimZone !== null && row.strip.trimZone < edge && (
              <>
                <rect x={x(row.strip.trimZone).toFixed(1)} y="5" width={(W - x(row.strip.trimZone)).toFixed(1)} height="26" rx="4" fill="var(--warn-bg)" />
                <text x={W - 4} y="42" textAnchor="end" className="cost-zone">
                  減碼區
                </text>
              </>
            )}
            <rect x={x(row.strip.low).toFixed(1)} y="14" width={Math.max(2, x(row.strip.high) - x(row.strip.low)).toFixed(1)} height="8" rx="4" fill="var(--border)" />
            <line x1={MID} x2={MID} y1="3" y2="33" stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
            {row.strip.lots.map((lot, index) => (
              <path key={index} d={`M${x(lot).toFixed(1)} 12 l-4.6 8 h9.2 z`} fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.2" />
            ))}
            <circle cx={x(row.strip.now).toFixed(1)} cy="18" r="5.5" fill={row.strip.now >= 0 ? 'var(--up)' : 'var(--down)'} stroke="var(--surface)" strokeWidth="2" />
          </svg>
          <b className={tone(row.strip.now)}>{moveText(row.strip.now)}</b>
        </div>
      ))}
      <div className="cost-scale" aria-hidden="true">
        <span>{`−${percent(edge, 0)}`}</span>
        <span lang="zh-Hant">成本</span>
        <span>{`+${percent(edge, 0)}`}</span>
      </div>
    </div>
  );
}

function TreeMap({ rows, portfolio }: { rows: readonly Row[]; portfolio: Portfolio }) {
  const [W, H, GAP] = [300, 214, 2];
  const byKey = new Map(rows.map((row) => [row.holding.key, row]));
  const valued = portfolio.holdings.filter((holding) => (holding.valueTwd ?? 0) > 0);
  const total = valued.reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const tiles = treemap(valued.map((holding) => ({ item: holding, value: holding.valueTwd ?? 0 })), W, H);
  const strongest = Math.max(0.005, ...rows.map((row) => Math.abs(row.move?.change ?? 0)));
  return (
    <figure className="chart-figure">
      <svg className="hold-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="持倉板塊圖：面積為市值，顏色為最近交易日漲跌">
        {tiles.map(({ item, x, y, width, height }) => {
          const row = byKey.get(item.key);
          const change = row?.move?.change ?? null;
          const flat = change === null || Math.abs(change) < 0.0005;
          const acts = row?.signals.some((signal) => signal.kind === 'act') ?? false;
          const [w, h] = [Math.max(0, width - GAP), Math.max(0, height - GAP)];
          const share = total > 0 ? (item.valueTwd ?? 0) / total : 0;
          return (
            <g key={item.key}>
              <rect x={x.toFixed(1)} y={y.toFixed(1)} width={w.toFixed(1)} height={h.toFixed(1)} rx="5" fill="var(--surface)" />
              <rect x={x.toFixed(1)} y={y.toFixed(1)} width={w.toFixed(1)} height={h.toFixed(1)} rx="5" fill={flat ? 'var(--chart-context)' : change > 0 ? 'var(--up)' : 'var(--down)'} opacity={flat ? 0.28 : (0.3 + 0.55 * Math.min(1, Math.abs(change) / strongest)).toFixed(2)} />
              {w > 44 && h > 22 && (
                <text x={(x + 7).toFixed(1)} y={(y + 17).toFixed(1)} className="map-name">
                  {(item.ticker ?? item.label).slice(0, Math.max(3, Math.floor(w / 9)))}
                </text>
              )}
              {w > 58 && h > 38 && (
                <text x={(x + 7).toFixed(1)} y={(y + 32).toFixed(1)} className="map-num">
                  {`${percent(share, 0)}${flat || change === null ? '' : ` · ${moveText(change)}`}`}
                </text>
              )}
              {acts && w > 30 && h > 24 && (
                <>
                  <circle cx={(x + w - 11).toFixed(1)} cy={(y + 12).toFixed(1)} r="7" fill="var(--surface)" />
                  <text x={(x + w - 11).toFixed(1)} y={(y + 15.5).toFixed(1)} textAnchor="middle" className="map-flag">
                    ✕
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <ul className="chart-legend">
        <li>
          <span className="chart-key rect" style={{ background: 'var(--up)' }} aria-hidden="true" />
          <Bi en="Up" zh="上漲" />
        </li>
        <li>
          <span className="chart-key rect" style={{ background: 'var(--down)' }} aria-hidden="true" />
          <Bi en="Down" zh="下跌" />
        </li>
        <li>
          <Bi en="Area = value" zh="面積＝市值" />
        </li>
        <li>
          <Bi en="✕ act" zh="✕ 需處理" />
        </li>
      </ul>
    </figure>
  );
}

function Cell({ signal }: { signal: Signal | undefined }): ReactNode {
  if (!signal) return <span className="sig-none">—</span>;
  const dot = (
    <i className={`sig-dot big ${signal.kind}`} title={`${signal.label.en} ${signal.label.zh}`}>
      {ICON[signal.kind] || '＝'}
    </i>
  );
  return signal.href ? (
    <Link href={signal.href} aria-label={`${signal.label.zh} ${signal.label.en}`} prefetch={false}>
      {dot}
    </Link>
  ) : (
    dot
  );
}

function Matrix({ rows }: { rows: readonly Row[] }) {
  // The holdings with something to act on first.
  const weight = (row: Row) => (row.signals.some((signal) => signal.kind === 'act') ? 0 : row.signals.some((signal) => signal.kind === 'watch') ? 1 : 2);
  const ordered = [...rows].sort((a, b) => weight(a) - weight(b) || (b.holding.valueTwd ?? 0) - (a.holding.valueTwd ?? 0));
  return (
    <>
      <table className="sig-matrix">
        <thead>
          <tr>
            <th />
            {SIGNAL_COLUMNS.map((column) => (
              <th key={column}>
                <Bi {...COLUMN[column]} label />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr key={row.holding.key}>
              <th>
                <Link href={`/holdings/chart/${encodeURIComponent(row.ticker)}`}>{row.ticker}</Link>
              </th>
              {SIGNAL_COLUMNS.map((column) => (
                <td key={column}>
                  <Cell signal={cellSignal(row.signals, column)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="chart-legend">
        {KIND.map(({ kind, label }) => (
          <li key={kind}>
            <i className={`sig-dot ${kind}`} aria-hidden="true">
              {ICON[kind]}
            </i>
            <Bi {...label} />
          </li>
        ))}
      </ul>
    </>
  );
}
