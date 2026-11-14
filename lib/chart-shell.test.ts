import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { swiftCharts } from './chart-shell';

const INK = { ink: '#1f2a3a', muted: '#55647a', grid: '#dbe4ef' };

describe('charts in the iOS shell, after Swift Charts (proposal C04)', () => {
  it('draws the value axis with dashed grid lines, no ticks and no axis line, its figures small and muted', () => {
    const out = swiftCharts({ yAxis: { type: 'value', axisLabel: { formatter: 'x', color: INK.ink } } }, INK) as { yAxis: Record<string, any> };
    assert.equal(out.yAxis.axisTick.show, false);
    assert.equal(out.yAxis.axisLine.show, false);
    assert.deepEqual(out.yAxis.splitLine.lineStyle.type, [3, 4]);
    assert.equal(out.yAxis.splitLine.lineStyle.color, INK.grid);
    assert.equal(out.yAxis.axisLabel.color, INK.muted);
    assert.equal(out.yAxis.axisLabel.fontSize, 11);
    assert.equal(out.yAxis.axisLabel.formatter, 'x', 'the chart’s own formatter stays');
  });

  it('keeps a category axis’s line and a label colour or size the chart chose', () => {
    const out = swiftCharts({ xAxis: { data: ['a'], axisLabel: { color: '#c8453d', fontSize: 13 } } }, INK) as { xAxis: Record<string, any> };
    assert.equal(out.xAxis.axisLine, undefined);
    assert.equal(out.xAxis.splitLine, undefined);
    assert.equal(out.xAxis.axisLabel.color, '#c8453d');
    assert.equal(out.xAxis.axisLabel.fontSize, 13);
  });

  it('moves a lone value axis to the trailing side when its grid fits labels in and leaves the right free', () => {
    const out = swiftCharts({ grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true }, yAxis: { type: 'value' } }, INK) as Record<string, any>;
    assert.equal(out.yAxis.position, 'right');
    assert.equal(out.grid.left, 12);
    assert.equal(out.grid.right, 4);
  });

  it('leaves the axis where it is when the grid does not fit labels, the right holds labels, or there are two axes', () => {
    const bare = swiftCharts({ grid: { left: 4, right: 12, top: 12, bottom: 4 }, yAxis: { type: 'value' } }, INK) as Record<string, any>;
    assert.equal(bare.yAxis.position, undefined);
    const wide = swiftCharts({ grid: { left: 4, right: 96, containLabel: true }, yAxis: { type: 'value' } }, INK) as Record<string, any>;
    assert.equal(wide.yAxis.position, undefined);
    const two = swiftCharts({ grid: { left: 4, right: 12, containLabel: true }, yAxis: [{ type: 'value' }, { type: 'value' }] }, INK) as Record<string, any>;
    assert.equal(two.yAxis[0].position, undefined);
  });

  it('gives lines round ends and drops point markers unless the chart asked for them', () => {
    const out = swiftCharts({ series: [{ type: 'line', data: [1, 2] }, { type: 'line', symbol: 'triangle', data: [3] }] }, INK) as { series: Array<Record<string, any>> };
    assert.equal(out.series[0]!.showSymbol, false);
    assert.equal(out.series[0]!.lineStyle.cap, 'round');
    assert.equal(out.series[1]!.showSymbol, undefined);
    assert.deepEqual(out.series[0]!.data, [1, 2], 'the data stays');
  });

  it('rounds the corners of a bar, but not of a stacked one or one with its own corners', () => {
    const out = swiftCharts({ series: [{ type: 'bar' }, { type: 'bar', stack: 'a' }, { type: 'bar', itemStyle: { borderRadius: 0 } }] }, INK) as { series: Array<Record<string, any>> };
    assert.equal(out.series[0]!.itemStyle.borderRadius, 4);
    assert.equal(out.series[1]!.itemStyle, undefined);
    assert.equal(out.series[2]!.itemStyle.borderRadius, 0);
  });
});
