/**
 * The ECharts modules every chart draws with, in a file of their own: components/echarts.tsx
 * fetches it apart from the page's script, so a page's buttons and tabs answer before the charting
 * library has arrived. Imported only by components/echarts.tsx, in the browser.
 */
import { BarChart, CustomChart, LineChart, PieChart, ScatterChart, TreemapChart } from 'echarts/charts';
import { GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, CustomChart, LineChart, PieChart, ScatterChart, TreemapChart, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

/** A chart in the element, drawn as SVG. */
export function init(element: HTMLDivElement): echarts.ECharts {
  return echarts.init(element, null, { renderer: 'svg' });
}
