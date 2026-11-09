'use client';

/**
 * F6's drift bars and N6's allocation donut. Drift bars wear the status colours, always with the
 * icon and label in the table beside them. Donut slices keep one colour per slice whatever else
 * is held, so switching pools never repaints a slice. Country and sleeve slices use slots that
 * keep every possible pair of neighbours apart (the dataviz validator, every ring of slices that
 * can occur, light and dark); the six product types are more than colour alone can keep apart
 * once some are missing, so their slots are the ones with the fewest failing rings among likely
 * holdings, and each slice also carries its name and share, in the chart and in the table.
 */
import type { BarSeriesOption, PieSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import { useEffect, useRef, useState } from 'react';

import { percent, points, twd } from '@/lib/format';
import { bi, DRIFT_ICON, DRIFT_STATUS, LENS, SLICE, type Bilingual } from '@/lib/i18n';
import { LENSES, type DriftStatus, type Lens, type Slice } from '@/lib/models/allocation';

import { Bi } from './bi';
import { dataIndex, Legend, mount, NARROW, tooltip, tooltipStyle, type Chart, type Colors, type Option } from './echarts';

// ---------------------------------------------------------------------------
// F6: drift from the targets
// ---------------------------------------------------------------------------

export interface DriftRow {
  id: string;
  label: Bilingual;
  target: number;
  weight: number;
  drift: number;
  band: number | null;
  status: DriftStatus;
}

function statusColor(status: DriftStatus, colors: Colors): string {
  if (status === 'ok') return colors.status.good;
  if (status === 'watch') return colors.status.warning;
  return status === 'rebalance' ? colors.status.critical : colors.context;
}

function driftOption(rows: readonly DriftRow[], colors: Colors, width: number): Option {
  const narrow = width < NARROW;
  // Room past the longest bar for its label, more on a phone where the plot is narrow.
  const reach = Math.max(0.01, ...rows.flatMap((row) => [Math.abs(row.drift), row.band ?? 0])) * (narrow ? 1.8 : 1.3);
  const bars: BarSeriesOption = {
    type: 'bar',
    barMaxWidth: 16,
    data: rows.map((row) => ({
      value: row.drift,
      itemStyle: { color: statusColor(row.status, colors), borderRadius: row.drift >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
      label: { position: row.drift >= 0 ? 'right' : 'left' },
    })),
    label: { show: true, color: colors.ink, fontFamily: colors.font, fontSize: 12, formatter: (params) => points(Number(params.value)) },
    emphasis: { disabled: true },
  };
  // F8's band edges: a bar past its ticks is where F8 drafts a rebalance.
  const edges: ScatterSeriesOption = {
    type: 'scatter',
    silent: true,
    symbol: 'rect',
    symbolSize: [2, 18],
    itemStyle: { color: colors.muted },
    data: rows.flatMap((row, index) => (row.band === null ? [] : [[-row.band, index], [row.band, index]])),
  };
  return {
    textStyle: { fontFamily: colors.font },
    grid: { left: 4, right: 12, top: 12, bottom: 4 },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const row = rows[dataIndex(params) ?? -1];
        if (!row) return '';
        return tooltip(bi(row.label), [
          { value: points(row.drift), label: { en: 'Drift', zh: '偏離' }, key: { color: statusColor(row.status, colors), shape: 'rect' } },
          { value: percent(row.weight), label: { en: 'Actual', zh: '實際' } },
          { value: percent(row.target), label: { en: 'Target', zh: '目標' } },
          ...(row.band === null ? [] : [{ value: `±${points(row.band).replace(/^[+−]/, '')}`, label: { en: 'F8 band', zh: 'F8 門檻' } }]),
          { value: DRIFT_ICON[row.status], label: DRIFT_STATUS[row.status] },
        ]);
      },
    },
    xAxis: {
      type: 'value',
      min: -reach,
      max: reach,
      axisLabel: { color: colors.muted, formatter: (value: number) => points(value, 0), hideOverlap: true },
      splitLine: { lineStyle: { color: colors.grid, width: 1, type: 'solid' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((row) => `${row.label.en}\n${row.label.zh}`),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: colors.grid } },
      // Every class named, wrapping on a phone; rows are tall enough for three lines.
      axisLabel: { color: colors.muted, interval: 0, width: narrow ? 120 : 170, overflow: 'break', lineHeight: 14 },
    },
    series: [bars, edges],
  };
}

