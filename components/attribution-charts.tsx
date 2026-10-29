'use client';

/**
 * The N2 charts (PRD visual catalogue). The waterfall runs from the benchmark's return through
 * allocation, selection, interaction and currency to the portfolio's: totals in the gray and the
 * accent, each effect up in the good colour or down in the critical one with its figure written
 * on it. The quadrant plots each class's active weight against how its benchmark did against the
 * whole benchmark, so an overweight of a winner (top right) or an underweight of a loser (bottom
 * left) is easy to see. The cumulative lines show which effect drives the result over time.
 * Every value is also in a table on the page.
 */
import type { BarSeriesOption, LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { percent, signedPercent } from '@/lib/format';
import { bi, EFFECT, type Bilingual } from '@/lib/i18n';

import { axisPercent, dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

export interface WaterfallStep {
  label: Bilingual;
  /** The step's own value: a total's level, or an effect. */
  value: number;
  /** The running level after the step. */
  level: number;
  kind: 'total' | 'effect';
}

function waterfallOption(steps: readonly WaterfallStep[], colors: Colors): Option {
  const base: number[] = [];
  const up: Array<number | null> = [];
  const down: Array<number | null> = [];
  const total: Array<number | null> = [];
  for (const step of steps) {
    if (step.kind === 'total') {
      base.push(0);
      up.push(null);
      down.push(null);
      total.push(step.value);
    } else {
      const before = step.level - step.value;
      base.push(Math.min(before, step.level));
      up.push(step.value >= 0 ? Math.abs(step.value) : null);
      down.push(step.value < 0 ? Math.abs(step.value) : null);
      total.push(null);
    }
  }
  const bar = (name: string, data: Array<number | null>, color: string, label: (index: number) => string): BarSeriesOption => ({
    name,
    type: 'bar',
    stack: 'steps',
    barMaxWidth: 56,
    data,
    itemStyle: { color, borderColor: colors.surface, borderWidth: 1 },
    emphasis: { disabled: true },
    label: { show: true, position: 'top', color: colors.ink, fontSize: 11, formatter: (info) => label(info.dataIndex) },
  });
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 28, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'axis-shadow'),
      formatter: (params) => {
        const step = steps[dataIndex(params) ?? -1];
        if (!step) return '';
        return tooltip(bi(step.label), [
          { value: step.kind === 'total' ? percent(step.value, 2) : signedPercent(step.value, 2), label: step.kind === 'total' ? { en: 'return', zh: '報酬' } : { en: 'effect', zh: '效果' } },
          ...(step.kind === 'effect' ? [{ value: percent(step.level, 2), label: { en: 'running total', zh: '累計' } }] : []),
        ]);
      },
    },
    xAxis: { type: 'category', data: steps.map((step) => bi(step.label)), axisTick: { show: false }, axisLine: { lineStyle: { color: colors.grid } }, axisLabel: { color: colors.muted, interval: 0, fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } } },
    series: [
      { name: 'base', type: 'bar', stack: 'steps', data: base, itemStyle: { color: 'transparent' }, silent: true, emphasis: { disabled: true } },
      bar('up', up, colors.status.good, (i) => signedPercent(steps[i]?.value, 2)),
      bar('down', down, colors.status.critical, (i) => signedPercent(steps[i]?.value, 2)),
      bar('total', total, colors.slots[0], (i) => percent(steps[i]?.value, 2)),
    ],
  };
}

export function WaterfallChart({ steps, label }: { steps: readonly WaterfallStep[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => waterfallOption(steps, colors)), [steps]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: { en: 'Return', zh: '報酬' }, color: 'var(--chart-1)', shape: 'rect' },
          { label: { en: 'Adds', zh: '加分' }, color: 'var(--status-good)', shape: 'rect' },
          { label: { en: 'Costs', zh: '扣分' }, color: 'var(--status-critical)', shape: 'rect' },
        ]}
      />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Quadrant
// ---------------------------------------------------------------------------

