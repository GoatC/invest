'use client';

/**
 * The F18 charts (PRD Section 3, Module E: line + stacked bar): the cumulative return against the
 * SAA benchmark, and each month's TWD return split into local-currency, currency and cross terms.
 * ECharts draws them in the browser. Colours come from the --chart-* tokens in globals.css, read
 * when a chart mounts and again when the phone switches between light and dark; the legends are
 * plain HTML, and every value is also in the table under each chart.
 */
import { BarChart, LineChart, ScatterChart, type BarSeriesOption, type LineSeriesOption, type ScatterSeriesOption } from 'echarts/charts';
import { GridComponent, TooltipComponent, type GridComponentOption, type TooltipComponentOption } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

import { signedPercent } from '@/lib/format';
import { bi, RETURN_SERIES as SERIES, type Bilingual } from '@/lib/i18n';
import type { CumulativePoint, MonthReturn } from '@/lib/models/performance';

import { Bi } from './bi';

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, SVGRenderer]);

type Option = echarts.ComposeOption<BarSeriesOption | LineSeriesOption | ScatterSeriesOption | GridComponentOption | TooltipComponentOption>;

interface Colors {
  series: [string, string, string];
  context: string;
  ink: string;
  muted: string;
  grid: string;
  surface: string;
  font: string;
}

function readColors(element: HTMLElement): Colors {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    series: [token('--chart-1'), token('--chart-2'), token('--chart-3')],
    context: token('--chart-context'),
    ink: token('--text'),
    muted: token('--muted'),
    grid: token('--border'),
    surface: token('--surface'),
    font: style.fontFamily,
  };
}

/** Draws a chart into the element, redrawing on a light/dark switch and resizing with it; returns the clean-up. */
function mount(element: HTMLDivElement | null, build: (colors: Colors) => Option): (() => void) | undefined {
  if (!element) return undefined;
  const chart = echarts.init(element, null, { renderer: 'svg' });
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const draw = () => chart.setOption({ animation: !motion.matches, ...build(readColors(element)) }, true);
  draw();
  dark.addEventListener('change', draw);
  const resize = new ResizeObserver(() => chart.resize());
  resize.observe(element);
  return () => {
    dark.removeEventListener('change', draw);
    resize.disconnect();
    chart.dispose();
  };
}

/** Axis ticks: whole percentages where the range allows, e.g. "−5%", "12.5%". */
function axisPercent(value: number): string {
  const text = `${Number((Math.abs(value) * 100).toFixed(2))}%`;
  return value < 0 ? `−${text}` : text;
}

type Key = { color: string; shape: 'line' | 'rect' | 'dot' };

/** The tooltip, built from text nodes: the value first, then what it is, keyed by a mark in the series colour. */
function tooltip(title: string, rows: ReadonlyArray<{ value: string; label: Bilingual; key?: Key }>): HTMLElement {
  const box = document.createElement('div');
  box.className = 'chart-tip';
  const head = document.createElement('div');
  head.className = 'chart-tip-title';
  head.textContent = title;
  box.append(head);
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'chart-tip-row';
    const key = document.createElement('span');
    key.className = `chart-key ${row.key?.shape ?? 'none'}`;
    if (row.key) key.style.background = row.key.color;
    const value = document.createElement('strong');
    value.textContent = row.value;
    const label = document.createElement('span');
    label.textContent = bi(row.label);
    line.append(key, value, label);
    box.append(line);
  }
  return box;
}

const axisTooltip = (colors: Colors, pointer: 'line' | 'shadow'): TooltipComponentOption => ({
  trigger: 'axis',
  confine: true,
  axisPointer:
    pointer === 'line'
      ? { type: 'line', lineStyle: { color: colors.muted, width: 1, type: 'solid' } }
      : { type: 'shadow', shadowStyle: { color: colors.grid, opacity: 0.35 } },
  backgroundColor: colors.surface,
  borderColor: colors.grid,
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: colors.ink, fontFamily: colors.font, fontSize: 13 },
  extraCssText: 'box-shadow: none; border-radius: 8px;',
});

function dataIndex(params: unknown): number | undefined {
  const first = Array.isArray(params) ? params[0] : params;
  return typeof first === 'object' && first !== null && 'dataIndex' in first && typeof first.dataIndex === 'number' ? first.dataIndex : undefined;
}

function Legend({ items }: { items: ReadonlyArray<{ label: Bilingual; color: string; shape: Key['shape'] }> }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.label.en}>
          <span className={`chart-key ${item.shape}`} style={{ background: item.color }} aria-hidden="true" />
          <Bi {...item.label} />
        </li>
      ))}
    </ul>
  );
}

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
      ...axisTooltip(colors, 'line'),
      formatter: (params) => {
        const point = points[dataIndex(params) ?? -1];
        if (!point) return '';
        return tooltip(point.date, [
          { value: signedPercent(point.twr), label: SERIES.portfolio, key: { color: colors.series[0], shape: 'line' } },
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
      line(SERIES.portfolio, colors.series[0], points.map((point) => [point.date, point.twr]), 3),
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
    itemStyle: { color: colors.series[index], borderColor: colors.surface, borderWidth: 1 },
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
      ...axisTooltip(colors, 'shadow'),
      formatter: (params) => {
        const month = months[dataIndex(params) ?? -1];
        if (!month) return '';
        return tooltip(month.month, [
          { value: signedPercent(month.twr, 2), label: SERIES.total, key: { color: colors.ink, shape: 'dot' } },
          { value: signedPercent(month.local, 2), label: SERIES.local, key: { color: colors.series[0], shape: 'rect' } },
          { value: signedPercent(month.currency, 2), label: SERIES.currency, key: { color: colors.series[1], shape: 'rect' } },
          { value: signedPercent(month.cross, 2), label: SERIES.cross, key: { color: colors.series[2], shape: 'rect' } },
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
