'use client';

/**
 * The F7 charts (PRD visual catalogue). The frontier: volatility across, expected return up, the
 * efficient frontier as a line, the capital market line dashed from the risk-free rate through the
 * tangent portfolio, each class and the current and target mixes as labelled points. Weights
 * along the frontier: stacked areas, one per class. Correlations: a heatmap, every cell also
 * writing its figure so colour is never the only cue. The tables on the page hold the same figures.
 */
import type { LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { percent } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';

import { axisPercent, dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

export interface Spot {
  name: string;
  vol: number;
  ret: number;
}

export interface Curve {
  vol: number;
  ret: number;
}

const SERIES = {
  frontier: { en: 'Efficient frontier', zh: '效率前緣' },
  line: { en: 'Capital market line', zh: '資本市場線' },
  classes: { en: 'Asset classes', zh: '資產類別' },
  current: { en: 'Current mix', zh: '目前配置' },
  target: { en: 'Target mix', zh: '目標配置' },
  tangent: { en: 'Tangent portfolio', zh: '切線組合' },
} as const satisfies Record<string, Bilingual>;

function point(spot: Spot, color: string, symbol: string, size: number, colors: Colors, place: 'right' | 'top' | 'bottom' | 'left' = 'right') {
  return {
    value: [spot.vol, spot.ret],
    name: spot.name,
    symbol,
    symbolSize: size,
    itemStyle: { color, borderColor: colors.surface, borderWidth: 2 },
    label: { show: true, formatter: spot.name, position: place, color: colors.ink, fontSize: 11 },
  };
}

function frontierOption(curve: readonly Curve[], line: readonly Curve[], classes: readonly Spot[], current: Spot | null, target: Spot | null, best: Spot | null, riskFree: number, colors: Colors): Option {
  const frontier: LineSeriesOption = {
    name: bi(SERIES.frontier),
    type: 'line',
    data: curve.map((p): [number, number] => [p.vol, p.ret]),
    showSymbol: false,
    z: 2,
    lineStyle: { width: 2, color: colors.slots[0], cap: 'round', join: 'round' },
    itemStyle: { color: colors.slots[0] },
    emphasis: { disabled: true },
  };
  const market: LineSeriesOption = {
    name: bi(SERIES.line),
    type: 'line',
    data: line.map((p): [number, number] => [p.vol, p.ret]),
    showSymbol: false,
    z: 1,
    lineStyle: { width: 1.5, color: colors.context, type: 'dashed' },
    itemStyle: { color: colors.context },
    emphasis: { disabled: true },
    silent: true,
  };
  const dots: ScatterSeriesOption = {
    name: bi(SERIES.classes),
    type: 'scatter',
    z: 3,
    data: classes.map((spot) => point(spot, colors.context, 'circle', 9, colors)),
  };
  const marks: ScatterSeriesOption = {
    name: 'mixes',
    type: 'scatter',
    z: 4,
    data: [
      ...(current ? [point(current, colors.slots[1], 'diamond', 14, colors, 'top')] : []),
      ...(target ? [point(target, colors.slots[2], 'rect', 11, colors, 'bottom')] : []),
      ...(best ? [point(best, colors.slots[0], 'triangle', 13, colors, 'left')] : []),
    ],
  };
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 24, top: 16, bottom: 28, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const item = params as { seriesType?: string; value?: [number, number]; name?: string };
        const [vol, ret] = item.value ?? [0, 0];
        return tooltip(item.name && item.seriesType === 'scatter' ? item.name : bi(item.seriesType === 'line' ? SERIES.frontier : { en: 'Point', zh: '點' }), [
          { value: percent(ret, 2), label: { en: 'expected return', zh: '預期報酬' } },
          { value: percent(vol, 2), label: { en: 'volatility', zh: '波動度' } },
        ]);
      },
    },
    xAxis: { type: 'value', name: bi({ en: 'Volatility σ', zh: '波動度 σ' }), nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: colors.muted }, min: 0, axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } } },
    yAxis: { type: 'value', name: bi({ en: 'Expected return', zh: '預期報酬' }), nameTextStyle: { color: colors.muted, align: 'left' }, min: Math.min(0, riskFree), scale: true, axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } } },
    series: [market, frontier, dots, marks],
  };
}

export function FrontierChart(props: { curve: readonly Curve[]; line: readonly Curve[]; classes: readonly Spot[]; current: Spot | null; target: Spot | null; best: Spot | null; riskFree: number; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  const { curve, line, classes, current, target, best, riskFree } = props;
  useEffect(() => mount(ref.current, (colors) => frontierOption(curve, line, classes, current, target, best, riskFree, colors)), [curve, line, classes, current, target, best, riskFree]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: SERIES.frontier, color: 'var(--chart-1)', shape: 'line' },
          { label: SERIES.line, color: 'var(--chart-context)', shape: 'line' },
          { label: SERIES.classes, color: 'var(--chart-context)', shape: 'dot' },
          ...(current ? [{ label: SERIES.current, color: 'var(--chart-2)', shape: 'dot' as const }] : []),
          ...(target ? [{ label: SERIES.target, color: 'var(--chart-3)', shape: 'dot' as const }] : []),
          ...(best ? [{ label: SERIES.tangent, color: 'var(--chart-1)', shape: 'dot' as const }] : []),
        ]}
      />
      <div ref={ref} className="chart tall" role="img" aria-label={bi(props.label)} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Weights along the frontier
