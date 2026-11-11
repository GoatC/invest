/**
 * What every chart shares (ECharts in the browser): the colours from the --chart-* and --status-*
 * tokens in globals.css, mounting with redraws on a light/dark switch and on resizing, a tooltip
 * built from text nodes, and the plain-HTML legend. The ECharts modules themselves live in
 * components/echarts-core.ts and are fetched apart from the page (see `mount`). Imported only by
 * client components.
 */
import type { BarSeriesOption, CustomSeriesOption, LineSeriesOption, PieSeriesOption, ScatterSeriesOption, TreemapSeriesOption } from 'echarts/charts';
import type { GridComponentOption, MarkAreaComponentOption, MarkLineComponentOption, TooltipComponentOption } from 'echarts/components';
import type { ComposeOption, ECharts } from 'echarts/core';

import { bi, type Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

export type Option = ComposeOption<
  BarSeriesOption | CustomSeriesOption | LineSeriesOption | PieSeriesOption | ScatterSeriesOption | TreemapSeriesOption | GridComponentOption | MarkAreaComponentOption | MarkLineComponentOption | TooltipComponentOption
>;
export type Chart = ECharts;

/** One stripe of a mark area: its two edges. */
export type MarkArea = NonNullable<MarkAreaComponentOption['data']>[number];

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

/** How long a chart takes to draw or to move to new data: short, so motion only marks a change. */
const MOTION_MS = 300;

/** Whether the chart drawn last is phone-sized; every chart on a page shares the screen, so one flag serves them all. */
let narrowNow = false;

/**
 * A text inside a chart (a series or axis name, a tooltip line): by the Chinese-first rule, and in
 * Chinese alone on a phone, as names are everywhere else there (PRD principle 7).
 */
export function chartText(text: Bilingual, label = false): string {
  return narrowNow && text.en !== text.zh ? text.zh : bi(text, label);
}

type Core = typeof import('./echarts-core');

/** The ECharts modules once they have arrived; until then `loading` is the fetch under way. */
let core: Core | undefined;
let loading: Promise<Core> | undefined;

function loadCore(): Promise<Core> {
  loading ??= import('./echarts-core').then((loaded) => {
    core = loaded;
    return loaded;
  });
  return loading;
}

// The fetch starts as soon as a page with a chart loads its script, alongside the page's own work.
if (typeof window !== 'undefined') void loadCore();

/** First draws waiting their turn: one chart per task, so a page of several never holds the screen in one long block. */
const queue: Array<() => void> = [];
let draining = false;

function enqueue(job: () => void): void {
  queue.push(job);
  if (draining) return;
  draining = true;
  const next = () => {
    const run = queue.shift();
    if (!run) {
      draining = false;
      return;
    }
    try {
      run();
    } finally {
      setTimeout(next, 0);
    }
  };
  setTimeout(next, 0);
}

/**
 * Draws a chart into the element and redraws it on a light/dark switch, or when its width crosses
 * NARROW; `ready` may add event handlers. Returns the clean-up for useEffect. The first chart on a
 * page waits for the ECharts modules to arrive and each first draw takes its own turn; once they
 * are here a redraw (a new range, new data) happens at once, so a chart never blinks empty.
 */
export function mount(element: HTMLDivElement | null, build: (colors: Colors, width: number) => Option, ready?: (chart: Chart) => void): (() => void) | undefined {
  if (!element) return undefined;
  let stop: (() => void) | undefined;
  let gone = false;
  const start = ({ init }: Core) => {
    if (gone) return;
    const chart = init(element);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    let narrow = element.clientWidth < NARROW;
    const draw = () => {
      narrowNow = element.clientWidth < NARROW;
      chart.setOption({ animation: !motion.matches, animationDuration: MOTION_MS, animationDurationUpdate: MOTION_MS, animationEasing: 'cubicOut', ...build(readColors(element), element.clientWidth) }, true);
    };
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
    stop = () => {
      dark.removeEventListener('change', draw);
      resize.disconnect();
      chart.dispose();
    };
  };
  if (core) start(core);
  else void loadCore().then((loaded) => enqueue(() => start(loaded)));
  return () => {
    gone = true;
    stop?.();
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
    label.textContent = chartText(row.label);
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
    // On a phone the figures sit on a line along the chart's top edge, clear of the finger that asks for them.
    position: (point, _params, _dom, _rect, size) => {
      const [width] = size.viewSize;
      const [boxWidth] = size.contentSize;
      if (width >= NARROW) return [point[0] + 12, point[1] + 12];
      return [Math.max(2, Math.min(point[0] - boxWidth / 2, width - boxWidth - 2)), 2];
    },
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
