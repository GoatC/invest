'use client';

/**
 * The valuation workbench's chart (F12): each model's bear-to-bull range of value a share, its base
 * case as a dot, against today's price and the buy and trim zones' prices. The table under it on
 * the page holds the same figures.
 */
import { useEffect, useRef } from 'react';

import { money } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';

import { dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

export interface ValueRange {
  label: Bilingual;
  /** The model's place in the fixed order (DCF, DDM, multiples), so its colour never moves. */
  slot: number;
  bear: number;
  base: number;
  bull: number;
}

const slot = (colors: Colors, index: number) => colors.slots[index % colors.slots.length] as string;

function rangeOption(rows: readonly ValueRange[], marks: { price: number; buy: number | null; trim: number | null }, currency: string, colors: Colors, width: number): Option {
  const names = rows.map((row) => bi(row.label));
  const all = [...rows.flatMap((row) => [row.bear, row.bull]), marks.price, ...(marks.buy ? [marks.buy] : []), ...(marks.trim ? [marks.trim] : [])];
  const span = Math.max(...all) - Math.min(...all) || Math.max(...all) * 0.1 || 1;
  const markLine = (value: number, label: Bilingual, color: string, type: 'solid' | 'dashed') => ({
    xAxis: value,
    lineStyle: { color, width: type === 'solid' ? 2 : 1, type },
    // The category axis runs top down, so a line's start is its top: the label sits above the bars.
    label: { formatter: bi(label), color: colors.muted, fontSize: 12, position: 'start' as const },
  });
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 16, top: 40, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const row = rows[dataIndex(params) ?? -1];
        if (!row) return '';
        return tooltip(bi(row.label), [
          { value: money(row.bull, currency), label: { en: 'Bull', zh: '樂觀' } },
          { value: money(row.base, currency), label: { en: 'Base', zh: '基本' }, key: { color: slot(colors, row.slot), shape: 'dot' } },
          { value: money(row.bear, currency), label: { en: 'Bear', zh: '悲觀' } },
          { value: money(marks.price, currency), label: { en: 'Price', zh: '股價' }, key: { color: colors.ink, shape: 'line' } },
        ]);
      },
    },
    xAxis: {
      type: 'value',
      min: Math.max(0, Math.min(...all) - span * 0.08),
      max: Math.max(...all) + span * 0.08,
      axisLabel: { color: colors.muted, formatter: (value: number) => money(value, currency, 0), hideOverlap: true },
      splitLine: { lineStyle: { color: colors.grid } },
      splitNumber: width < 520 ? 3 : 5,
    },
    yAxis: { type: 'category', data: names, inverse: true, axisLabel: { color: colors.ink }, axisTick: { show: false }, axisLine: { lineStyle: { color: colors.grid } } },
    series: [
      // The bear value as an invisible offset, then the range to the bull value.
      { type: 'bar', stack: 'range', data: rows.map((row) => row.bear), itemStyle: { color: 'transparent' }, silent: true, tooltip: { show: false }, barWidth: 14 },
      {
        type: 'bar',
        stack: 'range',
        data: rows.map((row) => ({ value: row.bull - row.bear, itemStyle: { color: slot(colors, row.slot), opacity: 0.45, borderRadius: 4 } })),
        barWidth: 14,
        markLine: {
          symbol: 'none',
          silent: true,
          data: [
            markLine(marks.price, { en: 'Price', zh: '股價' }, colors.ink, 'solid'),
            ...(marks.buy ? [markLine(marks.buy, { en: 'Buy zone', zh: '買入區' }, colors.muted, 'dashed')] : []),
            ...(marks.trim ? [markLine(marks.trim, { en: 'Trim zone', zh: '減碼區' }, colors.muted, 'dashed')] : []),
          ],
        },
      },
      {
        type: 'scatter',
        data: rows.map((row) => ({ value: [row.base, bi(row.label)], itemStyle: { color: slot(colors, row.slot), borderColor: colors.surface, borderWidth: 2 } })),
        symbolSize: 12,
        z: 3,
      },
    ],
  };
}

/** Bear-to-bull ranges by model, each base as a dot, with the price and both zones' prices. */
export function ValueRanges({ rows, price, buy, trim, currency, label }: { rows: readonly ValueRange[]; price: number; buy: number | null; trim: number | null; currency: string; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors, width) => rangeOption(rows, { price, buy, trim }, currency, colors, width)), [rows, price, buy, trim, currency]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          ...rows.map((row) => ({ label: row.label, color: `var(--chart-${(row.slot % 8) + 1})`, shape: 'rect' as const })),
          { label: { en: 'Price', zh: '股價' }, color: 'var(--text)', shape: 'line' as const },
        ]}
      />
      <div ref={ref} className="chart chart-ranges" role="img" aria-label={bi(label)} style={{ height: `${Math.max(140, 70 + rows.length * 46)}px` }} />
    </figure>
  );
}
