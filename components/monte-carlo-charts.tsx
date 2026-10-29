'use client';

/**
 * The F5 charts (PRD visual catalogue). The fan: one line per year for the median with the band
 * between the low and high percentile shaded around it, the mean path (every month at its expected
 * return) dashed, and what was put in in the de-emphasis gray. The spread: the final year's value
 * across the paths in bins that touch, the paths short of the goal in gray and those that reach it
 * in the accent, the goal as a labelled line. One TWD axis each; the legends are plain HTML and
 * every value is also in the tables under the charts.
 */
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { twd } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';
import type { ValueBin, YearFigures } from '@/lib/models/monte-carlo';

import { dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

/** Axis ticks in TWD, short: "NT$1.2M", "NT$850K". */
function axisTwd(value: number): string {
  const size = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (size >= 1e6) return `${sign}NT$${Number((size / 1e6).toFixed(1))}M`;
  if (size >= 1e3) return `${sign}NT$${Number((size / 1e3).toFixed(0))}K`;
  return `${sign}NT$${size}`;
}

const SERIES = {
  median: { en: 'Median', zh: '中位數' },
  band: { en: 'Band', zh: '區間' },
  expected: { en: 'Mean path (F2)', zh: '平均路徑（F2）' },
  putIn: { en: 'Money put in', zh: '投入金額' },
  reaching: { en: 'Reach the goal', zh: '達成目標' },
  short: { en: 'Fall short', zh: '未達目標' },
} as const satisfies Record<string, Bilingual>;

function valueAxis(colors: Colors) {
  return {
    type: 'value' as const,
    axisLabel: { color: colors.muted, formatter: axisTwd },
    splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' as const } },
  };
}

// ---------------------------------------------------------------------------
// The fan
// ---------------------------------------------------------------------------

export type Basis = 'nominal' | 'real';

function pick(point: YearFigures, basis: Basis) {
  return basis === 'real'
    ? { low: point.realLow, median: point.realMedian, high: point.realHigh }
    : { low: point.low, median: point.median, high: point.high };
}

function fanOption(fan: readonly YearFigures[], basis: Basis, band: readonly [number, number], inflation: number, colors: Colors): Option {
  const shown = fan.map((point) => pick(point, basis));
  const real = (value: number, year: number) => (basis === 'real' ? value / (1 + inflation) ** year : value);
  const line = (name: Bilingual, color: string, data: number[], z: number, dashed = false): LineSeriesOption => ({
    name: bi(name),
    type: 'line',
    data,
    z,
    showSymbol: false,
    lineStyle: { width: 2, color, type: dashed ? 'dashed' : 'solid', cap: 'round', join: 'round' },
    itemStyle: { color },
    emphasis: { disabled: true },
  });
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const at = dataIndex(params) ?? -1;
        const point = fan[at];
        const edge = shown[at];
        if (!point || !edge) return '';
        return tooltip(bi({ en: `Year ${point.year}`, zh: `第 ${point.year} 年` }), [
          { value: twd(edge.high), label: { en: `${Math.round(band[1] * 100)}th percentile`, zh: `第 ${Math.round(band[1] * 100)} 百分位` }, key: { color: colors.slots[0], shape: 'rect' } },
          { value: twd(edge.median), label: SERIES.median, key: { color: colors.slots[0], shape: 'line' } },
          { value: twd(edge.low), label: { en: `${Math.round(band[0] * 100)}th percentile`, zh: `第 ${Math.round(band[0] * 100)} 百分位` }, key: { color: colors.slots[0], shape: 'rect' } },
          { value: twd(real(point.expected, point.year)), label: SERIES.expected, key: { color: colors.slots[1], shape: 'line' } },
          { value: twd(real(point.putIn, point.year)), label: SERIES.putIn, key: { color: colors.context, shape: 'line' } },
        ]);
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: fan.map((point) => point.year),
      axisLine: { lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, hideOverlap: true },
    },
    yAxis: valueAxis(colors),
    series: [
      // The band is two stacked areas: an invisible one up to the low edge, the shaded one on it.
      { name: 'base', type: 'line', stack: 'band', data: shown.map((edge) => edge.low), symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, emphasis: { disabled: true } },
      {
        name: bi(SERIES.band),
        type: 'line',
        stack: 'band',
        data: shown.map((edge) => edge.high - edge.low),
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: colors.slots[0], opacity: 0.2 },
        silent: true,
        emphasis: { disabled: true },
      },
      line(SERIES.putIn, colors.context, fan.map((point) => real(point.putIn, point.year)), 1),
      line(SERIES.expected, colors.slots[1], fan.map((point) => real(point.expected, point.year)), 2, true),
      line(SERIES.median, colors.slots[0], shown.map((edge) => edge.median), 3),
    ],
  };
}

