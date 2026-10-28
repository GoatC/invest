'use client';

/**
 * The F3 backtest chart: for every start month, how the pace (grey) and the pace with its
 * acceleration (the accent) ended against a lump sum, as a return over it at the horizon. Above
 * the zero line the tranches did better; the table under the chart sums it up.
 */
import type { LineSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { signedPercent } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';

import { axisPercent, dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

export interface BacktestPoint {
  /** YYYY-MM. */
  start: string;
  /** rule ÷ lump − 1 and pace ÷ lump − 1. */
  rule: number;
  pace: number;
  tranches: number;
}

const RULE: Bilingual = { en: 'This rule (pace and acceleration)', zh: '本規則（節奏與加速）' };
const PACE: Bilingual = { en: 'The pace alone', zh: '只依節奏' };

function line(label: Bilingual, color: string, data: Array<[string, number]>, z: number): LineSeriesOption {
  return { name: bi(label), type: 'line', data, z, showSymbol: false, lineStyle: { width: 1.5, color }, itemStyle: { color }, emphasis: { disabled: true } };
}

function option(points: readonly BacktestPoint[], colors: Colors): Option {
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const point = points[dataIndex(params) ?? -1];
        if (!point) return '';
        return tooltip(`${point.start} · ${bi({ en: `${point.tranches} tranches`, zh: `分 ${point.tranches} 批` })}`, [
          { value: signedPercent(point.rule), label: RULE, key: { color: colors.slots[0], shape: 'line' } },
          { value: signedPercent(point.pace), label: PACE, key: { color: colors.context, shape: 'line' } },
        ]);
      },
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.start),
      axisLine: { lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, hideOverlap: true, formatter: (value: string) => value.slice(0, 4) },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: colors.muted, formatter: axisPercent },
      splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' } },
    },
    series: [
      line(PACE, colors.context, points.map((point) => [point.start, point.pace]), 2),
      {
        ...line(RULE, colors.slots[0], points.map((point) => [point.start, point.rule]), 3),
        markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: colors.muted, width: 1, type: 'solid' }, data: [{ yAxis: 0 }] },
      },
    ],
  };
}

export function BacktestChart({ points, label }: { points: readonly BacktestPoint[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => option(points, colors)), [points]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: RULE, color: 'var(--chart-1)', shape: 'line' },
          { label: PACE, color: 'var(--chart-context)', shape: 'line' },
        ]}
      />
      <div ref={ref} className="chart chart-backtest" role="img" aria-label={bi(label)} />
    </figure>
  );
}
