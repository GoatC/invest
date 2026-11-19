/**
 * Charts the iOS shell draws itself with Apple's Swift Charts (Hugo, 2026-11-15: native, not a
 * look-alike; the main tabs first). The page keeps building each chart as an ECharts option; inside
 * the shell, a line, bar or point chart on one pair of axes is described here in plain data (its x
 * values, each series' values, colour and mark, the lines it draws across, the read-out of each x)
 * and handed to the shell (components/native-charts.ts, ios/Shell/NativeCharts.swift), which draws
 * it over the chart's place in the page. Anything else (a pie, a map, a chart with two value axes)
 * returns null and stays an ECharts chart.
 */

type Obj = Record<string, unknown>;

export type XKind = 'category' | 'date' | 'value';

export interface NativeSeries {
  name: string;
  mark: 'line' | 'bar' | 'point';
  color: string;
  /** One per x value; null where the series has none. */
  values: Array<number | null>;
  /** A colour of its own for a bar or point (the histogram's tail), else null. */
  colors: Array<string | null>;
  stack: string | null;
  dashed: boolean;
}

/** A line across the chart at one x or y (a cutoff, a target). */
export interface NativeRule {
  axis: 'x' | 'y';
  value: number;
  color: string;
  dashed: boolean;
}

export interface NativeShape {
  /** A sparkline: no axes, no read-out. */
  spark: boolean;
  x: { kind: XKind; values: Array<string | number> };
  series: NativeSeries[];
  rules: NativeRule[];
  /** A lone line over a wash of its colour, as Swift Charts' AreaMark under a LineMark. */
  area: boolean;
}

export interface NativeSpec extends NativeShape {
  v: 1;
  /** The lines' width in points: Swift Charts' 2 unless said (the poster's line is 3). */
  lineWidth?: number;
  /** The x values that carry a label, by index, with the label ECharts gives them. */
  xTicks: Array<{ at: number; label: string }>;
  y: { min: number | null; max: number | null; ticks: Array<{ value: number; label: string }> };
  /** What the chart's tooltip says at each x, a line per row. */
  readouts: string[];
}

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const part = (owner: Obj, key: string): Obj => (isObj(owner[key]) ? owner[key] : {});
const one = (value: unknown): Obj | null => {
  if (Array.isArray(value)) return value.length === 1 && isObj(value[0]) ? value[0] : null;
  return isObj(value) ? value : value === undefined ? {} : null;
};
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const color = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** A data item's x (for a time or value axis) and y. */
function point(item: unknown): { x: string | number | null; y: number | null } {
  const raw = isObj(item) ? item.value : item;
  if (Array.isArray(raw)) {
    const x = raw[0];
    return { x: typeof x === 'string' || typeof x === 'number' ? x : null, y: num(raw[1]) };
  }
  return { x: null, y: num(raw) };
}

/** The chart in plain data, or null when it is not one the shell draws. */
export function nativeShape(option: Obj, palette: readonly string[]): NativeShape | null {
  const xAxis = one(option.xAxis);
  const yAxis = one(option.yAxis);
  if (!xAxis || !yAxis || option.polar !== undefined || option.radar !== undefined || option.visualMap !== undefined || option.dataset !== undefined) return null;
  if (Array.isArray(option.grid) && option.grid.length > 1) return null;
  const yType = typeof yAxis.type === 'string' ? yAxis.type : 'value';
  const xType = typeof xAxis.type === 'string' ? xAxis.type : 'category';
  if (yType !== 'value' || !['category', 'time', 'value'].includes(xType)) return null;
  const list = (Array.isArray(option.series) ? option.series : [option.series]).filter(isObj);
  if (list.length === 0 || list.some((series) => !['line', 'bar', 'scatter'].includes(String(series.type)) || series.yAxisIndex || series.xAxisIndex || series.encode)) return null;

  const kind: XKind = xType === 'category' ? 'category' : xType === 'time' ? 'date' : 'value';
  let xs: Array<string | number>;
  if (kind === 'category') {
    if (!Array.isArray(xAxis.data)) return null;
    xs = xAxis.data.map((item) => {
      const label = isObj(item) ? item.value : item;
      return typeof label === 'number' ? String(label) : String(label ?? '');
    });
  } else {
    const seen = new Set<string | number>();
    for (const series of list) for (const item of Array.isArray(series.data) ? series.data : []) {
      const { x } = point(item);
      if (x === null) return null;
      seen.add(kind === 'value' ? Number(x) : String(x));
    }
    xs = [...seen].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
  }
  const at = new Map(xs.map((x, index) => [x, index]));

  const series: NativeSeries[] = list.map((entry, index) => {
    const line = part(entry, 'lineStyle');
    const item = part(entry, 'itemStyle');
    const values: Array<number | null> = xs.map(() => null);
    const colors: Array<string | null> = xs.map(() => null);
    (Array.isArray(entry.data) ? entry.data : []).forEach((datum, position) => {
      const { x, y } = point(datum);
      const slot = kind === 'category' ? position : at.get(kind === 'value' ? Number(x) : String(x));
      if (slot === undefined || slot >= xs.length) return;
      values[slot] = y;
      colors[slot] = isObj(datum) ? color(part(datum, 'itemStyle').color) : null;
    });
    const type = String(entry.type);
    return {
      name: typeof entry.name === 'string' ? entry.name : `${index + 1}`,
      mark: type === 'scatter' ? 'point' : type === 'bar' ? 'bar' : 'line',
      color: color(type === 'line' ? (line.color ?? item.color) : (item.color ?? line.color)) ?? palette[index % Math.max(1, palette.length)] ?? '#4a86c5',
      values,
      colors,
      stack: typeof entry.stack === 'string' ? entry.stack : null,
      dashed: line.type === 'dashed' || line.type === 'dotted' || Array.isArray(line.type),
    };
  });

  const rules: NativeRule[] = [];
  for (const entry of list) {
    const mark = part(entry, 'markLine');
    const ink = color(part(mark, 'lineStyle').color) ?? '#8a93a0';
    const dashed = ['dashed', 'dotted'].includes(String(part(mark, 'lineStyle').type ?? 'dashed'));
    for (const datum of Array.isArray(mark.data) ? mark.data : []) {
      if (!isObj(datum)) continue;
      const x = num(datum.xAxis);
      const y = num(datum.yAxis);
      if (x !== null) rules.push({ axis: 'x', value: kind === 'value' ? x : (at.get(x) ?? x), color: ink, dashed });
      else if (y !== null) rules.push({ axis: 'y', value: y, color: ink, dashed });
    }
  }

  const lines = series.filter((entry) => entry.mark === 'line');
  const filled = list.some((entry) => entry.type === 'line' && entry.areaStyle !== undefined);
  return {
    spark: xAxis.show === false && yAxis.show === false,
    x: { kind, values: xs },
    series,
    rules,
    area: filled || (series.length === 1 && lines.length === 1),
  };
}

