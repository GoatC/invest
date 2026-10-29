'use client';

/**
 * The red-flag indicator's chart (N3): one row per company, one column per indicator, each cell
 * coloured by its level and marked with the same icon as the table under it, so colour is never
 * the only cue. Grey is no data; a dot is an indicator that does not apply.
 */
import { useEffect, useRef } from 'react';

import { bi, type Bilingual } from '@/lib/i18n';
import type { Status } from '@/lib/models/red-flags';
import { LIGHT_ICON, STATUS_TEXT } from '@/lib/red-flag-text';

import { Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

export interface FlagCell {
  status: Status;
  /** The figure or count, as written. */
  value: string;
}

export interface FlagGridRow {
  ticker: string;
  cells: FlagCell[];
}

function fill(colors: Colors, status: Status): string {
  if (status === 'green') return colors.status.good;
  if (status === 'amber') return colors.status.warning;
  if (status === 'red') return colors.status.critical;
  return status === 'none' ? colors.context : colors.surface;
}

function gridOption(rows: readonly FlagGridRow[], columns: readonly Bilingual[], colors: Colors, width: number): Option {
  const narrow = width < 520;
  const cell = Math.max(18, Math.min(40, Math.floor((width - 90) / columns.length) - 4));
  const data = rows.flatMap((row, y) =>
    row.cells.map((one, x) => ({
      value: [x, y],
      status: one.status,
      itemStyle: { color: fill(colors, one.status), borderColor: one.status === 'na' ? colors.grid : colors.surface, borderWidth: 1 },
      label: { show: true, formatter: LIGHT_ICON[one.status].icon, color: one.status === 'amber' ? '#1a1a1a' : one.status === 'none' || one.status === 'na' ? colors.muted : '#ffffff', fontWeight: 700 as const, fontSize: 12 },
    })),
  );
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 8, top: 8, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const [x, y] = ((params as { value?: [number, number] }).value ?? [0, 0]) as [number, number];
        const row = rows[y];
        const one = row?.cells[x];
        const column = columns[x];
        if (!row || !one || !column) return '';
        return tooltip(`${row.ticker} · ${bi(column)}`, [{ value: one.value, label: STATUS_TEXT[one.status] }]);
      },
    },
    xAxis: {
      type: 'category',
      data: columns.map((column) => bi(column)),
      position: 'top',
      axisLabel: { color: colors.muted, rotate: narrow ? 60 : 30, fontSize: 11, interval: 0 },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    yAxis: { type: 'category', data: rows.map((row) => row.ticker), inverse: true, axisLabel: { color: colors.ink }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: 'scatter', symbol: 'roundRect', symbolSize: cell, data }],
  };
}

/** Companies down, indicators across, each cell its level. */
export function FlagGrid({ rows, columns, label }: { rows: readonly FlagGridRow[]; columns: readonly Bilingual[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors, width) => gridOption(rows, columns, colors, width)), [rows, columns]);
  const statuses: Status[] = ['green', 'amber', 'red', 'none', 'na'];
  return (
    <figure className="chart-figure">
      <Legend
        items={statuses.map((status) => ({
          label: STATUS_TEXT[status],
          color: status === 'green' ? 'var(--status-good)' : status === 'amber' ? 'var(--status-warning)' : status === 'red' ? 'var(--status-critical)' : status === 'none' ? 'var(--chart-context)' : 'var(--border)',
          shape: 'rect' as const,
        }))}
      />
      <div ref={ref} className="chart" role="img" aria-label={bi(label)} style={{ height: `${Math.max(150, 110 + rows.length * 44)}px` }} />
    </figure>
  );
}
