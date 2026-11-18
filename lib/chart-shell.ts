/**
 * Charts inside the iOS shell take the grammar of Apple's own charts (Swift Charts; Liquid Glass
 * proposal C04, Hugo 2026-11-15): dashed grid lines and no ticks, axis figures small in the muted
 * colour, the value axis on the trailing side where the chart leaves room for it, lines 2pt wide
 * with round ends and no point markers unless a chart asks for them, a lone line over a wash of its
 * own colour fading down, bars with rounded corners. Only how a chart is drawn changes; its data,
 * scales and colours stay the chart's own. components/echarts.tsx
 * applies it to every chart when the page is inside the shell (`html[data-shell]`).
 */

type Obj = Record<string, unknown>;

/** The theme colours the restyle needs (components/echarts.tsx `Colors`). */
export interface ChartInk {
  ink: string;
  muted: string;
  grid: string;
}

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const part = (owner: Obj, key: string): Obj => (isObj(owner[key]) ? owner[key] : {});

/** One axis or a list of them, through `fn`, keeping the form the chart gave. */
function each(value: unknown, fn: (item: Obj) => Obj): unknown {
  if (Array.isArray(value)) return value.map((item) => (isObj(item) ? fn(item) : item));
  return isObj(value) ? fn(value) : value;
}

/** `fallback` is ECharts' own default type: category for x, value for y. */
function restyleAxis(axis: Obj, ink: ChartInk, fallback: 'category' | 'value'): Obj {
  const type = typeof axis.type === 'string' ? axis.type : fallback;
  const numeric = type === 'value' || type === 'log' || type === 'time';
  const label = part(axis, 'axisLabel');
  const split = part(axis, 'splitLine');
  return {
    ...axis,
    axisTick: { ...part(axis, 'axisTick'), show: false },
    axisLabel: { ...label, color: label.color === undefined || label.color === ink.ink ? ink.muted : label.color, fontSize: label.fontSize ?? 11 },
    ...(numeric ? { axisLine: { ...part(axis, 'axisLine'), show: false } } : {}),
    ...(numeric || split.show === true ? { splitLine: { ...split, lineStyle: { ...part(split, 'lineStyle'), type: [3, 4], color: ink.grid } } } : {}),
  };
}

/** Swift Charts' line: 2pt, thinner left as it is. */
const LINE_WIDTH = 2;

function restyleSeries(series: Obj): Obj {
  if (series.type === 'line') {
    const marked = series.showSymbol !== undefined || series.symbol !== undefined;
    const line = part(series, 'lineStyle');
    const width = typeof line.width === 'number' && line.width < LINE_WIDTH ? line.width : LINE_WIDTH;
    return { ...series, ...(marked ? {} : { showSymbol: false }), lineStyle: { ...line, width, cap: 'round', join: 'round' } };
  }
  if (series.type === 'bar' && series.stack === undefined) {
    const item = part(series, 'itemStyle');
    return item.borderRadius === undefined ? { ...series, itemStyle: { ...item, borderRadius: 4 } } : series;
  }
  return series;
}

/**
 * The one value axis to the trailing side, as Swift Charts draws it, where nothing else needs that
 * side: one grid that fits its labels in (containLabel) with a narrow right margin, one y axis of
 * values the chart has not placed itself. The margins swap with it.
 */
function trailingAxis(option: Obj): void {
  const grids = Array.isArray(option.grid) ? option.grid : [option.grid];
  const axes = Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis];
  if (grids.length !== 1 || axes.length !== 1) return;
  const [grid] = grids;
  const [axis] = axes;
  if (!isObj(grid) || !isObj(axis)) return;
  const type = typeof axis.type === 'string' ? axis.type : 'value';
  // ECharts 6 keeps axis labels inside the chart unless a grid says otherwise (containLabel false, or outer bounds off).
  const fitsLabels = grid.containLabel !== false && grid.outerBoundsMode !== 'none';
  if (type !== 'value' || axis.position !== undefined || axis.show === false || !fitsLabels) return;
  if (typeof grid.left !== 'number' || typeof grid.right !== 'number' || grid.right > 24) return;
  const placed = { ...axis, position: 'right' };
  const swapped = { ...grid, left: grid.right, right: grid.left };
  option.yAxis = Array.isArray(option.yAxis) ? [placed] : placed;
  option.grid = Array.isArray(option.grid) ? [swapped] : swapped;
}

/** `#rgb` or `#rrggbb` at `alpha`, or null for a colour given any other way. */
function fade(color: unknown, alpha: number): string | null {
  if (typeof color !== 'string') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A chart of one line draws it over a wash of its colour that fades down to the axis, as Swift
 * Charts' AreaMark under a LineMark. Not under a chart of several lines, a stacked one, or a line
 * that already fills its area.
 */
function areaUnderLone(option: Obj): void {
  if (!Array.isArray(option.series) && !isObj(option.series)) return;
  const list = (Array.isArray(option.series) ? option.series : [option.series]).filter(isObj);
  const lines = list.filter((series) => series.type === 'line');
  if (lines.length !== 1 || list.length !== 1) return;
  const [line] = lines;
  if (!line || line.areaStyle !== undefined || line.stack !== undefined) return;
  const palette = Array.isArray(option.color) ? option.color[0] : option.color;
  const color = part(line, 'lineStyle').color ?? part(line, 'itemStyle').color ?? palette;
  const top = fade(color, 0.22);
  const bottom = fade(color, 0);
  if (!top || !bottom) return;
  const filled = { ...line, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }] } } };
  option.series = Array.isArray(option.series) ? [filled] : filled;
}

export function swiftCharts<T extends object>(option: T, ink: ChartInk): T {
  const out: Obj = { ...(option as Obj) };
  if (out.xAxis !== undefined) out.xAxis = each(out.xAxis, (axis) => restyleAxis(axis, ink, 'category'));
  if (out.yAxis !== undefined) out.yAxis = each(out.yAxis, (axis) => restyleAxis(axis, ink, 'value'));
  if (out.series !== undefined) out.series = each(out.series, restyleSeries);
  areaUnderLone(out);
  trailingAxis(out);
  return out as T;
}
