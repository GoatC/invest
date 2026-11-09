'use client';

/**
 * A holding's price history (N5): the closes over the range picked (a week to everything) at the
 * step picked (day, week, month, year), with each buy as an upward triangle and each sell as a
 * downward one at its trade date and price, and the average cost as a dashed line. The range and
 * step are two rows of buttons; the figures over the chart follow them.
 */
import type { LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import { useEffect, useMemo, useRef, useState } from 'react';

import { quantity, signedPercent } from '@/lib/format';
import type { Bilingual } from '@/lib/i18n';
import { change, DEFAULT_STEP, rangeStart, RANGES, STEPS, tradeMarks, window, type ClosePoint, type Range, type Step } from '@/lib/models/price-history';
import type { Direction, Side } from '@/lib/models/types';

import { Bi } from './bi';
import { dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

const RANGE_LABEL: Record<Range, Bilingual> = {
  '1W': { en: '1 week', zh: '1週' },
  '1M': { en: '1 month', zh: '1月' },
  '3M': { en: '3 months', zh: '3月' },
  '1Y': { en: '1 year', zh: '1年' },
  '5Y': { en: '5 years', zh: '5年' },
  ALL: { en: 'All', zh: '全部' },
};

const STEP_LABEL: Record<Step, Bilingual> = {
  day: { en: 'Day', zh: '日' },
  week: { en: 'Week', zh: '週' },
  month: { en: 'Month', zh: '月' },
  year: { en: 'Year', zh: '年' },
};

const SIDE_LABEL: Record<Side, Bilingual> = { buy: { en: 'Buy', zh: '買進' }, sell: { en: 'Sell', zh: '賣出' } };

export interface ChartTrade {
  ticker: string;
  tradeDate: string;
  side: Side;
  direction?: Direction;
  qty: number;
  price: number;
}

function price(value: number, currency: string): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function option(points: readonly ClosePoint[], marks: ReturnType<typeof tradeMarks>, currency: string, avgCost: number | null, colors: Colors, width: number): Option {
  const line: LineSeriesOption = {
    type: 'line',
    data: points.map((point) => [point.date, point.close]),
    showSymbol: points.length <= 40,
    symbol: 'circle',
    symbolSize: 5,
    lineStyle: { width: 2, color: colors.slots[0], cap: 'round', join: 'round' },
    itemStyle: { color: colors.slots[0] },
    areaStyle: { color: colors.slots[0], opacity: 0.06 },
    ...(avgCost === null
      ? {}
      : {
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: colors.muted, type: 'dashed', width: 1 },
            data: [{ yAxis: avgCost }],
          },
        }),
  };
  const side = (which: Side): ScatterSeriesOption => ({
    type: 'scatter',
    data: marks.filter((mark) => mark.side === which).map((mark) => [mark.date, mark.price]),
    symbol: 'triangle',
    symbolRotate: which === 'buy' ? 0 : 180,
    symbolSize: width < 520 ? 11 : 13,
    z: 3,
    itemStyle: { color: which === 'buy' ? colors.status.good : colors.status.critical, borderColor: colors.surface, borderWidth: 1.5, opacity: 1 },
  });
  const buys = marks.filter((mark) => mark.side === 'buy');
  const sells = marks.filter((mark) => mark.side === 'sell');
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 8, right: 12, top: 12, bottom: 28, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const series = (params as { seriesIndex?: number }).seriesIndex ?? 0;
        const index = dataIndex(params) ?? -1;
        if (series === 0) {
          const point = points[index];
          return point ? tooltip(point.date, [{ value: price(point.close, currency), label: { en: 'Close', zh: '收盤' }, key: { color: colors.slots[0], shape: 'line' } }]) : '';
        }
        const mark = (series === 1 ? buys : sells)[index];
        if (!mark) return '';
        return tooltip(mark.date, [
          { value: `${quantity(mark.qty)} @ ${price(mark.price, currency)}`, label: SIDE_LABEL[mark.side], key: { color: mark.side === 'buy' ? colors.status.good : colors.status.critical, shape: 'dot' } },
        ]);
      },
    },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: colors.grid } }, axisLabel: { color: colors.muted, hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: colors.muted }, splitLine: { lineStyle: { color: colors.grid, opacity: 0.5 } } },
    series: [line, side('buy'), side('sell')],
  };
}

export function PriceHistoryChart({ ticker, currency, points, trades, avgCost }: { ticker: string; currency: string; points: readonly ClosePoint[]; trades: readonly ChartTrade[]; avgCost: number | null }) {
  const [range, setRange] = useState<Range>('1Y');
  const [step, setStep] = useState<Step>(DEFAULT_STEP['1Y']);
  const shown = useMemo(() => window(points, range, step), [points, range, step]);
  const last = points[points.length - 1];
  const from = last ? rangeStart(last.date, range) : null;
  const marks = useMemo(() => tradeMarks(trades, ticker, from), [trades, ticker, from]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors, width) => option(shown, marks, currency, avgCost, colors, width)), [shown, marks, currency, avgCost]);
  const moved = change(shown);
  const pick = (next: Range) => {
    setRange(next);
    setStep(DEFAULT_STEP[next]);
  };
  return (
    <div className="form">
      <div className="segmented" role="group" aria-label="Range 區間">
        {RANGES.map((option) => (
          <button key={option} type="button" lang="zh-Hant" title={RANGE_LABEL[option].en} className={option === range ? 'tab selected' : 'tab'} aria-pressed={option === range} onClick={() => pick(option)}>
            {RANGE_LABEL[option].zh}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Step 週期">
        <span className="label" lang="zh-Hant">
          週期
        </span>
        {STEPS.map((option) => (
          <button key={option} type="button" lang="zh-Hant" title={STEP_LABEL[option].en} className={option === step ? 'tab selected' : 'tab'} aria-pressed={option === step} onClick={() => setStep(option)}>
            {STEP_LABEL[option].zh}
          </button>
        ))}
      </div>
      <ul className="facts" aria-live="polite">
        <li className={`fact ${moved === null ? 'none' : moved >= 0 ? 'ok' : 'alert'}`}>
          <span className="fact-label">
            <Bi en="Change in range" zh="區間漲跌" label />
          </span>
          <strong className="fact-value">{moved === null ? '—' : signedPercent(moved)}</strong>
        </li>
        <li className="fact">
          <span className="fact-label">
            <Bi en="Trades in range" zh="區間交易" label />
          </span>
          <strong className="fact-value">{`▲${marks.filter((mark) => mark.side === 'buy').length} ▼${marks.filter((mark) => mark.side === 'sell').length}`}</strong>
        </li>
      </ul>
      <figure className="chart-figure">
        <div ref={ref} className="chart" role="img" aria-label={`${ticker} 收盤價走勢與買賣點`} />
        <Legend
          items={[
            { label: { en: 'Close', zh: '收盤價' }, color: 'var(--chart-1)', shape: 'line' },
            { label: { en: 'Buy', zh: '買進' }, color: 'var(--status-good)', shape: 'dot' },
            { label: { en: 'Sell', zh: '賣出' }, color: 'var(--status-critical)', shape: 'dot' },
            ...(avgCost === null ? [] : [{ label: { en: 'Average cost', zh: '平均成本' }, color: 'var(--muted)', shape: 'line' as const }]),
          ]}
        />
      </figure>
      {shown.length === 0 && (
        <p className="muted">
          <span className="status-icon idle" aria-hidden="true">
            …
          </span>{' '}
          <Bi en="No closes yet" zh="尚無收盤價" />
        </p>
      )}
    </div>
  );
}
