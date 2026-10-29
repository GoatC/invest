'use client';

/**
 * The F10 underwater chart (PRD visual catalogue): how far below its peak the portfolio is each
 * month of a scenario, in the accent, with the gauge (the equity series F3's tiers read) in the
 * de-emphasis gray and F3's tiers as labelled lines. Drawdowns are plotted downward, so the
 * deeper the fall the lower the line. Every value is also in the table under the chart.
 */
import type { LineSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { signedPercent } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';

import { axisPercent, dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

export interface UnderwaterPoint {
  /** YYYY-MM. */
  month: string;
  /** Fall from the peak, a fraction: 0.2 is 20%. */
  drawdown: number;
  /** The gauge's fall from its window high; null in a custom scenario. */
  gauge: number | null;
}

const SERIES = {
  portfolio: { en: 'Your portfolio', zh: '你的投資組合' },
  gauge: { en: 'Gauge (F3)', zh: '指標（F3）' },
} as const satisfies Record<string, Bilingual>;

function option(points: readonly UnderwaterPoint[], tiers: readonly number[], colors: Colors): Option {
  const showGauge = points.some((point) => point.gauge !== null);
  const line = (name: Bilingual, color: string, data: Array<number | null>, z: number): LineSeriesOption => ({
    name: bi(name),
    type: 'line',
    data,
    z,
    showSymbol: false,
    lineStyle: { width: 2, color, cap: 'round', join: 'round' },
    itemStyle: { color },
    emphasis: { disabled: true },
  });
  const gaugeSeries = line(SERIES.gauge, colors.context, points.map((point) => (point.gauge === null ? null : -point.gauge)), 1);
  const portfolio: LineSeriesOption = {
    ...line(SERIES.portfolio, colors.slots[0], points.map((point) => -point.drawdown), 2),
    areaStyle: { color: colors.slots[0], opacity: 0.12 },
    markLine: {
      silent: true,
      symbol: 'none',
      lineStyle: { color: colors.muted, width: 1, type: 'dashed' },
      label: { color: colors.muted, formatter: (info) => String(info.name), position: 'insideEndTop' },
      data: showGauge ? tiers.map((tier) => ({ name: bi({ en: `F3 tier ${Math.round(tier * 100)}%`, zh: `F3 級距 ${Math.round(tier * 100)}%` }), yAxis: -tier })) : [],
    },
  };
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const point = points[dataIndex(params) ?? -1];
        if (!point) return '';
        return tooltip(point.month, [
          { value: signedPercent(-point.drawdown, 1), label: SERIES.portfolio, key: { color: colors.slots[0], shape: 'line' } },
          ...(point.gauge === null ? [] : [{ value: signedPercent(-point.gauge, 1), label: SERIES.gauge, key: { color: colors.context, shape: 'line' as const } }]),
        ]);
      },
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.month),
      axisLine: { lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, hideOverlap: true },
    },
    yAxis: { type: 'value', max: 0, axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' } } },
    series: showGauge ? [gaugeSeries, portfolio] : [portfolio],
  };
}

export function UnderwaterChart({ points, tiers, label }: { points: readonly UnderwaterPoint[]; tiers: readonly number[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => option(points, tiers, colors)), [points, tiers]);
  const showGauge = points.some((point) => point.gauge !== null);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: SERIES.portfolio, color: 'var(--chart-1)', shape: 'line' },
          ...(showGauge ? [{ label: SERIES.gauge, color: 'var(--chart-context)', shape: 'line' as const }] : []),
        ]}
      />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} />
    </figure>
  );
}