export function DriftChart({ rows, label }: { rows: readonly DriftRow[]; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors, width) => driftOption(rows, colors, width)), [rows]);
  return (
    <figure className="chart-figure">
      <Legend
        items={[
          { label: { en: `${DRIFT_ICON.ok} ${DRIFT_STATUS.ok.en}`, zh: DRIFT_STATUS.ok.zh }, color: 'var(--status-good)', shape: 'rect' },
          { label: { en: `${DRIFT_ICON.watch} ${DRIFT_STATUS.watch.en}`, zh: DRIFT_STATUS.watch.zh }, color: 'var(--status-warning)', shape: 'rect' },
          { label: { en: `${DRIFT_ICON.rebalance} ${DRIFT_STATUS.rebalance.en}`, zh: DRIFT_STATUS.rebalance.zh }, color: 'var(--status-critical)', shape: 'rect' },
          { label: { en: 'Satellite, left to R2', zh: '衛星，由 R2 管理' }, color: 'var(--chart-context)', shape: 'rect' },
          { label: { en: 'F8 band', zh: 'F8 門檻' }, color: 'var(--muted)', shape: 'line' },
        ]}
      />
      <div ref={ref} className="chart chart-tall" style={{ height: `${Math.max(240, rows.length * 52 + 48)}px` }} role="img" aria-label={bi(label)} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// N6: allocation donut, three lenses
// ---------------------------------------------------------------------------

/** Each slice's colour slot (0-based), fixed whatever else is held; see the note at the top. */
const SLOT: Record<string, number> = {
  equity_etf: 3,
  bond_etf: 0,
  gold: 4,
  cash_mmf: 5,
  stock: 6,
  theme_etf: 2,
  US: 0,
  UK: 3,
  TW: 4,
  unlisted: 5,
  core: 0,
  satellite: 1,
};

const sliceColor = (key: string) => `var(--chart-${(SLOT[key] ?? 0) + 1})`;
const sliceLabel = (key: string): Bilingual => SLICE[key] ?? { en: key, zh: key };

function donutOption(slices: readonly Slice[], colors: Colors, width: number, withTarget: boolean): Option {
  const narrow = width < NARROW;
  const color = (key: string) => colors.slots[SLOT[key] ?? 0] ?? colors.slots[0];
  // On a phone the ring is smaller, so the labels around it stay inside the chart.
  const actual: PieSeriesOption = {
    type: 'pie',
    radius: narrow ? (withTarget ? ['46%', '64%'] : ['40%', '62%']) : withTarget ? ['56%', '78%'] : ['48%', '76%'],
    selectedMode: 'single',
    selectedOffset: 6,
    padAngle: 1,
    minShowLabelAngle: 4,
    avoidLabelOverlap: true,
    stillShowZeroSum: false,
    itemStyle: { borderColor: colors.surface, borderWidth: 2, borderRadius: 4 },
    label: {
      show: true,
      color: colors.ink,
      fontFamily: colors.font,
      fontSize: 12,
      lineHeight: 15,
      // A slice is named as well as coloured; on a phone the share alone, the table naming it.
      formatter: (params) => {
        const slice = slices[params.dataIndex];
        if (!slice) return '';
        return narrow ? percent(slice.weight, 0) : `${sliceLabel(slice.key).en}\n${sliceLabel(slice.key).zh} ${percent(slice.weight, 0)}`;
      },
    },
    labelLine: { length: 8, length2: 8, lineStyle: { color: colors.muted } },
    emphasis: { scale: true, scaleSize: 4 },
    data: slices.map((slice) => ({ name: slice.key, value: slice.valueTwd, itemStyle: { color: color(slice.key) } })),
  };
  // The SAA's split as an inner ring, the same colours paler.
  const target: PieSeriesOption = {
    type: 'pie',
    radius: narrow ? ['30%', '40%'] : ['38%', '50%'],
    padAngle: 1,
    silent: false,
    selectedMode: false,
    label: { show: false },
    itemStyle: { borderColor: colors.surface, borderWidth: 2, borderRadius: 4, opacity: 0.45 },
    emphasis: { disabled: true },
    data: slices.map((slice) => ({ name: slice.key, value: slice.target ?? 0, itemStyle: { color: color(slice.key) } })),
  };
  return {
    textStyle: { fontFamily: colors.font },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const slice = slices[dataIndex(params) ?? -1];
        if (!slice) return '';
        return tooltip(bi(sliceLabel(slice.key)), [
          { value: percent(slice.weight), label: { en: 'Actual', zh: '實際' }, key: { color: color(slice.key), shape: 'rect' } },
          ...(slice.target === null ? [] : [{ value: percent(slice.target), label: { en: 'Target', zh: '目標' } }]),
          { value: twd(slice.valueTwd), label: { en: 'Value', zh: '市值' } },
        ]);
      },
    },
    series: withTarget ? [actual, target] : [actual],
  };
}

