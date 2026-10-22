'use client';

/**
 * The F18 charts (PRD Section 3, Module E: line + stacked bar): the cumulative return against the
 * SAA benchmark, and each month's TWD return split into local-currency, currency and cross terms.
 * ECharts draws them in the browser. Colours come from the --chart-* tokens in globals.css, read
 * when a chart mounts and again when the phone switches between light and dark; the legends are
 * plain HTML, and every value is also in the table under each chart.
 */
import type { BarSeriesOption, LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { signedPercent } from '@/lib/format';
import { bi, RETURN_SERIES as SERIES, type Bilingual } from '@/lib/i18n';
import type { CumulativePoint, MonthReturn } from '@/lib/models/performance';

import { axisPercent, dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

// ---------------------------------------------------------------------------
// Cumulative return against the SAA benchmark
// ---------------------------------------------------------------------------

function cumulativeOption(points: readonly CumulativePoint[], colors: Colors): Option {
  const last = points[points.length - 1];
  const values = points.flatMap((point) => (point.benchmark === null ? [point.twr] : [point.twr, point.benchmark]));
  const span = Math.max(...values, 0) - Math.min(...values, 0) || 1;
  // End labels while the two lines end apart; close together they would collide, and the legend and tooltip carry them.
  const apart = !last || last.benchmark === null || Math.abs(last.twr - last.benchmark) / span > 0.08;
  const line = (label: Bilingual, color: string, data: Array<[string, number | null]>, z: number): LineSeriesOption => ({
    name: bi(label),
    type: 'line',
    data,
    z,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 8,
    connectNulls: false,
    lineStyle: { width: 2, color, cap: 'round', join: 'round' },
    itemStyle: { color, borderColor: colors.surface, borderWidth: 2 },
    emphasis: { disabled: true },
    endLabel: apart
      ? { show: true, color: colors.ink, fontFamily: colors.font, fontSize: 12, distance: 6, formatter: (params) => signedPercent(Array.isArray(params.value) ? Number(params.value[1]) : null) }
      : { show: false },
  });
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: apart ? 56 : 12, top: 12, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const point = points[dataIndex(params) ?? -1];
        if (!point) return '';
        return tooltip(point.date, [
          { value: signedPercent(point.twr), label: SERIES.portfolio, key: { color: colors.slots[0], shape: 'line' } },
          { value: signedPercent(point.benchmark), label: SERIES.benchmark, key: { color: colors.context, shape: 'line' } },
        ]);
      },
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: colors.muted, hideOverlap: true, formatter: { year: '{yyyy}', month: '{yyyy}-{MM}', day: '{MM}-{dd}' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: colors.muted, formatter: axisPercent },
      splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' } },
    },
    series: [
      line(SERIES.benchmark, colors.context, points.map((point) => [point.date, point.benchmark]), 2),
      line(SERIES.portfolio, colors.slots[0], points.map((point) => [point.date, point.twr]), 3),
    ],
  };
}

export function CumulativeChart({ points, label }: { points: readonly CumulativePoint[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => cumulativeOption(points, colors)), [points]);
  const hasBenchmark = points.some((point) => point.benchmark !== null);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: SERIES.portfolio, color: 'var(--chart-1)', shape: 'line' },
          ...(hasBenchmark ? [{ label: SERIES.benchmark, color: 'var(--chart-context)', shape: 'line' as const }] : []),
        ]}
      />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Each month's return, split
// ---------------------------------------------------------------------------

const PARTS = ['local', 'currency', 'cross'] as const;

function monthlyOption(months: readonly MonthReturn[], colors: Colors): Option {
  // Round the data end of the outermost segment each way: the top of the last positive one, the
  // bottom of the last negative one; segments stack away from 0 in series order.
  const outer = months.map((month) => {
    let up = -1;
    let down = -1;
    PARTS.forEach((part, index) => {
      if (month[part] > 0) up = index;
      else if (month[part] < 0) down = index;
    });
    return { up, down };
  });
  const bars: BarSeriesOption[] = PARTS.map((part, index) => ({
    name: bi(SERIES[part]),
    type: 'bar',
    stack: 'split',
    barMaxWidth: 24,
    // The 1px edge in the surface colour leaves a 2px gap between touching segments.
    itemStyle: { color: colors.slots[index], borderColor: colors.surface, borderWidth: 1 },
    emphasis: { disabled: true },
    data: months.map((month, at) => ({
      value: month[part],
      itemStyle: { borderRadius: outer[at]?.up === index ? [4, 4, 0, 0] : outer[at]?.down === index ? [0, 0, 4, 4] : 0 },
    })),
  }));
  const total: ScatterSeriesOption = {
    name: bi(SERIES.total),
    type: 'scatter',
    z: 5,
    symbolSize: 8,
    itemStyle: { color: colors.ink, borderColor: colors.surface, borderWidth: 2, opacity: 1 },
    emphasis: { disabled: true },
    data: months.map((month) => month.twr),
  };
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-shadow'),
      formatter: (params) => {
        const month = months[dataIndex(params) ?? -1];
        if (!month) return '';
        return tooltip(month.month, [
          { value: signedPercent(month.twr, 2), label: SERIES.total, key: { color: colors.ink, shape: 'dot' } },
          { value: signedPercent(month.local, 2), label: SERIES.local, key: { color: colors.slots[0], shape: 'rect' } },
          { value: signedPercent(month.currency, 2), label: SERIES.currency, key: { color: colors.slots[1], shape: 'rect' } },
          { value: signedPercent(month.cross, 2), label: SERIES.cross, key: { color: colors.slots[2], shape: 'rect' } },
          { value: signedPercent(month.benchmark, 2), label: SERIES.benchmark },
        ]);
      },
    },
    xAxis: {
      type: 'category',
      data: months.map((month) => month.month),
      axisLine: { onZero: true, lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: colors.muted, formatter: axisPercent },
      splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' } },
    },
    series: [...bars, total],
  };
}

export function MonthlyChart({ months, label }: { months: readonly MonthReturn[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => monthlyOption(months, colors)), [months]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: SERIES.local, color: 'var(--chart-1)', shape: 'rect' },
          { label: SERIES.currency, color: 'var(--chart-2)', shape: 'rect' },
          { label: SERIES.cross, color: 'var(--chart-3)', shape: 'rect' },
          { label: SERIES.total, color: 'var(--text)', shape: 'dot' },
        ]}
      />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}
