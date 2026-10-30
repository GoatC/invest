'use client';

/**
 * The sector tab's charts (N7): a heatmap of each sector's returns by period, a treemap of the
 * portfolio's exposure by sector coloured by the chosen period's return, and a bubble chart of
 * return against volatility sized by exposure. Returns are on a diverging scale whose direction is
 * a setting (Taiwan's red up by default); every cell and tile also writes its figure, so colour is
 * never the only cue. The tables under them on the page hold the same figures.
 */
import { useEffect, useRef } from 'react';

import { percent, signedPercent, twd } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';

import { axisPercent, Legend, mount, NARROW, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

export type Convention = 'red_up' | 'green_up';

/** The colour of a return: up and down by the convention, its strength by how far it is from 0 against `cap`. */
function returnColor(colors: Colors, value: number | null, cap: number, convention: Convention): { color: string; opacity: number } {
  if (value === null) return { color: colors.context, opacity: 0.35 };
  const up = convention === 'red_up' ? colors.status.critical : colors.status.good;
  const down = convention === 'red_up' ? colors.status.good : colors.status.critical;
  const strength = cap > 0 ? Math.min(1, Math.abs(value) / cap) : 0;
  return { color: value >= 0 ? up : down, opacity: 0.18 + 0.82 * strength };
}

function legendItems(convention: Convention): Array<{ label: Bilingual; color: string; shape: 'rect' }> {
  const up = convention === 'red_up' ? 'var(--status-critical)' : 'var(--status-good)';
  const down = convention === 'red_up' ? 'var(--status-good)' : 'var(--status-critical)';
  return [
    { label: { en: 'Up', zh: '上漲' }, color: up, shape: 'rect' },
    { label: { en: 'Down', zh: '下跌' }, color: down, shape: 'rect' },
    { label: { en: 'No closes', zh: '無收盤價' }, color: 'var(--chart-context)', shape: 'rect' },
  ];
}

export interface HeatRow {
  label: string;
  /** The label on two lines, for a phone: the English name, then the Chinese and the market. */
  lines?: [string, string];
  values: Array<number | null>;
}

/** Row height and the space above the rows for the column names, wide and on a phone (two-line labels). */
const HEAT_ROW = { wide: 30, narrow: 40 };
const HEAT_TOP = { wide: 28, narrow: 36 };

function heatmapHeight(rows: number, narrow: boolean): number {
  return Math.max(180, (narrow ? HEAT_TOP.narrow : HEAT_TOP.wide) + rows * (narrow ? HEAT_ROW.narrow : HEAT_ROW.wide) + 8);
}

/**
 * The label column takes a set share of the width, so the period columns get the rest and each
 * cell fills its own column: on a phone the long bilingual sector names wrap onto two lines and
 * the column names shorten, rather than the cells and their figures piling into each other.
 */
function heatmapOption(rows: readonly HeatRow[], columns: readonly Bilingual[], shortColumns: readonly Bilingual[] | undefined, convention: Convention, colors: Colors, width: number): Option {
  const caps = columns.map((_, x) => Math.max(0.01, ...rows.map((row) => Math.abs(row.values[x] ?? 0))));
  const narrow = width < NARROW;
  const labelWidth = narrow ? Math.min(136, Math.round(width * 0.36)) : Math.min(300, Math.round(width * 0.36));
  const band = (width - labelWidth - 8) / Math.max(1, columns.length);
  const cell = Math.max(20, Math.min(96, Math.floor(band) - 3));
  const fontSize = narrow ? 10 : 11;
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: labelWidth, right: 8, top: narrow ? HEAT_TOP.narrow : HEAT_TOP.wide, bottom: 8, containLabel: false },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const [x, y] = ((params as { value?: [number, number] }).value ?? [0, 0]) as [number, number];
        const row = rows[y];
        const column = columns[x];
        if (!row || !column) return '';
        const value = row.values[x] ?? null;
        return tooltip(`${row.label} · ${bi(column)}`, [{ value: value === null ? '—' : signedPercent(value), label: { en: 'Return', zh: '報酬' } }]);
      },
    },
    xAxis: {
      type: 'category',
      data: columns.map((column, x) => {
        const short = narrow ? shortColumns?.[x] : undefined;
        return short ? `${short.en}\n${short.zh}` : bi(column);
      }),
      position: 'top',
      axisLabel: { color: colors.muted, fontSize, lineHeight: 12, interval: 0, width: Math.max(24, band - 2), overflow: 'break' },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    yAxis: {
      type: 'category',
      data: rows.map((row) => (narrow && row.lines ? row.lines.join('\n') : row.label)),
      inverse: true,
      axisLabel: { color: colors.ink, fontSize, lineHeight: 12, width: labelWidth - 10, overflow: 'break', margin: 8 },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: 'scatter',
        symbol: 'rect',
        symbolSize: [cell, (narrow ? HEAT_ROW.narrow : HEAT_ROW.wide) - 4],
        data: rows.flatMap((row, y) =>
          row.values.map((value, x) => {
            const fill = returnColor(colors, value, caps[x] as number, convention);
            return {
              value: [x, y],
              itemStyle: { color: fill.color, opacity: fill.opacity },
              label: { show: true, formatter: value === null ? '—' : signedPercent(value), color: fill.opacity > 0.6 ? '#ffffff' : colors.ink, fontSize: band < 46 ? 9 : narrow ? 10 : 11, fontWeight: 600 as const },
            };
          }),
        ),
      },
    ],
  };
}