// ---------------------------------------------------------------------------

export interface WeightRow {
  vol: number;
  /** One weight per class, in the order of `names`. */
  weights: number[];
}

function weightsOption(rows: readonly WeightRow[], names: readonly string[], colors: Colors): Option {
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 28, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const row = rows[dataIndex(params) ?? -1];
        if (!row) return '';
        return tooltip(`σ ${percent(row.vol, 2)}`, names.map((name, i) => ({ value: percent(row.weights[i], 1), label: { en: name, zh: name }, key: { color: colors.slots[i % colors.slots.length] as string, shape: 'rect' as const } })).filter((_, i) => (row.weights[i] ?? 0) > 0.0005));
      },
    },
    xAxis: { type: 'category', boundaryGap: false, data: rows.map((row) => percent(row.vol, 1)), name: bi({ en: 'Volatility σ', zh: '波動度 σ' }), nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: colors.muted }, axisLabel: { color: colors.muted, hideOverlap: true }, axisTick: { show: false }, axisLine: { lineStyle: { color: colors.grid } } },
    yAxis: { type: 'value', max: 1, axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } } },
    series: names.map(
      (name, i): LineSeriesOption => ({
        name,
        type: 'line',
        stack: 'weights',
        data: rows.map((row) => row.weights[i] ?? 0),
        symbol: 'none',
        lineStyle: { width: 1, color: colors.surface },
        areaStyle: { color: colors.slots[i % colors.slots.length] as string, opacity: 0.85 },
        emphasis: { disabled: true },
      }),
    ),
  };
}

export function WeightsChart({ rows, names, label }: { rows: readonly WeightRow[]; names: readonly string[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => weightsOption(rows, names, colors)), [rows, names]);
  return (
    <figure className="chart-figure">
      <ul className="chart-legend">
        {names.map((name, i) => (
          <li key={name}>
            <span className="chart-key rect" style={{ background: `var(--chart-${(i % 8) + 1})` }} aria-hidden="true" />
            {name}
          </li>
        ))}
      </ul>
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Correlations
// ---------------------------------------------------------------------------

function correlationOption(names: readonly string[], matrix: ReadonlyArray<readonly number[]>, colors: Colors, width: number): Option {
  const cell = Math.max(34, Math.min(70, Math.floor((width - 120) / Math.max(names.length, 1)) - 4));
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 8, top: 36, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const [x, y] = ((params as { value?: [number, number] }).value ?? [0, 0]) as [number, number];
        return tooltip(`${names[y]} · ${names[x]}`, [{ value: (matrix[y]?.[x] ?? 0).toFixed(2), label: { en: 'correlation', zh: '相關係數' } }]);
      },
    },
    xAxis: { type: 'category', data: [...names], position: 'top', axisLabel: { color: colors.muted, fontSize: 11, interval: 0, rotate: names.length > 4 ? 30 : 0 }, axisTick: { show: false }, axisLine: { show: false } },
    yAxis: { type: 'category', data: [...names], inverse: true, axisLabel: { color: colors.ink, fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [
      {
        type: 'scatter',
        symbol: 'rect',
        symbolSize: [cell, 26],
        data: names.flatMap((_, y) =>
          names.map((__, x) => {
            const value = matrix[y]?.[x] ?? 0;
            // Strength is the size of the correlation; the sign shows in the colour and the figure.
            const strong = Math.abs(value);
            return {
              value: [x, y],
              itemStyle: { color: value >= 0 ? colors.slots[0] : colors.slots[3], opacity: 0.15 + 0.85 * strong },
              label: { show: true, formatter: value.toFixed(2), color: strong > 0.6 ? '#ffffff' : colors.ink, fontSize: width < 520 ? 9 : 11, fontWeight: 600 as const },
            };
          }),
        ),
      },
    ],
  };
}

export function CorrelationHeatmap({ names, matrix, label }: { names: readonly string[]; matrix: ReadonlyArray<readonly number[]>; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors, width) => correlationOption(names, matrix, colors, width)), [names, matrix]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: { en: 'Move together', zh: '同向' }, color: 'var(--chart-1)', shape: 'rect' },
          { label: { en: 'Move apart', zh: '反向' }, color: 'var(--chart-4)', shape: 'rect' },
        ]}
      />
      <div ref={ref} className="chart chart-heatmap" role="img" aria-label={bi(label)} style={{ height: `${Math.max(200, 70 + names.length * 32)}px` }} />
    </figure>
  );
}
