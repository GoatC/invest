'use client';

/**
 * The N4 VaR figure and its charts (PRD Module E and the visual catalogue). The figure is a stat
 * tile: the VaR in NT$ and as a share of the portfolio, a 1-week / 1-month toggle, and a 52-week
 * sparkline in the de-emphasis gray with today's point in the accent. The histogram shows where
 * the VaR sits among the current mix's weekly returns: an emphasis chart, the weeks that lost more
 * than the VaR in the accent and the rest in gray, the cutoff as a labelled line. Every value is
 * also in a table on the risk page.
 */
import type { BarSeriesOption, LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import { useEffect, useRef, useState } from 'react';

import { percent, signedPercent, twd } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';
import type { Bin, VarPoint } from '@/lib/models/risk';
import type { Horizon } from '@/lib/risk-text';

import { Bi } from './bi';
import { axisPercent, dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

// ---------------------------------------------------------------------------
// The figure: VaR, share of the portfolio, toggle, 52-week line
// ---------------------------------------------------------------------------

function sparklineOption(points: readonly VarPoint[], scale: number, label: Bilingual, colors: Colors): Option {
  const data: Array<[string, number]> = points.map((point) => [point.date, point.valueAtRisk * scale]);
  const line: LineSeriesOption = {
    type: 'line',
    data,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 8,
    lineStyle: { width: 2, color: colors.context, cap: 'round', join: 'round' },
    itemStyle: { color: colors.context, borderColor: colors.surface, borderWidth: 2 },
    emphasis: { disabled: true },
  };
  // Today's figure, the one the tile shows, in the accent with a ring in the surface colour.
  const today: ScatterSeriesOption = {
    type: 'scatter',
    data: data.slice(-1),
    symbolSize: 8,
    silent: true,
    z: 3,
    itemStyle: { color: colors.slots[0], borderColor: colors.surface, borderWidth: 2, opacity: 1 },
  };
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 6, right: 6, top: 8, bottom: 8 },
    tooltip: {
      ...tooltipStyle(colors, 'axis-line'),
      formatter: (params) => {
        const point = points[dataIndex(params) ?? -1];
        if (!point) return '';
        return tooltip(point.date, [
          { value: twd(point.valueAtRisk * scale), label, key: { color: colors.context, shape: 'line' } },
          { value: percent(point.totalTwd > 0 ? (point.valueAtRisk * scale) / point.totalTwd : null), label: { en: 'of the portfolio', zh: '占投資組合' } },
        ]);
      },
    },
    xAxis: { type: 'time', show: false },
    yAxis: { type: 'value', show: false, scale: true },
    series: [line, today],
  };
}

function Sparkline({ points, scale, label }: { points: readonly VarPoint[]; scale: number; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => sparklineOption(points, scale, label, colors)), [points, scale, label]);
  const first = points[0];
  const last = points[points.length - 1];
  const high = points.reduce<VarPoint | undefined>((top, point) => (!top || point.valueAtRisk > top.valueAtRisk ? point : top), undefined);
  if (!first || !last || points.length < 2) {
    return (
      <p className="muted small">
        <Bi en="The 52-week line fills in as the nightly job saves each day's VaR." zh="每夜排程每天存下風險值後，這裡會逐漸畫出近 52 週的變化。" />
      </p>
    );
  }
  const summary: Bilingual = {
    en: `${label.en} each week since ${first.date}: from ${twd(first.valueAtRisk * scale)} to ${twd(last.valueAtRisk * scale)}, highest ${twd((high?.valueAtRisk ?? 0) * scale)} on ${high?.date}.`,
    zh: `${first.date} 起每週的${label.zh}：從 ${twd(first.valueAtRisk * scale)} 到 ${twd(last.valueAtRisk * scale)}，最高 ${twd((high?.valueAtRisk ?? 0) * scale)}（${high?.date}）。`,
  };
  return (
    <figure className="chart-figure">
      <div ref={ref} className="chart sparkline" role="img" aria-label={bi(summary)} />
      <figcaption className="muted small">
        <Bi en={`The last 52 weeks, since ${first.date}`} zh={`近 52 週（${first.date} 起）`} />
      </figcaption>
    </figure>
  );
}

