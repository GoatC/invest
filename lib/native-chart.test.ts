import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { faded, nativeShape, posterLine, readouts } from './native-chart';

const PALETTE = ['#4a86c5', '#d9693a', '#1f9a74'];

describe('nativeShape: the charts the shell draws with Swift Charts', () => {
  it('reads a line chart on a time axis (Performance’s cumulative return): dates in order, a value per date per series', () => {
    const shape = nativeShape(
      {
        xAxis: { type: 'time' },
        yAxis: { type: 'value' },
        series: [
          { name: 'SAA', type: 'line', data: [['2026-10-02', 0.01], ['2026-10-01', 0]], lineStyle: { color: '#8a93a0' } },
          { name: '組合', type: 'line', data: [['2026-10-01', 0], ['2026-10-02', 0.02]], lineStyle: { color: '#4a86c5', type: 'dashed' } },
        ],
      },
      PALETTE,
    );
    assert.ok(shape);
    assert.deepEqual(shape.x, { kind: 'date', values: ['2026-10-01', '2026-10-02'] });
    assert.deepEqual(shape.series.map((series) => [series.name, series.mark, series.color, series.values, series.dashed]), [
      ['SAA', 'line', '#8a93a0', [0, 0.01], false],
      ['組合', 'line', '#4a86c5', [0, 0.02], true],
    ]);
    assert.equal(shape.area, false, 'two lines: no wash');
    assert.equal(shape.spark, false);
  });

  it('reads stacked bars with a point series on categories (the monthly split), a bar’s own colour kept', () => {
    const shape = nativeShape(
      {
        xAxis: { type: 'category', data: ['2026-09', '2026-10'] },
        yAxis: { type: 'value' },
        series: [
          { name: '當地幣別', type: 'bar', stack: 'split', itemStyle: { color: '#4a86c5' }, data: [{ value: 0.01 }, { value: -0.02, itemStyle: { color: '#c8453d' } }] },
          { name: '匯率', type: 'bar', stack: 'split', data: [0.002, null] },
          { name: '台幣報酬', type: 'scatter', data: [0.012, -0.02] },
        ],
      },
      PALETTE,
    );
    assert.ok(shape);
    assert.deepEqual(shape.x.values, ['2026-09', '2026-10']);
    assert.deepEqual(shape.series.map((series) => [series.mark, series.stack, series.color, series.values]), [
      ['bar', 'split', '#4a86c5', [0.01, -0.02]],
      ['bar', 'split', '#d9693a', [0.002, null]],
      ['point', null, '#1f9a74', [0.012, -0.02]],
    ]);
    assert.deepEqual(shape.series[0]!.colors, [null, '#c8453d']);
  });

  it('reads a histogram on a value axis with its cutoff as a line across (the VaR card)', () => {
    const shape = nativeShape(
      {
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series: [{ name: '週數', type: 'bar', data: [[-0.02, 3], [-0.04, 1], [0, 9]], markLine: { lineStyle: { color: '#1f2a3a' }, data: [{ xAxis: -0.03 }] } }],
      },
      PALETTE,
    );
    assert.ok(shape);
    assert.deepEqual(shape.x, { kind: 'value', values: [-0.04, -0.02, 0] });
    assert.deepEqual(shape.series[0]!.values, [1, 3, 9]);
    assert.deepEqual(shape.rules, [{ axis: 'x', value: -0.03, color: '#1f2a3a', dashed: true }]);
  });

  it('marks a lone line for the wash under it, and a chart with both axes hidden as a sparkline', () => {
    const shape = nativeShape({ xAxis: { type: 'time', show: false }, yAxis: { type: 'value', show: false }, series: { type: 'line', data: [['2026-10-01', 1]] } }, PALETTE);
    assert.equal(shape?.area, true);
    assert.equal(shape?.spark, true);
    assert.equal(shape?.series[0]?.color, '#4a86c5', 'the palette’s first colour');
  });

  it('leaves to ECharts what Swift Charts is not asked to draw: a pie, a treemap, two value axes, a value-coloured map', () => {
    assert.equal(nativeShape({ series: [{ type: 'pie', data: [1] }] }, PALETTE), null);
    assert.equal(nativeShape({ xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' }, series: [{ type: 'treemap', data: [] }] }, PALETTE), null);
    assert.equal(nativeShape({ xAxis: { type: 'category', data: ['a'] }, yAxis: [{ type: 'value' }, { type: 'value' }], series: [{ type: 'line', data: [1] }] }, PALETTE), null);
    assert.equal(nativeShape({ visualMap: {}, xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [1] }] }, PALETTE), null);
  });
});

describe('readouts: the tooltip’s own words at each x', () => {
  const option = {
    xAxis: { type: 'category', data: ['2026-09', '2026-10'] },
    yAxis: { type: 'value' },
    tooltip: {
      formatter: (params: Array<{ dataIndex: number; seriesName: string; value: number }>) => `${['九月', '十月'][params[0]!.dataIndex]}<br>${params.map((p) => `${p.seriesName} ${p.value}`).join('<br>')}`,
    },
    series: [{ name: '報酬', type: 'line', data: [1, 2] }],
  };

  it('calls the formatter as for an axis tooltip and keeps its lines', () => {
    const shape = nativeShape(option, PALETTE)!;
    assert.deepEqual(readouts(option, shape, (index) => String(shape.x.values[index])), ['九月\n報酬 1', '十月\n報酬 2']);
  });

  it('reads a box the page built (a title, then a row per series)', () => {
    const box = { textContent: '', children: [{ textContent: ' 2026-10 ' }, { textContent: '+1.2%   組合' }] };
    const built = { ...option, tooltip: { formatter: () => box } };
    const shape = nativeShape(built, PALETTE)!;
    assert.deepEqual(readouts(built, shape, () => ''), ['2026-10\n+1.2% 組合', '2026-10\n+1.2% 組合']);
  });

  it('falls back to the x and each value when there is no formatter, or it throws', () => {
    const bare = { ...option, tooltip: { formatter: () => { throw new Error('no'); } } };
    const shape = nativeShape(bare, PALETTE)!;
    assert.deepEqual(readouts(bare, shape, (index) => `x${index}`), ['x0\n報酬 1', 'x1\n報酬 2']);
  });
});

describe('posterLine', () => {
  it('draws the poster’s line white and 3pt over a dashed zero, padded so the line clears the edges, with no axes', () => {
    const spec = posterLine([0, 0.02, -0.01]);
    assert.equal(spec.spark, true);
    assert.equal(spec.lineWidth, 3);
    assert.deepEqual(spec.series[0]?.values, [0, 0.02, -0.01]);
    assert.deepEqual(spec.rules, [{ axis: 'y', value: 0, color: 'rgba(255, 255, 255, 0.45)', dashed: true }]);
    assert.ok(Math.abs((spec.y.min ?? 0) - -0.0136) < 1e-12 && Math.abs((spec.y.max ?? 0) - 0.0236) < 1e-12);
  });

  it('takes the poster’s text colour for the line and, faded, for the zero rule (the Ink poster is light)', () => {
    const spec = posterLine([0, 0.02], 'rgb(20, 26, 23)');
    assert.equal(spec.series[0]?.color, 'rgb(20, 26, 23)');
    assert.deepEqual(spec.rules, [{ axis: 'y', value: 0, color: 'rgba(20, 26, 23, 0.45)', dashed: true }]);
    assert.equal(faded('#ecf0ee', 0.45), 'rgba(236, 240, 238, 0.45)');
  });

  it('ends in today’s dot, in the colour it is given, on the last point only', () => {
    const spec = posterLine([0, 0.02, 0.01], 'rgb(20, 26, 23)', 'rgb(194, 58, 67)');
    assert.equal(spec.series.length, 2);
    assert.deepEqual(spec.series[1], { name: '', mark: 'point', color: 'rgb(194, 58, 67)', values: [null, null, 0.01], colors: [null, null, null], stack: null, dashed: false });
    assert.equal(posterLine([0, 0.02], 'rgb(20, 26, 23)').series.length, 1);
  });

  it('draws itself in only when the opening sequence asks', () => {
    assert.equal(posterLine([0, 0.02], 'rgb(20, 26, 23)', undefined, true).reveal, true);
    assert.equal('reveal' in posterLine([0, 0.02], 'rgb(20, 26, 23)'), false);
  });
});
