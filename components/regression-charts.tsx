'use client';

/**
 * The Regression Lab's charts (N1): each period's excess return against the market's with the
 * fitted line, β over a rolling 52 weeks, and the β of up to five tickers with their 95% interval.
 * A table under each chart holds the same figures.
 */
import type { CustomSeriesOption, LineSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { signedPercent } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';

import { axisPercent, dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

const slot = (colors: Colors, index: number) => colors.slots[index % colors.slots.length] as string;
const cssSlot = (index: number) => `var(--chart-${(index % 8) + 1})`;
const beta = (value: number) => value.toFixed(2);

export interface ScatterPoint {
  date: string;
  x: number;
  y: number;
}

function scatterOption(points: readonly ScatterPoint[], alpha: number, slope: number, axis: { x: Bilingual; y: Bilingual }, colors: Colors, colorIndex: number): Option {
  const xs = points.map((point) => point.x);
  const [low, high] = [Math.min(...xs), Math.max(...xs)];
  const color = slot(colors, colorIndex);
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const point = points[dataIndex(params) ?? -1];
        if (!point) return '';
        return tooltip(point.date, [
          { value: signedPercent(point.x, 2), label: axis.x },
          { value: signedPercent(point.y, 2), label: axis.y },
        ]);
      },
    },
    xAxis: { type: 'value', scale: true, axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } } },
    series: [
      { type: 'scatter', data: points.map((point) => [point.x, point.y]), symbolSize: 5, itemStyle: { color, opacity: 0.55 }, emphasis: { scale: 1.6 } },
      {
        type: 'line',
        data: [
          [low, alpha + slope * low],
          [high, alpha + slope * high],
        ],
        showSymbol: false,
        silent: true,
        lineStyle: { color: colors.ink, width: 2 },
        tooltip: { show: false },
      },
    ],
  };
}

/** One benchmark's panel: each period as a dot, the fitted line through them. */
export function ScatterFit({ points, alpha, slope, axis, label, colorIndex }: { points: readonly ScatterPoint[]; alpha: number; slope: number; axis: { x: Bilingual; y: Bilingual }; label: Bilingual; colorIndex: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => scatterOption(points, alpha, slope, axis, colors, colorIndex)), [points, alpha, slope, axis, colorIndex]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: { en: 'Each period', zh: '每期' }, color: cssSlot(colorIndex), shape: 'dot' },
          { label: { en: `Fit: β ${beta(slope)}`, zh: `回歸線：β ${beta(slope)}` }, color: 'var(--text)', shape: 'line' },
        ]}
      />
      <div ref={ref} className="chart chart-scatter" role="img" aria-label={bi(label)} />
    </figure>
  );
}

export interface Line {
  label: Bilingual;
  points: ReadonlyArray<{ date: string; value: number }>;
}

function rollingOption(lines: readonly Line[], colors: Colors): Option {
  const dates = [...new Set(lines.flatMap((line) => line.points.map((point) => point.date)))].sort();
  const series: LineSeriesOption[] = lines.map((line, index) => {
    const byDate = new Map(line.points.map((point) => [point.date, point.value]));
    return {
      name: bi(line.label),
      type: 'line',
      data: dates.map((date) => byDate.get(date) ?? null),
      connectNulls: true,
      showSymbol: false,
      lineStyle: { width: 1.75, color: slot(colors, index) },
      itemStyle: { color: slot(colors, index) },
      emphasis: { disabled: true },
      ...(index === 0 ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: colors.muted, width: 1, type: 'dashed' as const }, data: [{ yAxis: 1 }] } } : {}),
    };
  });
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const at = dataIndex(params);
        const date = dates[at ?? -1];
        if (!date) return '';
        return tooltip(
          date,
          lines.flatMap((line, index) => {
            const value = line.points.find((point) => point.date === date)?.value;
            return value === undefined ? [] : [{ value: beta(value), label: line.label, key: { color: slot(colors, index), shape: 'line' as const } }];
          }),
        );
      },
    },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: colors.grid } }, axisTick: { show: false }, axisLabel: { color: colors.muted, hideOverlap: true, formatter: (value: string) => value.slice(0, 7) } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: colors.muted, formatter: (value: number) => value.toFixed(2) }, splitLine: { lineStyle: { color: colors.grid } } },
    series,
  };
}

/** β over the 52 weeks behind each date, one line per series; the dashed line is β = 1, the market itself. */
export function RollingBeta({ lines, label }: { lines: readonly Line[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => rollingOption(lines, colors)), [lines]);
  return (
    <figure className="chart-figure">
      <Legend items={[...lines.map((line, index) => ({ label: line.label, color: cssSlot(index), shape: 'line' as const })), { label: { en: 'β = 1: moves with the market', zh: 'β = 1：與大盤同步' }, color: 'var(--muted)', shape: 'line' as const }]} />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}

export interface Range {
  ticker: string;
  beta: number;
  low: number;
  high: number;
}

function rangeOption(rows: readonly Range[], colors: Colors): Option {
  const whiskers: CustomSeriesOption = {
    type: 'custom',
    silent: true,
    data: rows.map((row, index) => [index, row.low, row.high]),
    renderItem: (_params, api) => {
      const [x, low, high] = [api.value(0), api.value(1), api.value(2)] as [number, number, number];
      const top = api.coord([x, high]) as [number, number];
      const bottom = api.coord([x, low]) as [number, number];
      const cap = 8;
      const style = { stroke: colors.ink, lineWidth: 1.5 };
      return {
        type: 'group',
        children: [
          { type: 'line', shape: { x1: top[0], y1: top[1], x2: bottom[0], y2: bottom[1] }, style },
          { type: 'line', shape: { x1: top[0] - cap, y1: top[1], x2: top[0] + cap, y2: top[1] }, style },
          { type: 'line', shape: { x1: bottom[0] - cap, y1: bottom[1], x2: bottom[0] + cap, y2: bottom[1] }, style },
        ],
      };
    },
    z: 2,
  };
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const row = rows[dataIndex(params) ?? -1];
        if (!row) return '';
        return tooltip(row.ticker, [
          { value: beta(row.beta), label: { en: 'β', zh: 'β' } },
          { value: `${beta(row.low)} … ${beta(row.high)}`, label: { en: '95% interval', zh: '95% 信賴區間' } },
        ]);
      },
    },
    xAxis: { type: 'category', data: rows.map((row) => row.ticker), axisLine: { lineStyle: { color: colors.grid } }, axisTick: { show: false }, axisLabel: { color: colors.ink } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: colors.muted, formatter: (value: number) => value.toFixed(2) }, splitLine: { lineStyle: { color: colors.grid } } },
    series: [
      whiskers,
      {
        type: 'scatter',
        data: rows.map((row, index) => ({ value: [index, row.beta], itemStyle: { color: slot(colors, index) } })),
        symbolSize: 12,
        z: 3,
        markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: colors.muted, width: 1, type: 'dashed' }, data: [{ yAxis: 1 }] },
      },
    ],
  };
}

/** Each ticker's β as a dot, its 95% interval as a whisker; the dashed line is β = 1. */
export function BetaRanges({ rows, label }: { rows: readonly Range[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => rangeOption(rows, colors)), [rows]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: { en: 'β', zh: 'β' }, color: 'var(--chart-1)', shape: 'dot' },
          { label: { en: '95% interval', zh: '95% 信賴區間' }, color: 'var(--text)', shape: 'line' },
        ]}
      />
      <div ref={ref} className="chart chart-range" role="img" aria-label={bi(label)} />
    </figure>
  );
}