export function VarFigure({ horizons, weekVar, valueTwd, line }: { horizons: readonly Horizon[]; weekVar: number; valueTwd: number; line: readonly VarPoint[] }) {
  const [selected, setSelected] = useState(0);
  const horizon = horizons[selected] ?? horizons[0];
  if (!horizon) return null;
  const scale = Math.sqrt(horizon.weeks);
  const value = weekVar * scale;
  const share = percent(valueTwd > 0 ? value / valueTwd : null);
  return (
    <div className="form">
      <div className="segmented" role="group" aria-label="Horizon 期間">
        {horizons.map((option, index) => (
          <button key={option.tab.en} type="button" className={index === selected ? 'tab selected' : 'tab'} aria-pressed={index === selected} onClick={() => setSelected(index)}>
            <Bi {...option.tab} />
          </button>
        ))}
      </div>
      <div className="stat" aria-live="polite">
        <span className="muted small">
          <Bi {...horizon.label} />
        </span>
        <span className="var-value">{twd(value)}</span>
        <span>
          <Bi en={`(${share} of portfolio)`} zh={`（投資組合的 ${share}）`} />
        </span>
      </div>
      <p>
        <Bi {...horizon.note} />
      </p>
      <Sparkline points={line} scale={scale} label={horizon.label} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Where the VaR sits among the weekly returns
// ---------------------------------------------------------------------------

const BEYOND: Bilingual = { en: 'Lost more than the VaR', zh: '損失超過風險值' };
const OTHER: Bilingual = { en: 'Other weeks', zh: '其他週' };

function histogramOption(bins: readonly Bin[], cutoff: number, cutoffLabel: Bilingual, colors: Colors): Option {
  const isBeyond = (bin: Bin) => bin.to <= -cutoff + 1e-12;
  const bars: BarSeriesOption = {
    type: 'bar',
    // A histogram's bins touch, as the returns run on; the 1px edge in the surface colour leaves
    // a 2px gap between neighbours.
    barCategoryGap: '0%',
    itemStyle: { borderColor: colors.surface, borderWidth: 1 },
    emphasis: { itemStyle: { opacity: 0.8 } },
    data: bins.map((bin) => ({
      value: [(bin.from + bin.to) / 2, bin.count],
      itemStyle: { color: isBeyond(bin) ? colors.slots[0] : colors.context, borderRadius: [4, 4, 0, 0] },
    })),
    markLine: {
      silent: true,
      symbol: 'none',
      animation: false,
      lineStyle: { color: colors.ink, width: 2, type: 'solid' },
      // Short beside the line; the legend names it in full.
      label: { show: true, position: 'end', color: colors.ink, fontFamily: colors.font, fontSize: 12, formatter: `${bi({ en: 'VaR', zh: '風險值' })} ${signedPercent(-cutoff)}` },
      data: [{ xAxis: -cutoff }],
    },
  };
  const first = bins[0];
  const last = bins[bins.length - 1];
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 16, top: 28, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const bin = bins[dataIndex(params) ?? -1];
        if (!bin) return '';
        const weeks = { en: bin.count === 1 ? 'week' : 'weeks', zh: '週' };
        return tooltip(`${signedPercent(bin.from, 2)} to ${signedPercent(bin.to, 2)}`, [
          {
            value: String(bin.count),
            label: isBeyond(bin) ? { en: `${weeks.en}, ${BEYOND.en.toLowerCase()}`, zh: `${weeks.zh}，${BEYOND.zh}` } : weeks,
            key: { color: isBeyond(bin) ? colors.slots[0] : colors.context, shape: 'rect' },
          },
        ]);
      },
    },
    xAxis: {
      type: 'value',
      min: first?.from,
      max: last?.to,
      axisLine: { onZero: false, lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: colors.muted, formatter: axisPercent, hideOverlap: true, showMinLabel: false, showMaxLabel: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: colors.muted },
      splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' } },
    },
    series: [bars],
  };
}

export function ReturnHistogram({ bins, cutoff, cutoffLabel, label }: { bins: readonly Bin[]; cutoff: number; cutoffLabel: Bilingual; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors) => histogramOption(bins, cutoff, cutoffLabel, colors)), [bins, cutoff, cutoffLabel]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: BEYOND, color: 'var(--chart-1)', shape: 'rect' },
          { label: OTHER, color: 'var(--chart-context)', shape: 'rect' },
          { label: cutoffLabel, color: 'var(--text)', shape: 'line' },
        ]}
      />
      <div ref={ref} className="chart chart-histogram" role="img" aria-label={bi(label)} />
    </figure>
  );
}
