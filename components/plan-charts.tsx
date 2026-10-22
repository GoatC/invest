'use client';

/**
 * The F2 charts (PRD Module A and the visual catalogue). The projection: one stacked bar a year,
 * what was put in (the de-emphasis gray) under the growth on it (the accent), so the bar's height
 * is the value, with the value in today's money as a line. Actual vs plan: the regular pool's
 * month ends against the plan's path. One TWD axis each; the legends are plain HTML and every
 * value is also in the table under each chart.
 */
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { twd } from '@/lib/format';
import { bi, PLAN_SERIES, type Bilingual } from '@/lib/i18n';
import type { PlanRow, YearPoint } from '@/lib/models/projection';

import { dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

/** Axis ticks in TWD, short: "NT$1.2M", "NT$850K". */
function axisTwd(value: number): string {
  const size = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (size >= 1e6) return `${sign}NT$${Number((size / 1e6).toFixed(1))}M`;
  if (size >= 1e3) return `${sign}NT$${Number((size / 1e3).toFixed(0))}K`;
  return `${sign}NT$${size}`;
}

function valueAxis(colors: Colors) {
  return {
    type: 'value' as const,
    axisLabel: { color: colors.muted, formatter: axisTwd },
    splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' as const } },
  };
}

function line(label: Bilingual, color: string, data: Array<[string | number, number]>, z: number, colors: Colors): LineSeriesOption {
  return {
    name: bi(label),
    type: 'line',
    data,
    z,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 8,
    lineStyle: { width: 2, color, cap: 'round', join: 'round' },
    itemStyle: { color, borderColor: colors.surface, borderWidth: 2 },
    emphasis: { disabled: true },
  };
}

// ---------------------------------------------------------------------------
// The projection, year by year
// ---------------------------------------------------------------------------

export interface YearBar extends YearPoint {
  /** The month the year ends, YYYY-MM. */
  ends: string;
}

function projectionOption(years: readonly YearBar[], colors: Colors): Option {
  // A year that lost money shows its value as put in, with no growth on top; the table and the
  // tooltip give the loss.
  const bars = (label: Bilingual, color: string, value: (year: YearBar) => number, top: (year: YearBar) => boolean): BarSeriesOption => ({
    name: bi(label),
    type: 'bar',
    stack: 'value',
    barMaxWidth: 24,
    itemStyle: { color, borderColor: colors.surface, borderWidth: 1 },
    emphasis: { disabled: true },
    data: years.map((year) => ({ value: value(year), itemStyle: { borderRadius: top(year) ? [4, 4, 0, 0] : 0 } })),
  });
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-shadow'),
      formatter: (params) => {
        const year = years[dataIndex(params) ?? -1];
        if (!year) return '';
        return tooltip(`${year.ends} · ${bi({ en: `year ${year.year}`, zh: `第 ${year.year} 年` })}`, [
          { value: twd(year.value), label: PLAN_SERIES.value },
          { value: twd(year.growth), label: PLAN_SERIES.growth, key: { color: colors.slots[0], shape: 'rect' } },
          { value: twd(year.contributed), label: PLAN_SERIES.contributed, key: { color: colors.context, shape: 'rect' } },
          { value: twd(year.real), label: PLAN_SERIES.real, key: { color: colors.slots[1], shape: 'line' } },
        ]);
      },
    },
    xAxis: {
      type: 'category',
      data: years.map((year) => year.ends.slice(0, 4)),
      axisLine: { lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, hideOverlap: true },
    },
    yAxis: valueAxis(colors),
    series: [
      bars(PLAN_SERIES.contributed, colors.context, (year) => Math.min(year.contributed, year.value), (year) => year.growth <= 0),
      bars(PLAN_SERIES.growth, colors.slots[0], (year) => Math.max(year.growth, 0), (year) => year.growth > 0),
      line(PLAN_SERIES.real, colors.slots[1], years.map((year) => [year.ends.slice(0, 4), year.real]), 3, colors),
    ],
  };
}

export function ProjectionChart({ years, label }: { years: readonly YearBar[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => projectionOption(years, colors)), [years]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: PLAN_SERIES.growth, color: 'var(--chart-1)', shape: 'rect' },
          { label: PLAN_SERIES.contributed, color: 'var(--chart-context)', shape: 'rect' },
          { label: PLAN_SERIES.real, color: 'var(--chart-2)', shape: 'line' },
        ]}
      />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Actual vs plan
// ---------------------------------------------------------------------------

function againstOption(rows: readonly PlanRow[], colors: Colors): Option {
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const row = rows[dataIndex(params) ?? -1];
        if (!row) return '';
        return tooltip(row.date, [
          { value: twd(row.actual), label: PLAN_SERIES.actual, key: { color: colors.slots[0], shape: 'line' } },
          { value: twd(row.planned), label: PLAN_SERIES.planned, key: { color: colors.context, shape: 'line' } },
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
    yAxis: valueAxis(colors),
    series: [
      line(PLAN_SERIES.planned, colors.context, rows.map((row) => [row.date, row.planned]), 2, colors),
      { ...line(PLAN_SERIES.actual, colors.slots[0], rows.map((row) => [row.date, row.actual]), 3, colors), showSymbol: rows.length <= 24, showAllSymbol: true },
    ],
  };
}

export function AgainstPlanChart({ rows, label }: { rows: readonly PlanRow[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => againstOption(rows, colors)), [rows]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: PLAN_SERIES.actual, color: 'var(--chart-1)', shape: 'line' },
          { label: PLAN_SERIES.planned, color: 'var(--chart-context)', shape: 'line' },
        ]}
      />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}