/** Sectors down, periods across, each cell its return; `shortColumns` name the periods on a phone. */
export function SectorHeatmap({ rows, columns, shortColumns, convention, label }: { rows: readonly HeatRow[]; columns: readonly Bilingual[]; shortColumns?: readonly Bilingual[]; convention: Convention; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      mount(ref.current, (colors, width) => {
        // Taller rows on a phone, for the two-line labels; the chart resizes when its height changes.
        if (ref.current) ref.current.style.height = `${heatmapHeight(rows.length, width < NARROW)}px`;
        return heatmapOption(rows, columns, shortColumns, convention, colors, width);
      }),
    [rows, columns, shortColumns, convention],
  );
  return (
    <figure className="chart-figure">
      <Legend items={legendItems(convention)} />
      <div ref={ref} className="chart chart-heatmap" role="img" aria-label={bi(label)} style={{ height: `${heatmapHeight(rows.length, false)}px` }} />
    </figure>
  );
}

export interface SectorBox {
  name: string;
  exposureTwd: number;
  share: number;
  value: number | null;
}

function sectorTreemapOption(boxes: readonly SectorBox[], convention: Convention, colors: Colors, width: number): Option {
  const cap = Math.max(0.01, ...boxes.map((box) => Math.abs(box.value ?? 0)));
  return {
    textStyle: { fontFamily: colors.font },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const box = boxes.find((one) => one.name === (params as { name?: string }).name);
        if (!box) return '';
        return tooltip(box.name, [
          { value: twd(box.exposureTwd), label: { en: 'Exposure', zh: '曝險' } },
          { value: percent(box.share), label: { en: 'of the equity', zh: '占股票部位' } },
          { value: box.value === null ? '—' : signedPercent(box.value), label: { en: 'Return', zh: '報酬' } },
        ]);
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
        itemStyle: { borderColor: colors.surface, borderWidth: 2, gapWidth: 2 },
        label: {
          show: true,
          formatter: (params) => {
            const box = boxes.find((one) => one.name === (params as { name?: string }).name);
            return `${box?.name ?? ''}\n${box && box.value !== null ? signedPercent(box.value) : '—'}`;
          },
          color: colors.ink,
          fontSize: width < 520 ? 10 : 12,
          overflow: 'truncate',
        },
        data: boxes.map((box) => {
          const fill = returnColor(colors, box.value, cap, convention);
          return { name: box.name, value: box.exposureTwd, itemStyle: { color: fill.color, opacity: fill.opacity } };
        }),
      },
    ],
  };
}

/** Sectors sized by exposure, coloured by the period's return. */
export function SectorTreemap({ boxes, convention, label }: { boxes: readonly SectorBox[]; convention: Convention; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors, width) => sectorTreemapOption(boxes, convention, colors, width)), [boxes, convention]);
  return (
    <figure className="chart-figure">
      <Legend items={legendItems(convention)} />
      <div ref={ref} className="chart chart-treemap" role="img" aria-label={bi(label)} style={{ height: '360px' }} />
    </figure>
  );
}

