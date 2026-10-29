'use client';

/**
 * The F1 timeline chart (PRD Module A). One time axis over the whole plan: the Monte Carlo median
 * with its outer-percentile band, the plan's path on F2's engine dashed, the actual value at each
 * month end in the accent, the phases as shaded stripes behind them and each later goal as a
 * labelled vertical line. One TWD axis; the legend is plain HTML and every value is also in the
 * tables under the chart.
 */
import type { LineSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { twd } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';

import { Legend, mount, tooltip, tooltipStyle, type Colors, type MarkArea, type Option } from './echarts';

export interface TimelinePoint {
  /** YYYY-MM-DD. */
  date: string;
  low: number;
  median: number;
  high: number;
  /** The plan's path on F2's engine. */
  expected: number;
}

export interface TimelineActual {
  date: string;
  value: number;
}

export interface TimelinePhase {
  label: Bilingual;
  from: string;
  to: string;
  /** 0 or 1: which stripe colour. */
  tone: 0 | 1;
}

export interface TimelineGoal {
  date: string;
  label: string;
}

function axisTwd(value: number): string {
  const size = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (size >= 1e6) return `${sign}NT$${Number((size / 1e6).toFixed(1))}M`;
  if (size >= 1e3) return `${sign}NT$${Number((size / 1e3).toFixed(0))}K`;
  return `${sign}NT$${size}`;
}

const SERIES = {
  median: { en: 'Median (F5)', zh: '中位數（F5）' },
  band: { en: 'Band (F5)', zh: '區間（F5）' },
  plan: { en: 'Plan (F2)', zh: '計畫（F2）' },
  actual: { en: 'Actual', zh: '實際' },
} as const satisfies Record<string, Bilingual>;

function option(points: readonly TimelinePoint[], actual: readonly TimelineActual[], phases: readonly TimelinePhase[], goals: readonly TimelineGoal[], bandText: string, colors: Colors): Option {
  const line = (name: Bilingual, color: string, data: Array<[string, number]>, z: number, dashed = false): LineSeriesOption => ({
    name: bi(name),
    type: 'line',
    data,
    z,
    showSymbol: false,
    lineStyle: { width: 2, color, type: dashed ? 'dashed' : 'solid', cap: 'round', join: 'round' },
    itemStyle: { color },
    emphasis: { disabled: true },
  });
  const stripes = phases.map((phase): MarkArea => [
    { name: bi(phase.label), xAxis: phase.from, itemStyle: { color: phase.tone === 0 ? colors.slots[0] : colors.slots[2], opacity: 0.07 }, label: { color: colors.muted, position: 'insideTopLeft' as const } },
    { xAxis: phase.to },
  ]);
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 16, top: 28, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const value = first && typeof first === 'object' && 'axisValue' in first ? first.axisValue : undefined;
        const at = typeof value === 'number' ? new Date(value).toISOString().slice(0, 10) : '';
        // The nearest projected year end to the pointer, and the latest actual before it.
        const nearest = points.reduce<TimelinePoint | undefined>((best, point) => (!best || Math.abs(Date.parse(point.date) - Date.parse(at)) < Math.abs(Date.parse(best.date) - Date.parse(at)) ? point : best), undefined);
        const seen = [...actual].reverse().find((entry) => entry.date <= at);
        if (!nearest) return '';
        return tooltip(nearest.date, [
          { value: twd(nearest.high), label: { en: `High end (${bandText})`, zh: `高端（${bandText}）` }, key: { color: colors.slots[0], shape: 'rect' } },
          { value: twd(nearest.median), label: SERIES.median, key: { color: colors.slots[0], shape: 'line' } },
          { value: twd(nearest.low), label: { en: `Low end (${bandText})`, zh: `低端（${bandText}）` }, key: { color: colors.slots[0], shape: 'rect' } },
          { value: twd(nearest.expected), label: SERIES.plan, key: { color: colors.context, shape: 'line' } },
          ...(seen ? [{ value: twd(seen.value), label: { en: `Actual, ${seen.date}`, zh: `實際，${seen.date}` }, key: { color: colors.slots[1], shape: 'line' as const } }] : []),
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
    yAxis: { type: 'value', axisLabel: { color: colors.muted, formatter: axisTwd }, splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' } } },
    series: [
      {
        name: 'base',
        type: 'line',
        stack: 'band',
        data: points.map((point): [string, number] => [point.date, point.low]),
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        silent: true,
        emphasis: { disabled: true },
        markArea: { silent: true, data: stripes, label: { show: true } },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: colors.muted, width: 1, type: 'dashed' },
          label: { color: colors.ink, formatter: (info) => String(info.name), position: 'insideEndTop' },
          data: goals.map((goal) => ({ name: goal.label, xAxis: goal.date })),
        },
      },
      {
        name: bi(SERIES.band),
        type: 'line',
        stack: 'band',
        data: points.map((point): [string, number] => [point.date, point.high - point.low]),
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: colors.slots[0], opacity: 0.2 },
        silent: true,
        emphasis: { disabled: true },
      },
      line(SERIES.plan, colors.context, points.map((point): [string, number] => [point.date, point.expected]), 1, true),
      line(SERIES.median, colors.slots[0], points.map((point): [string, number] => [point.date, point.median]), 2),
      {
        ...line(SERIES.actual, colors.slots[1], [], 3),
        // Only today's point shows a mark, ringed in the surface colour.
        showSymbol: true,
        symbol: 'none',
        data: actual.map((entry, index) =>
          index === actual.length - 1
            ? { value: [entry.date, entry.value] as [string, number], symbol: 'circle', symbolSize: 10, itemStyle: { color: colors.slots[1], borderColor: colors.surface, borderWidth: 2 } }
            : { value: [entry.date, entry.value] as [string, number] },
        ),
      },
    ],
  };
}

export function TimelineChart({
  points,
  actual,
  phases,
  goals,
  bandText,
  label,
}: {
  points: readonly TimelinePoint[];
  actual: readonly TimelineActual[];
  phases: readonly TimelinePhase[];
  goals: readonly TimelineGoal[];
  bandText: string;
  label: Bilingual;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => option(points, actual, phases, goals, bandText, colors)), [points, actual, phases, goals, bandText]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: SERIES.actual, color: 'var(--chart-2)', shape: 'line' },
          { label: SERIES.median, color: 'var(--chart-1)', shape: 'line' },
          { label: { en: `Band ${bandText} (F5)`, zh: `區間 ${bandText}（F5）` }, color: 'var(--chart-1)', shape: 'rect' },
          { label: SERIES.plan, color: 'var(--chart-context)', shape: 'line' },
        ]}
      />
      <div ref={ref} className="chart tall" role="img" aria-label={bi(label)} />
    </figure>
  );
}
