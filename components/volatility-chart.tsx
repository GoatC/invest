'use client';

/**
 * The volatility score over the last year (N8): one line on a fixed 1-to-10 axis, with the four
 * bands the alert reads (calm, normal, tense, panic) as faint stripes, the newest day as a dot
 * in the accent. A day without enough figures is a gap. The table under it on the page lists
 * today's components.
 */
import type { LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import { useEffect, useRef } from 'react';

import { bi, type Bilingual } from '@/lib/i18n';

import { Bi } from './bi';
import { dataIndex, mount, tooltip, tooltipStyle, type Colors, type MarkArea, type Option } from './echarts';

export interface ScorePoint {
  date: string;
  score: number | null;
  coverage: number;
}

const BANDS: ReadonlyArray<{ from: number; to: number; tone: 'good' | 'none' | 'warning' | 'critical' }> = [
  { from: 1, to: 4, tone: 'good' },
  { from: 4, to: 6, tone: 'none' },
  { from: 6, to: 8, tone: 'warning' },
  { from: 8, to: 10, tone: 'critical' },
];

function option(points: readonly ScorePoint[], colors: Colors): Option {
  const data: Array<[string, number | null]> = points.map((point) => [point.date, point.score]);
  const last = [...points].reverse().find((point) => point.score !== null);
  const stripes: MarkArea[] = BANDS.filter((band) => band.tone !== 'none').map((band) => [
    { yAxis: band.from, itemStyle: { color: colors.status[band.tone as 'good' | 'warning' | 'critical'], opacity: 0.08 } },
    { yAxis: band.to },
  ]);
  const line: LineSeriesOption = {
    type: 'line',
    data,
    connectNulls: false,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 8,
    lineStyle: { width: 2, color: colors.slots[0], cap: 'round', join: 'round' },
    itemStyle: { color: colors.slots[0], borderColor: colors.surface, borderWidth: 2 },
    markArea: { silent: true, data: stripes },
  };
  const latest: ScatterSeriesOption = {
    type: 'scatter',
    data: last ? [[last.date, last.score as number]] : [],
    symbolSize: 9,
    silent: true,
    z: 3,
    itemStyle: { color: colors.slots[0], borderColor: colors.surface, borderWidth: 2, opacity: 1 },
  };
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 32, right: 12, top: 12, bottom: 28 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const point = points[dataIndex(params) ?? -1];
        if (!point) return '';
        return tooltip(point.date, [
          { value: point.score === null ? '—' : `${point.score.toFixed(1)} / 10`, label: { en: 'Volatility score', zh: '波動分數' }, key: { color: colors.slots[0], shape: 'line' } },
          { value: `${Math.round(point.coverage * 100)}%`, label: { en: 'Weight covered', zh: '涵蓋權重' } },
        ]);
      },
    },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: colors.grid } }, axisLabel: { color: colors.muted, hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: 'value', min: 1, max: 10, interval: 1, axisLabel: { color: colors.muted }, splitLine: { lineStyle: { color: colors.grid, opacity: 0.5 } } },
    series: [line, latest],
  };
}

export function VolatilityChart({ points }: { points: readonly ScorePoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => option(points, colors)), [points]);
  const scored = points.filter((point) => point.score !== null);
  const first = scored[0];
  const last = scored[scored.length - 1];
  if (!first || !last || scored.length < 2) {
    return (
      <p className="muted small">
        <Bi en="The history fills in as the volatility job runs." zh="歷史走勢會隨波動排程每次執行而累積。" />
      </p>
    );
  }
  const high = scored.reduce((top, point) => ((point.score as number) > (top.score as number) ? point : top), first);
  const summary: Bilingual = {
    en: `Volatility score from ${first.date} to ${last.date}: from ${first.score?.toFixed(1)} to ${last.score?.toFixed(1)}, highest ${high.score?.toFixed(1)} on ${high.date}.`,
    zh: `${first.date} 至 ${last.date} 的波動分數：從 ${first.score?.toFixed(1)} 到 ${last.score?.toFixed(1)}，最高 ${high.score?.toFixed(1)}（${high.date}）。`,
  };
  return (
    <figure className="chart-figure">
      <div ref={ref} className="chart" role="img" aria-label={bi(summary)} />
      <figcaption className="muted small">
        <Bi en={`The last year, since ${first.date}; stripes: calm 1–4, tense 6–8, panic 8–10`} zh={`近一年（${first.date} 起）；色帶：平靜 1–4、緊張 6–8、恐慌 8–10`} />
      </figcaption>
    </figure>
  );
}