/** The text of a tooltip as ECharts would show it: a built box, or HTML with line breaks. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  if (typeof value === 'object' && value !== null && 'children' in value) {
    const box = value as { children: ArrayLike<{ textContent: string | null }>; textContent: string | null };
    const rows = Array.from(box.children).map((child) => (child.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return rows.length > 0 ? rows.join('\n') : (box.textContent ?? '').trim();
  }
  return '';
}

/**
 * What the chart's own tooltip says at each x: its formatter called as ECharts calls it for an axis
 * tooltip (one entry per series at that x), so the read-out is the page's, word for word.
 */
export function readouts(option: Obj, shape: NativeShape, xLabel: (index: number) => string): string[] {
  const formatter = part(option, 'tooltip').formatter;
  return shape.x.values.map((x, index) => {
    const params = shape.series.map((series, seriesIndex) => ({
      componentType: 'series',
      seriesType: series.mark === 'point' ? 'scatter' : series.mark,
      seriesIndex,
      seriesName: series.name,
      dataIndex: index,
      name: String(x),
      value: shape.x.kind === 'category' ? series.values[index] : [x, series.values[index]],
      data: shape.x.kind === 'category' ? series.values[index] : [x, series.values[index]],
      axisValue: x,
      axisValueLabel: xLabel(index),
      color: series.color,
      marker: '',
    }));
    if (typeof formatter === 'function') {
      try {
        const text = textOf(formatter(params));
        if (text) return text;
      } catch {
        // A formatter that needs more than an axis tooltip gives: the plain read-out below.
      }
    }
    return [xLabel(index), ...shape.series.filter((series) => series.values[index] !== null).map((series) => `${series.name} ${series.values[index]}`)].join('\n');
  });
}

/**
 * The dashboard poster's line (app/page.tsx) as the shell draws it: the rise and fall of both pools,
 * in the poster's text colour (`ink`, an `rgb(…)` the page reads off the poster; white was the old accent poster's), 3pt,
 * over a dashed line at zero in the same colour faded, with no axes and no read-out.
 */
/** `rgb(r, g, b)` (or `#rrggbb`) as `rgba(r, g, b, alpha)`; any other form comes back as it was. */
export function faded(ink: string, alpha: number): string {
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(ink.trim());
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  const hex = /^#([0-9a-f]{6})$/i.exec(ink.trim());
  if (hex) {
    const value = parseInt(hex[1]!, 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }
  return ink;
}

export function posterLine(changes: readonly number[], ink = 'rgb(255, 255, 255)', dot?: string): NativeSpec {
  const low = Math.min(0, ...changes);
  const high = Math.max(0, ...changes);
  const pad = (high - low || 1) * 0.12;
  return {
    v: 1,
    spark: true,
    lineWidth: 3,
    x: { kind: 'category', values: changes.map((_, index) => String(index)) },
    series: [
      { name: '', mark: 'line', color: ink, values: [...changes], colors: changes.map(() => null), stack: null, dashed: false },
      // Today's dot at the line's end, in the colour of the 7-day move (Ink design), as the page draws it.
      ...(dot ? [{ name: '', mark: 'point' as const, color: dot, values: changes.map((value, index) => (index === changes.length - 1 ? value : null)), colors: changes.map(() => null), stack: null, dashed: false }] : []),
    ],
    rules: [{ axis: 'y', value: 0, color: faded(ink, 0.45), dashed: true }],
    area: false,
    xTicks: [],
    y: { min: low - pad, max: high + pad, ticks: [] },
    readouts: [],
  };
}
