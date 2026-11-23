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

import { swiftCharts } from '@/lib/chart-shell';
import { nativeShape, readouts, type NativeShape, type NativeSpec } from '@/lib/native-chart';
import { type Bilingual, zh } from '@/lib/i18n';

import { Bi } from './bi';
import { nativeCharts, showNative } from './native-charts';

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

/** Inside the iOS shell (globals.css `html[data-shell]`) charts are drawn after Swift Charts (lib/chart-shell.ts). */
function inShell(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute('data-shell');
}

/** How long a chart takes to draw or to move to new data: short, so motion only marks a change. */
const MOTION_MS = 300;

/**
 * A text inside a chart (a series or axis name, a tooltip line): in Chinese alone at every width, as
 * every page's text is (CLAUDE.md, Chinese only); the chart's aria-label keeps the English.
 */
export function chartText(text: Bilingual): string {
  return zh(text);
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
    let narrow = element.clientWidth < NARROW;
    // Inside a shell that draws charts, on the main tabs, a chart Swift Charts can draw is handed to
    // it (components/native-charts.ts); ECharts still lays it out, out of sight, for its axis labels.
    // A chart that answers taps of its own (`ready`) stays an ECharts chart.
    const native = !ready && nativeCharts();
    let unNative: (() => void) | undefined;
    const draw = () => {
      const colors = readColors(element);
      const option: Option = { animation: !motion.matches, animationDuration: MOTION_MS, animationDurationUpdate: MOTION_MS, animationEasing: 'cubicOut', ...build(colors, element.clientWidth) };
      chart.setOption(inShell() ? swiftCharts(option, { ink: colors.ink, muted: colors.muted, grid: colors.grid }) : option, true);
      const spec = native ? nativeSpec(chart, option, colors) : null;
      if (spec) {
        element.classList.add('native-drawn');
        unNative = showNative(element, spec);
      } else if (unNative) {
        unNative();
        unNative = undefined;
        element.classList.remove('native-drawn');
      }
    };
    draw();
    ready?.(chart);
    // The appearance chosen on 帳號 (lib/theme.ts) marks <html data-theme>; a change redraws in the new colours.
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const resize = new ResizeObserver(() => {
      chart.resize();
      if (element.clientWidth < NARROW !== narrow) {
        narrow = !narrow;
        draw();
      }
    });
    resize.observe(element);
    stop = () => {
      theme.disconnect();
      resize.disconnect();
      unNative?.();
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

interface AxisView {
  scale: { getExtent(): [number, number] };
  getViewLabels(): Array<{ formattedLabel: string; tickValue: number }>;
}

/** Where an x tick ECharts labels falls on the native chart's x: an index for categories and dates, the value itself on a value axis. */
function tickAt(shape: NativeShape, tick: number): number | null {
  if (shape.x.kind === 'category') return Number.isInteger(tick) && tick >= 0 && tick < shape.x.values.length ? tick : null;
  if (shape.x.kind === 'value') return tick;
  let best: number | null = null;
  let gap = Infinity;
  shape.x.values.forEach((value, index) => {
    const away = Math.abs(Date.parse(String(value)) - tick);
    if (away < gap) {
      gap = away;
      best = index;
    }
  });
  return best;
}

/**
 * The chart as the shell draws it (lib/native-chart.ts), with the axis labels ECharts chose and
 * formatted for it (so the figures read as the page's), and the tooltip's words at each x.
 */
function nativeSpec(chart: Chart, option: Option, colors: Colors): NativeSpec | null {
  const raw = option as Record<string, unknown>;
  const shape = nativeShape(raw, colors.slots);
  if (!shape) return null;
  let y: NativeSpec['y'] = { min: null, max: null, ticks: [] };
  let xTicks: NativeSpec['xTicks'] = [];
  try {
    const model = (chart as unknown as { getModel(): { getComponent(type: string, index: number): { axis?: AxisView } | undefined } }).getModel();
    const yAxis = model.getComponent('yAxis', 0)?.axis;
    const xAxis = model.getComponent('xAxis', 0)?.axis;
    if (yAxis) {
      const [min, max] = yAxis.scale.getExtent();
      y = { min, max, ticks: yAxis.getViewLabels().map((label) => ({ value: Number(label.tickValue), label: label.formattedLabel })) };
    }
    if (xAxis) {
      xTicks = xAxis.getViewLabels().flatMap((label) => {
        const at = tickAt(shape, Number(label.tickValue));
        return at === null ? [] : [{ at, label: label.formattedLabel }];
      });
    }
  } catch {
    // An ECharts without these views: the shell picks its own axis labels.
  }
  return { v: 1, ...shape, xTicks, y, readouts: readouts(raw, shape, (index) => String(shape.x.values[index] ?? '')) };
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
    borderWidth: inShell() ? 0 : 1,
    padding: [8, 10],
    textStyle: { color: colors.ink, fontFamily: colors.font, fontSize: 13 },
    // In the shell the read-out floats as iOS draws one: rounder, lifted by a soft shadow instead of a border.
    extraCssText: inShell() ? 'box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14); border-radius: 12px;' : 'box-shadow: none; border-radius: 8px;',
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