export function AllocationDonut({ slices, withTarget, label }: { slices: Record<Lens, Slice[]>; withTarget: boolean; label: Bilingual }) {
  const [lens, setLens] = useState<Lens>('product');
  const [selected, setSelected] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<Chart | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const current = slices[lens];
  const ringTarget = withTarget && current.some((slice) => slice.target !== null);

  useEffect(
    () =>
      mount(
        ref.current,
        (colors, width) => donutOption(current, colors, width, ringTarget),
        (instance) => {
          chart.current = instance;
          instance.on('click', (params) => {
            if (params.seriesIndex !== 0) return;
            const slice = current[params.dataIndex];
            if (!slice) return;
            // The card over the chart takes the tooltip's place.
            instance.dispatchAction({ type: 'hideTip' });
            setSelected((was) => (was === slice.key ? null : slice.key));
          });
        },
      ),
    [current, ringTarget],
  );

  function choose(key: string | null) {
    const next = key === null || selected === key ? null : key;
    setSelected(next);
    const index = current.findIndex((slice) => slice.key === (next ?? selected));
    if (index !== -1) chart.current?.dispatchAction({ type: next === null ? 'unselect' : 'select', seriesIndex: 0, dataIndex: index });
    // A row tapped under the chart brings the card above it into view.
    if (next !== null) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const chosen = current.find((slice) => slice.key === selected);
  return (
    <figure className="chart-figure">
      <div className="segmented" role="tablist" aria-label="Lens 分法">
        {LENSES.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={option === lens}
            className={option === lens ? 'tab selected' : 'tab'}
            onClick={() => {
              setLens(option);
              setSelected(null);
            }}
          >
            <Bi {...LENS[option]} />
          </button>
        ))}
      </div>
      {ringTarget && (
        <p className="muted small">
          <Bi en="Outer ring: actual. Inner ring: the SAA target." zh="外圈為實際比例，內圈為 SAA 目標。" />
        </p>
      )}
      <div ref={box} className="donut-box">
        <div ref={ref} className="chart chart-donut" role="img" aria-label={`${bi(label)} · ${bi(LENS[lens])}`} />
        {chosen && <SliceCard slice={chosen} onClose={() => choose(null)} />}
      </div>
      <div className="table-wrap">
        <table className="slices compact">
          <thead>
            <tr>
              <th>
                <Bi {...LENS[lens]} />
              </th>
              <th className="num">
                <Bi en="Actual" zh="實際" />
              </th>
              {ringTarget && (
                <th className="num">
                  <Bi en="Target" zh="目標" />
                </th>
              )}
              <th className="num">
                <Bi en="Value (TWD)" zh="市值（台幣）" />
              </th>
            </tr>
          </thead>
          <tbody>
            {current.map((slice) => (
              <tr key={slice.key} className={slice.key === selected ? 'selected' : undefined}>
                <td>
                  <button type="button" className="slice-button" aria-pressed={slice.key === selected} onClick={() => choose(slice.key)}>
                    <span className="chart-key rect" style={{ background: sliceColor(slice.key) }} aria-hidden="true" />
                    <Bi {...sliceLabel(slice.key)} />
                  </button>
                </td>
                <td className="num">{percent(slice.weight)}</td>
                {ringTarget && <td className="num">{slice.target === null ? '—' : percent(slice.target)}</td>}
                <td className="num">{twd(slice.valueTwd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!chosen && (
        <p className="muted small">
          <Bi en="Tap a slice or row for its holdings." zh="點選區塊或列 → 持股。" />
        </p>
      )}
    </figure>
  );
}

/**
 * A tapped slice's holdings in a small card floating over the chart (it takes no room on the page):
 * each holding's share of the slice with a bar, and its value. Closed with ✕, Escape or a second tap.
 */
function SliceCard({ slice, onClose }: { slice: Slice; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  const name = sliceLabel(slice.key);
  return (
    <div className="slice-card" role="dialog" aria-label={`${bi(name)} 成分`}>
      <div className="slice-card-head">
        <span className="chart-key rect" style={{ background: sliceColor(slice.key) }} aria-hidden="true" />
        <strong>
          <Bi {...name} />
        </strong>
        <span className="muted small">{`${percent(slice.weight)} · ${twd(slice.valueTwd)}`}</span>
        <button type="button" className="slice-card-close" aria-label="Close 關閉" onClick={onClose}>
          ✕
        </button>
      </div>
      {slice.holdings.length === 0 ? (
        <p className="muted small">
          <Bi en="Nothing held here yet." zh="目前沒有持有。" />
        </p>
      ) : (
        <ul className="slice-holdings">
          {slice.holdings.map((holding) => {
            const share = slice.valueTwd > 0 ? holding.valueTwd / slice.valueTwd : 0;
            return (
              <li key={holding.key}>
                <span className="slice-holding-name">
                  {holding.ticker ? <strong>{holding.ticker}</strong> : <span>{holding.label}</span>}
                  {holding.ticker && <span className="muted small"> {holding.label}</span>}
                </span>
                <strong className="num">{percent(share)}</strong>
                <span className="slice-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, share * 100).toFixed(1)}%`, background: sliceColor(slice.key) }} />
                </span>
                <span className="muted small num">{twd(holding.valueTwd)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
