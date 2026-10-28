/**
 * What every chart shares (ECharts in the browser): the modules it draws with, the colours from
 * the --chart-* and --status-* tokens in globals.css, mounting with redraws on a light/dark switch
 * and on resizing, a tooltip built from text nodes, and the plain-HTML legend. Imported only by
 * client components.
 */
import {
  BarChart,
  CustomChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreemapChart,
  type BarSeriesOption,
  type CustomSeriesOption,
  type LineSeriesOption,
  type PieSeriesOption,
  type ScatterSeriesOption,
  type TreemapSeriesOption,
} from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent, type GridComponentOption, type MarkLineComponentOption, type TooltipComponentOption } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

import { bi, type Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

echarts.use([BarChart, CustomChart, LineChart, PieChart, ScatterChart, TreemapChart, GridComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

export type Option = echarts.ComposeOption<
  BarSeriesOption | CustomSeriesOption | LineSeriesOption | PieSeriesOption | ScatterSeriesOption | TreemapSeriesOption | GridComponentOption | MarkLineComponentOption | TooltipComponentOption
>;
export type Chart = echarts.ECharts;

export interface Colors {
  /** The eight categorical slots, --chart-1 to --chart-8. */
  slots: [string, string, string, string, string, string, string, string];
  /** The de-emphasis gray. */
  context: string;
  status: { good: string; warning: string; critical: string };
  ink: string;
  muted: string;
  grid: string;
  surface: string;
  font: string;
}

function readColors(element: HTMLElement): Colors {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    slots: [token('--chart-1'), token('--chart-2'), token('--chart-3'), token('--chart-4'), token('--chart-5'), token('--chart-6'), token('--chart-7'), token('--chart-8')],
    context: token('--chart-context'),
    status: { good: token('--status-good'), warning: token('--status-warning'), critical: token('--status-critical') },
    ink: token('--text'),
    muted: token('--muted'),
    grid: token('--border'),
    surface: token('--surface'),
    font: style.fontFamily,
  };
}

/** Below this width a chart lays out for a phone. */
export const NARROW = 520;

/**
 * Draws a chart into the element and redraws it on a light/dark switch, or when its width crosses
 * NARROW; `ready` may add event handlers. Returns the clean-up for useEffect.
 */
export function mount(element: HTMLDivElement | null, build: (colors: Colors, width: number) => Option, ready?: (chart: Chart) => void): (() => void) | undefined {
  if (!element) return undefined;
  const chart = echarts.init(element, null, { renderer: 'svg' });
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  let narrow = element.clientWidth < NARROW;
  const draw = () => chart.setOption({ animation: !motion.matches, ...build(readColors(element), element.clientWidth) }, true);
  draw();
  ready?.(chart);
  dark.addEventListener('change', draw);
  const resize = new ResizeObserver(() => {
    chart.resize();
    if (element.clientWidth < NARROW !== narrow) {
      narrow = !narrow;
      draw();
    }
  });
  resize.observe(element);
  return () => {
    dark.removeEventListener('change', draw);
    resize.disconnect();
    chart.dispose();
  };
}

/** Axis ticks: whole percentages where the range allows, e.g. "−5%", "12.5%". */
export function axisPercent(value: number): string {
  const text = `${Number((Math.abs(value) * 100).toFixed(2))}%`;
  return value < 0 ? `−${text}` : text;
}

export type Key = { color: string; shape: 'line' | 'rect' | 'dot' };

/** The tooltip, built from text nodes: the value first, then what it is, keyed by a mark in the series colour. */
export function tooltip(title: string, rows: ReadonlyArray<{ value: string; label: Bilingual; key?: Key }>): HTMLElement {
  const box = document.createElement('div');
  box.className = 'chart-tip';
  const head = document.createElement('div');
  head.className = 'chart-tip-title';
  head.textContent = title;
  box.append(head);
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'chart-tip-row';
    const key = document.createElement('span');
    key.className = `chart-key ${row.key?.shape ?? 'none'}`;
    if (row.key) key.style.background = row.key.color;
    const value = document.createElement('strong');
    value.textContent = row.value;
    const label = document.createElement('span');
    label.textContent = bi(row.label);
    line.append(key, value, label);
    box.append(line);
  }
  return box;
}

/** The tooltip box; `trigger` axis follows the pointer along the x axis, item follows a mark. */
export function tooltipStyle(colors: Colors, trigger: 'axis-line' | 'axis-shadow' | 'item'): TooltipComponentOption {
  return {
    trigger: trigger === 'item' ? 'item' : 'axis',
    confine: true,
    ...(trigger === 'item'
      ? {}
      : {
          axisPointer:
            trigger === 'axis-line'
              ? { type: 'line' as const, lineStyle: { color: colors.muted, width: 1, type: 'solid' as const } }
              : { type: 'shadow' as const, shadowStyle: { color: colors.grid, opacity: 0.35 } },
        }),
    backgroundColor: colors.surface,
    borderColor: colors.grid,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: colors.ink, fontFamily: colors.font, fontSize: 13 },
    extraCssText: 'box-shadow: none; border-radius: 8px;',
  };
}

/** The data index a tooltip or click is about. */
export function dataIndex(params: unknown): number | undefined {
  const first = Array.isArray(params) ? params[0] : params;
  return typeof first === 'object' && first !== null && 'dataIndex' in first && typeof first.dataIndex === 'number' ? first.dataIndex : undefined;
}

export function Legend({ items }: { items: ReadonlyArray<{ label: Bilingual; color: string; shape: Key['shape'] }> }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.label.en}>
          <span className={`chart-key ${item.shape}`} style={{ background: item.color }} aria-hidden="true" />
          <Bi {...item.label} />
        </li>
      ))}
    </ul>
  );
}
