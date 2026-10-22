'use client';

/**
 * The F15 chart: what each choice would cost over the plan, one horizontal bar per fund or broker,
 * cheapest at the top. The one in use (held, or the broker chosen) is in the accent, the others in
 * the de-emphasis gray, and every value is also in the table under the chart.
 */
import { useEffect, useRef } from 'react';

import { twd } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';

import { dataIndex, Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

export interface CostBar {
  label: string;
  cost: number;
  /** Held, or the broker the estimates use. */
  current: boolean;
  /** The line under the cost in the tooltip, e.g. "0.60% a year". */
  note: Bilingual;
}

const COST: Bilingual = { en: 'Cost over the plan', zh: '計畫期間的成本' };

function option(bars: readonly CostBar[], colors: Colors, width: number): Option {
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: width < 520 ? 64 : 96, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'axis-shadow'),
      formatter: (params) => {
        const bar = bars[dataIndex(params) ?? -1];
        if (!bar) return '';
        return tooltip(bar.label, [
          { value: twd(bar.cost), label: COST, key: { color: bar.current ? colors.slots[0] : colors.context, shape: 'rect' } },
          { value: '', label: bar.note },
        ]);
      },
    },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      inverse: true,
      data: bars.map((bar) => bar.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.ink },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 18,
        emphasis: { disabled: true },
        label: { show: true, position: 'right', color: colors.muted, formatter: (params: { dataIndex: number }) => twd(bars[params.dataIndex]?.cost ?? 0) },
        data: bars.map((bar) => ({ value: Math.max(0, bar.cost), itemStyle: { color: bar.current ? colors.slots[0] : colors.context, borderRadius: [0, 4, 4, 0] } })),
      },
    ],
  };
}

export function CostBars({ bars, label, current }: { bars: readonly CostBar[]; label: Bilingual; current: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors, width) => option(bars, colors, width)), [bars]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: current, color: 'var(--chart-1)', shape: 'rect' },
          { label: { en: 'Other choices', zh: '其他選擇' }, color: 'var(--chart-context)', shape: 'rect' },
        ]}
      />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} style={{ height: `${Math.max(120, bars.length * 30 + 16)}px` }} />
    </figure>
  );
}
