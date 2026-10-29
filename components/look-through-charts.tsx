'use client';

/**
 * The combined look-through's chart (F14): each company the portfolio holds, through its funds and
 * directly, as a box sized by its TWD exposure and coloured by its sector; the largest sectors take
 * the categorical colours, the rest and the unclassified share the grey. The table under it on the
 * page holds the same figures.
 */
import { useEffect, useRef } from 'react';

import { percent, twd } from '@/lib/format';
import { bi, type Bilingual } from '@/lib/i18n';

import { Legend, mount, tooltip, tooltipStyle, type Colors, type Option } from './echarts';

export interface TreemapBox {
  name: string;
  valueTwd: number;
  share: number;
  /** The sector's colour slot, or null for the grey. */
  slot: number | null;
  sector: Bilingual;
}

function boxColor(colors: Colors, slot: number | null): string {
  return slot === null ? colors.context : (colors.slots[slot % colors.slots.length] as string);
}

function treemapOption(boxes: readonly TreemapBox[], colors: Colors, width: number): Option {
  return {
    textStyle: { fontFamily: colors.font },
    tooltip: {
      ...tooltipStyle(colors, 'item'),
      formatter: (params) => {
        const box = boxes.find((one) => one.name === (params as { name?: string }).name);
        if (!box) return '';
        return tooltip(box.name, [
          { value: twd(box.valueTwd), label: { en: 'Exposure', zh: '曝險' }, key: { color: boxColor(colors, box.slot), shape: 'rect' } },
          { value: percent(box.share), label: { en: 'of the portfolio', zh: '占投資組合' } },
          { value: bi(box.sector), label: { en: 'Sector', zh: '產業' } },
        ]);
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
        itemStyle: { borderColor: colors.surface, borderWidth: 2, gapWidth: 2 },
        label: { show: true, formatter: (params) => `${(params as { name?: string }).name ?? ''}\n${percent(boxes.find((one) => one.name === (params as { name?: string }).name)?.share ?? 0)}`, color: '#ffffff', textBorderColor: 'rgba(0, 0, 0, 0.55)', textBorderWidth: 2, fontSize: width < 520 ? 10 : 12, overflow: 'truncate' },
        data: boxes.map((box) => ({ name: box.name, value: box.valueTwd, itemStyle: { color: boxColor(colors, box.slot) } })),
      },
    ],
  };
}

/** Companies sized by exposure, coloured by sector. */
export function ExposureTreemap({ boxes, legend, label }: { boxes: readonly TreemapBox[]; legend: ReadonlyArray<{ label: Bilingual; slot: number | null }>; label: Bilingual }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mount(ref.current, (colors, width) => treemapOption(boxes, colors, width)), [boxes]);
  return (
    <figure className="chart-figure">
      <Legend items={legend.map((item) => ({ label: item.label, color: item.slot === null ? 'var(--chart-context)' : `var(--chart-${(item.slot % 8) + 1})`, shape: 'rect' as const }))} />
      <div ref={ref} className="chart chart-treemap" role="img" aria-label={bi(label)} style={{ height: '380px' }} />
    </figure>
  );
}