export function FanChart({ fan, basis, band, inflation, label, bandText }: { fan: readonly YearFigures[]; basis: Basis; band: readonly [number, number]; inflation: number; label: Bilingual; bandText: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => fanOption(fan, basis, band, inflation, colors)), [fan, basis, band, inflation]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: SERIES.median, color: 'var(--chart-1)', shape: 'line' },
          { label: { en: `Band ${bandText}`, zh: `區間 ${bandText}` }, color: 'var(--chart-1)', shape: 'rect' },
          { label: SERIES.expected, color: 'var(--chart-2)', shape: 'line' },
          { label: SERIES.putIn, color: 'var(--chart-context)', shape: 'line' },
        ]}
      />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// The spread of the final year
// ---------------------------------------------------------------------------

function spreadOption(bins: readonly ValueBin[], goal: number | null, total: number, colors: Colors): Option {
  const reaches = (bin: ValueBin) => goal !== null && bin.from >= goal - 1e-9;
  const bars: BarSeriesOption = {
    type: 'bar',
    barCategoryGap: '0%',
    emphasis: { disabled: true },
    data: bins.map((bin) => ({ value: bin.count, itemStyle: { color: goal === null || reaches(bin) ? colors.slots[0] : colors.context, borderColor: colors.surface, borderWidth: 1 } })),
  };
  // The goal falls inside one bin; the line is drawn at that bin's position along the category axis.
  const goalAt = goal === null ? -1 : bins.findIndex((bin) => goal >= bin.from && goal < bin.to);
  const goalBin = bins[goalAt];
  if (goal !== null && goalBin) {
    bars.markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: colors.ink, width: 2, type: 'solid' },
      label: { formatter: bi({ en: `Goal ${axisTwd(goal)}`, zh: `目標 ${axisTwd(goal)}` }), color: colors.ink, position: 'end' },
      data: [{ xAxis: goalAt + (goal - goalBin.from) / (goalBin.to - goalBin.from) - 0.5 }],
    };
  }
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 24, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-shadow'),
      formatter: (params) => {
        const bin = bins[dataIndex(params) ?? -1];
        if (!bin) return '';
        return tooltip(`${axisTwd(bin.from)} – ${axisTwd(bin.to)}`, [{ value: `${bin.count.toLocaleString('en-US')} (${((bin.count / total) * 100).toFixed(1)}%)`, label: { en: 'paths', zh: '條路徑' } }]);
      },
    },
    xAxis: {
      type: 'category',
      data: bins.map((bin) => axisTwd(bin.from)),
      axisLine: { lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, hideOverlap: true },
    },
    yAxis: { type: 'value', axisLabel: { color: colors.muted }, splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' } } },
    series: [bars],
  };
}

export function SpreadChart({ bins, goal, total, label }: { bins: readonly ValueBin[]; goal: number | null; total: number; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => spreadOption(bins, goal, total, colors)), [bins, goal, total]);
  return (
    <figure className="chart-figure">
      {goal !== null && (
        <Legend
          items={[
            { label: SERIES.reaching, color: 'var(--chart-1)', shape: 'rect' },
            { label: SERIES.short, color: 'var(--chart-context)', shape: 'rect' },
          ]}
        />
      )}
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}