export interface QuadrantPoint {
  name: string;
  /** Average active weight over the period, a fraction. */
  active: number;
  /** The class's benchmark return less the whole benchmark's, over the period. */
  relative: number;
  /** The class's allocation + selection + interaction + currency, to colour by. */
  effect: number;
}

function quadrantOption(points: readonly QuadrantPoint[], colors: Colors): Option {
  const dots: ScatterSeriesOption = {
    type: 'scatter',
    symbolSize: 14,
    data: points.map((point) => ({
      value: [point.active, point.relative],
      name: point.name,
      itemStyle: { color: point.effect >= 0 ? colors.slots[0] : colors.context, borderColor: colors.surface, borderWidth: 2 },
      label: { show: true, formatter: point.name, position: 'right' as const, color: colors.ink, fontSize: 11 },
    })),
    markLine: { silent: true, symbol: 'none', lineStyle: { color: colors.muted, width: 1, type: 'dashed' }, label: { show: false }, data: [{ xAxis: 0 }, { yAxis: 0 }] },
  };
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 120, top: 28, bottom: 28, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const item = params as { dataIndex?: number };
        const point = points[item.dataIndex ?? -1];
        if (!point) return '';
        return tooltip(point.name, [
          { value: signedPercent(point.active, 1), label: { en: 'active weight (average)', zh: '主動權重（平均）' } },
          { value: signedPercent(point.relative, 1), label: { en: 'return vs the benchmark', zh: '相對基準報酬' } },
          { value: signedPercent(point.effect, 2), label: { en: 'total effect', zh: '總效果' } },
        ]);
      },
    },
    xAxis: { type: 'value', name: bi({ en: 'Active weight', zh: '主動權重' }), nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: colors.muted }, axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } } },
    yAxis: { type: 'value', name: bi({ en: 'Return vs benchmark', zh: '相對基準報酬' }), nameTextStyle: { color: colors.muted, align: 'left' }, axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } } },
    series: [dots],
  };
}

export function QuadrantChart({ points, label }: { points: readonly QuadrantPoint[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => quadrantOption(points, colors)), [points]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: { en: 'Added to the return', zh: '帶來加分' }, color: 'var(--chart-1)', shape: 'dot' },
          { label: { en: 'Took from it', zh: '帶來扣分' }, color: 'var(--chart-context)', shape: 'dot' },
        ]}
      />
      <div ref={ref} className="chart tall" role="img" aria-label={bi(label)} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Cumulative effects
// ---------------------------------------------------------------------------

export interface CumulativeRow {
  month: string;
  allocation: number;
  selection: number;
  interaction: number;
  currency: number;
}

const KEYS = ['allocation', 'selection', 'interaction', 'currency'] as const;

function cumulativeOption(rows: readonly CumulativeRow[], colors: Colors): Option {
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const row = rows[dataIndex(params) ?? -1];
        if (!row) return '';
        return tooltip(row.month, KEYS.map((key, i) => ({ value: signedPercent(row[key], 2), label: EFFECT[key], key: { color: colors.slots[i] as string, shape: 'line' as const } })));
      },
    },
    xAxis: { type: 'category', data: rows.map((row) => row.month), axisTick: { show: false }, axisLine: { lineStyle: { color: colors.grid } }, axisLabel: { color: colors.muted, hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } } },
    series: KEYS.map(
      (key, i): LineSeriesOption => ({
        name: bi(EFFECT[key]),
        type: 'line',
        data: rows.map((row) => row[key]),
        showSymbol: rows.length <= 24,
        symbolSize: 6,
        lineStyle: { width: 2, color: colors.slots[i] as string, cap: 'round', join: 'round' },
        itemStyle: { color: colors.slots[i] as string },
        emphasis: { disabled: true },
      }),
    ),
  };
}

export function CumulativeChart({ rows, label }: { rows: readonly CumulativeRow[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => cumulativeOption(rows, colors)), [rows]);
  return (
    <figure className="chart-figure">
      <Legend items={KEYS.map((key, i) => ({ label: EFFECT[key], color: `var(--chart-${i + 1})`, shape: 'line' as const }))} />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}
