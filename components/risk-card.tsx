import type { ReactNode } from 'react';

import { twd } from '@/lib/format';
import type { Bilingual } from '@/lib/i18n';
import type { RiskReport, VarPoint } from '@/lib/models/risk';
import { riskHorizons } from '@/lib/risk-text';

import { Bi } from './bi';
import { Info } from './info';
import { VarFigure } from './risk-charts';

/** Why there is no VaR to show, in the order they are checked. */
function blocker(report: RiskReport): Bilingual | undefined {
  if (report.measured.valueTwd <= 0) return { en: 'Nothing priced is held yet, so nothing is at risk.', zh: '目前沒有已計價的持有，因此沒有風險值。' };
  if (report.missing.length > 0) {
    const names = report.missing.join(', ');
    return {
      en: `The VaR needs ${report.window.weeks} weeks of closes for each proxy, and the closes of ${names} do not reach back that far yet. The nightly job loads them; see Data status.`,
      zh: `風險值需要每檔代理 ETF ${report.window.weeks} 週的收盤價，${report.missing.join('、')} 的資料還不夠久。每夜排程會載入，請見資料狀態。`,
    };
  }
  const orphans = report.measured.unmeasured.filter((holding) => holding.proxy === null);
  if (orphans.length > 0) {
    const names = orphans.map((holding) => holding.ticker ?? holding.label);
    return {
      en: `No proxy measures ${names.join(', ')}: its asset class has no benchmark ETF. Set one on Allocation → Edit targets.`,
      zh: `${names.join('、')} 沒有代理 ETF：所屬資產類別未設定基準 ETF，請到「資產配置 → 修改目標權重」設定。`,
    };
  }
  return undefined;
}

/**
 * The N4 card: today's VaR of the whole portfolio with its toggle and 52-week line, or why there
 * is none yet; `children` (the folded distribution and make-up) go at its foot.
 */
export function RiskCard({ report, line, children }: { report: RiskReport | undefined; line: readonly VarPoint[]; children?: ReactNode }) {
  const why = report ? blocker(report) : undefined;
  return (
    <section className="card form" id="value-at-risk">
      <h2>
        <Bi en="Value at Risk, whole portfolio" zh="風險值（整個投資組合）" />
      </h2>
      {!report ? (
        <p className="banner warn">
          <Bi
            en="The var setting is missing from the config table or not valid: run npx supabase db push, or check its numbers in the Table Editor."
            zh="config 表中的 var 設定不存在或數值無效：請執行 npx supabase db push，或在 Table Editor 檢查其數值。"
          />
        </p>
      ) : why ? (
        <p className="banner info">
          <Bi {...why} />
        </p>
      ) : (
        <VarFigure horizons={riskHorizons(report.settings)} weekVar={report.weekVar ?? 0} valueTwd={report.measured.valueTwd} line={line} />
      )}
      {report && report.measured.valueTwd > 0 && (
        <Info>
          <Bi
            en={`Weekly returns from ${report.window.from} to ${report.window.to}; the portfolio, both pools, at its newest closes: ${twd(report.measured.valueTwd)}.`}
            zh={`週報酬期間 ${report.window.from} 至 ${report.window.to}；投資組合（兩個資金池）以最新收盤價計：${twd(report.measured.valueTwd)}。`}
          />
          {report.unpriced.length > 0 && (
            <>
              {' '}
              <Bi
                en={`Left out until priced: ${report.unpriced.map((holding) => holding.ticker ?? holding.label).join(', ')}.`}
                zh={`尚未計價，暫不列入：${report.unpriced.map((holding) => holding.ticker ?? holding.label).join('、')}。`}
              />
            </>
          )}
        </Info>
      )}
      {children}
    </section>
  );
}