export interface Bubble {
  label: string;
  market: 'US' | 'TW';
  ret: number;
  volatility: number;
  exposureTwd: number;
}

const MARKET_SLOT = { US: 0, TW: 1 } as const;

function bubbleOption(bubbles: readonly Bubble[], portfolio: { ret: number; volatility: number } | null, colors: Colors, width: number): Option {
  const largest = Math.max(1, ...bubbles.map((bubble) => bubble.exposureTwd));
  const size = (exposure: number) => 10 + 34 * Math.sqrt(exposure / largest);
  const series = (['US', 'TW'] as const).map((market) => ({
    type: 'scatter' as const,
    name: market,
    data: bubbles
      .filter((bubble) => bubble.market === market)
      .map((bubble) => ({ value: [bubble.ret, bubble.volatility], name: bubble.label, symbolSize: size(bubble.exposureTwd), itemStyle: { color: colors.slots[MARKET_SLOT[market]], opacity: bubble.exposureTwd > 0 ? 0.8 : 0.35, borderColor: colors.surface, borderWidth: 1 } })),
    label: { show: width >= 520, formatter: (params: { name?: string }) => params.name ?? '', position: 'right' as const, color: colors.muted, fontSize: 10 },
  }));
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const name = (params as { name?: string }).name ?? '';
        const bubble = bubbles.find((one) => one.label === name);
        if (!bubble) return portfolio ? tooltip(bi({ en: 'Portfolio', zh: '投資組合' }), [{ value: signedPercent(portfolio.ret), label: { en: '1-year return', zh: '一年報酬' } }, { value: percent(portfolio.volatility), label: { en: 'Volatility', zh: '波動度' } }]) : '';
        return tooltip(bubble.label, [
          { value: signedPercent(bubble.ret), label: { en: '1-year return', zh: '一年報酬' }, key: { color: colors.slots[MARKET_SLOT[bubble.market]] as string, shape: 'dot' } },
          { value: percent(bubble.volatility), label: { en: 'Volatility', zh: '波動度' } },
          { value: twd(bubble.exposureTwd), label: { en: 'Exposure', zh: '曝險' } },
        ]);
      },
    },
    xAxis: { type: 'value', name: bi({ en: '1-year return', zh: '一年報酬' }), nameLocation: 'middle', nameGap: 26, axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } }, nameTextStyle: { color: colors.muted } },
    yAxis: { type: 'value', name: bi({ en: 'Volatility', zh: '波動度' }), axisLabel: { color: colors.muted, formatter: axisPercent }, splitLine: { lineStyle: { color: colors.grid } }, nameTextStyle: { color: colors.muted } },
    series: [
      ...series,
      ...(portfolio ? [{ type: 'scatter' as const, name: 'portfolio', data: [{ value: [portfolio.ret, portfolio.volatility], name: '' }], symbol: 'diamond', symbolSize: 16, itemStyle: { color: colors.ink }, z: 4 }] : []),
    ],
  };
}

/** Each sector's 1-year return against its volatility, sized by exposure, with the portfolio's point. */
export function SectorBubbles({ bubbles, portfolio, label }: { bubbles: readonly Bubble[]; portfolio: { ret: number; volatility: number } | null; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors, width) => bubbleOption(bubbles, portfolio, colors, width)), [bubbles, portfolio]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: { en: 'US sectors', zh: '美國產業' }, color: 'var(--chart-1)', shape: 'dot' },
          { label: { en: 'Taiwan sectors', zh: '台灣產業' }, color: 'var(--chart-2)', shape: 'dot' },
          ...(portfolio ? [{ label: { en: 'Portfolio, by exposure', zh: '投資組合（依曝險加權）' }, color: 'var(--text)', shape: 'dot' as const }] : []),
        ]}
      />
      <div ref={ref} className="chart chart-bubbles" role="img" aria-label={bi(label)} style={{ height: '380px' }} />
    </figure>
  );
}
