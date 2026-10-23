/**
 * The words of the rules engine (PRD Section 4): each proposal's title and why it fired, with its
 * figures (design principle 4: explain every number), each draft order as a line, and what the
 * engine found for each rule. Bilingual; the pages and the trade form share them.
 */
import { money, percent, points, quantity, twd } from './format';
import type { Bilingual } from './i18n';
import type { Check, ClosedReason, DraftOrder, ProposalDetail, ProposalStatus } from './models/engine';

/** A rule as the text needs it. */
export interface RuleLike {
  id: string;
  condition: string;
}

const TITLES: Record<string, Bilingual> = {
  single_stock_weight_above: { en: 'Single-stock trim', zh: '單一個股減碼' },
  satellite_weight_above: { en: 'Satellite trim', zh: '衛星部位減碼' },
  class_drift_exceeds: { en: 'Drift rebalance', zh: '偏離再平衡' },
  day_after_dca: { en: 'Monthly contribution', zh: '每月投入' },
  first_weekend_of_month: { en: 'Annual review', zh: '年度檢查' },
  us_situs_value_above: { en: 'US estate tax', zh: '美國遺產稅' },
  tranche_due: { en: 'Windfall tranche', zh: '大額資金分批' },
  index_drawdown_tier: { en: 'Windfall acceleration', zh: '大額資金加速投入' },
};

/** "R1 · Single-stock trim". */
export function proposalTitle(rule: RuleLike): Bilingual {
  const title = TITLES[rule.condition] ?? { en: rule.condition, zh: rule.condition };
  return { en: `${rule.id} · ${title.en}`, zh: `${rule.id} · ${title.zh}` };
}

/** What a proposal fired on, readable and able to wrap: "2330, NVDA". */
export function stateText(state: string): string {
  return state.split(',').join(', ');
}

export const STATUS: Record<ProposalStatus, Bilingual> = {
  open: { en: 'Open', zh: '待處理' },
  approved: { en: 'Approved: to trade', zh: '已核准：待下單' },
  dismissed: { en: 'Dismissed', zh: '已略過' },
  filled: { en: 'Filled', zh: '已成交' },
  expired: { en: 'Closed', zh: '已關閉' },
};

export const CLOSED: Record<ClosedReason, Bilingual> = {
  timed_out: { en: 'not acted on in time; the rule was checked again', zh: '未在期限內處理；規則已重新檢查' },
  cleared: { en: 'the rule no longer fires', zh: '規則已不再觸發' },
  superseded: { en: 'replaced by a newer proposal', zh: '已由較新的提案取代' },
};

type Names = ReadonlyMap<string, Bilingual>;

function className(names: Names, id: string): Bilingual {
  return names.get(id) ?? { en: id, zh: id };
}

/** Cash, leftovers, value no order can sell, and classes with no fund: the lines every proposal may end with. */
function cashLines(detail: ProposalDetail, names: Names): Bilingual[] {
  const lines: Bilingual[] = [];
  if (detail.cashTwd > 0) {
    lines.push(
      detail.leftTwd >= 1
        ? {
            en: `${twd(detail.cashTwd)} to invest; ${twd(detail.leftTwd)} stays as cash, as share counts are rounded.`,
            zh: `可投入 ${twd(detail.cashTwd)}；因為股數需取整數或到設定的小數位數，${twd(detail.leftTwd)} 留作現金。`,
          }
        : { en: `${twd(detail.cashTwd)} to invest.`, zh: `可投入 ${twd(detail.cashTwd)}。` },
    );
  }
  if (detail.untradedTwd && detail.untradedTwd >= 1) {
    lines.push({
      en: `${twd(detail.untradedTwd)} of it is held as gold in grams, which no order can sell: adjust it by hand, or leave it.`,
      zh: `其中 ${twd(detail.untradedTwd)} 是以克計的實體黃金，無法以下單賣出：請自行調整，或保留不動。`,
    });
  }
  if (detail.noFund && detail.noFund.length > 0) {
    const listed = detail.noFund.map((id) => className(names, id));
    lines.push({
      en: `No fund to buy for ${listed.map((name) => name.en).join(', ')}: hold one, or set the class's benchmark ETF on the targets page.`,
      zh: `${listed.map((name) => name.zh).join('、')}沒有可買進的基金：請先持有一檔，或在目標權重頁設定該類別的基準 ETF。`,
    });
  }
  return lines;
}

/** Windfall orders: what strategic cash's share leaves in the balance, which is strategic cash already. */
function keptLine(detail: ProposalDetail): Bilingual[] {
  if (!detail.keptTwd || detail.keptTwd < 1) return [];
  return [
    {
      en: `Strategic cash's share, ${twd(detail.keptTwd)}, stays in the balance the windfall waits in, which is strategic cash already.`,
      zh: `戰略現金的部分 ${twd(detail.keptTwd)} 留在大額資金等待中的帳戶，它本身就是戰略現金。`,
    },
  ];
}

function classLine(row: { id: string; weight: number; target: number; band: number | null }, names: Names): Bilingual {
  const name = className(names, row.id);
  const drift = points(row.weight - row.target);
  const band = row.band === null ? null : points(row.band).replace(/^\+/, '±');
  return {
    en: `${name.en}: ${percent(row.weight)} against a ${percent(row.target, 0)} target (${drift}${band ? `; F8 rebalances past ${band}` : ''}).`,
    zh: `${name.zh}：${percent(row.weight)}，目標 ${percent(row.target, 0)}（${drift}${band ? `；超過 ${band} 即再平衡` : ''}）。`,
  };
}

/** Why a proposal fired, with its figures, line by line. */
export function whyLines(rule: RuleLike, detail: ProposalDetail, names: Names): Bilingual[] {
  const pool = twd(detail.poolTwd);
  const lines: Bilingual[] = [];
  switch (rule.condition) {
    case 'single_stock_weight_above': {
      const cap = percent(detail.limit ?? 0, 0);
      for (const stock of detail.stocks ?? []) {
        lines.push({
          en: `${stock.ticker} is ${percent(stock.weight)} of the regular pool (${twd(stock.valueTwd)} of ${pool}), above the ${cap} single-stock cap. Selling about ${twd(stock.trimTwd)} brings it back to the cap.`,
          zh: `${stock.ticker} 占一般投入資金池的 ${percent(stock.weight)}（${pool} 中的 ${twd(stock.valueTwd)}），超過單一個股 ${cap} 上限；賣出約 ${twd(stock.trimTwd)} 可回到上限。`,
        });
        // Whole shares round a sale up, so the cap is met; with a costly share that can be much more.
        if (stock.soldTwd !== undefined && stock.soldTwd > stock.trimTwd * 1.5 + 1) {
          lines.push({
            en: `In whole shares that is ${twd(stock.soldTwd)} of ${stock.ticker}, more than needed, as one share costs more than the trim; edit the order to sell less and stay a little over the cap, or let its market trade in fractions on the Rules page.`,
            zh: `以整股計算需賣出 ${stock.ticker} ${twd(stock.soldTwd)}，多於所需，因為一股的價格高於減碼金額；可修改下單清單少賣一些（會略高於上限），或在「規則」頁讓該市場以零股（小數股）下單。`,
          });
        }
      }
      lines.push({ en: 'The proceeds stay in the regular pool and buy the core classes furthest below their targets.', zh: '賣出所得留在一般投入資金池，買進最低於目標的核心類別。' });
      break;
    }
    case 'satellite_weight_above': {
      const trim = twd(detail.trimTwd ?? 0);
      lines.push({
        en: `The satellite is ${percent(detail.weight ?? 0)} of the regular pool (${twd(detail.satelliteTwd ?? 0)} of ${pool}), above the ${percent(detail.trigger ?? 0, 0)} trigger. Trimming about ${trim} brings it back to ${percent(detail.target ?? 0, 0)}, pro rata across its holdings.`,
        zh: `衛星部位占一般投入資金池的 ${percent(detail.weight ?? 0)}（${pool} 中的 ${twd(detail.satelliteTwd ?? 0)}），超過 ${percent(detail.trigger ?? 0, 0)} 觸發點；依各持股比例減碼約 ${trim}，回到 ${percent(detail.target ?? 0, 0)}。`,
      });
      if (detail.countedTwd) {
        lines.push({
          en: `R1's proposal already sells ${twd(detail.countedTwd)} of it, so this one sells the rest.`,
          zh: `R1 的提案已賣出其中 ${twd(detail.countedTwd)}，本提案賣出其餘部分。`,
        });
      }
      lines.push({ en: 'The proceeds buy the core classes furthest below their targets; F8 never buys the satellite.', zh: '賣出所得買進最低於目標的核心類別；F8 不會買進衛星部位。' });
      break;
    }
    case 'class_drift_exceeds':
      for (const row of detail.classes ?? []) lines.push(classLine(row, names));
      lines.push({
        en: `Of the regular pool's ${pool}: the classes over their band sell back to target, and the proceeds buy the ones under theirs first, then the others furthest below target.`,
        zh: `一般投入資金池 ${pool} 中：超過門檻的類別賣回目標，所得優先買進低於門檻的類別，其次是其他最低於目標的類別。`,
      });
      break;
    case 'day_after_dca':
      lines.push({
        en: `The ${twd(detail.contributionTwd ?? 0)} debited on ${detail.dcaDate ?? '—'}: check it arrived, then put it into the core classes furthest below their targets, as the targets apply to the regular pool plus the new cash (${pool} before it).`,
        zh: `${detail.dcaDate ?? '—'} 扣款的 ${twd(detail.contributionTwd ?? 0)}：確認入帳後，投入最低於目標的核心類別；目標以一般投入資金池加上新資金計算（投入前為 ${pool}）。`,
      });
      break;
    case 'first_weekend_of_month':
      lines.push({
        en: `The yearly check: every core class back to its target in the regular pool of ${pool}, and a look over the rules and their thresholds.`,
        zh: `每年一次的檢查：一般投入資金池 ${pool} 中的每個核心類別回到目標，並檢視各項規則與門檻。`,
      });
      for (const row of detail.classes ?? []) lines.push(classLine(row, names));
      break;
    case 'us_situs_value_above': {
      const total = money(detail.situsUsd ?? 0, 'USD', 0);
      const limit = money(detail.limitUsd ?? 0, 'USD', 0);
      const rate = detail.usdTwd ? `${detail.usdTwd}` : '—';
      const held = (detail.situs ?? []).map((row) => `${row.ticker} ${money(row.valueUsd, 'USD', 0)}`).join(', ');
      lines.push({
        en: `US-situs assets, US shares and US-domiciled ETFs in both pools, come to ${total} at NT$${rate} a dollar: ${held}. A non-US resident's estate is exempt only up to ${limit}; above it the US taxes the estate.`,
        zh: `美國資產（兩個資金池的美股與美國註冊 ETF）以 1 美元兌 ${rate} 台幣計共 ${total}：${held}。非美國居民的遺產只有 ${limit} 免稅，超過的部分會被課美國遺產稅。`,
      });
      lines.push({
        en: 'Consider Irish-domiciled equivalents, which are not US assets: for new money first, and for what is held where the sale is worth its fees and its tax (a gain abroad is overseas income). The Costs page compares them. No orders are drafted: approve it when you have decided, mark it filled once done.',
        zh: '可考慮改用愛爾蘭註冊的同類 ETF（不屬於美國資產）：先用於新資金；已持有的部分，若賣出值得其手續費與稅負（海外的已實現獲利屬海外所得）再轉換。「費用與稅務」頁有比較。本提案不產生下單清單：決定後核准，完成後標記為已成交。',
      });
      break;
    }
    case 'tranche_due': {
      const left = detail.tranchesLeft ?? 0;
      lines.push({
        en: `The windfall tranche due on ${detail.dueDate ?? '—'}: ${twd(detail.waitingTwd ?? 0)} waits for ${left} tranche${left === 1 ? '' : 's'}, so this one deploys ${twd(detail.cashTwd)}, split by the core targets; the satellite takes none of the windfall.`,
        zh: `${detail.dueDate ?? '—'} 到期的大額資金分批：${twd(detail.waitingTwd ?? 0)} 分 ${left} 批投入，本批投入 ${twd(detail.cashTwd)}，依核心目標權重分配；大額資金不投入衛星部位。`,
      });
      lines.push(...keptLine(detail));
      break;
    }
    case 'index_drawdown_tier': {
      const peak = detail.peak;
      const latest = detail.latest;
      const fall = percent(detail.drawdown ?? 0);
      const tier = percent(detail.tier ?? 0, 0);
      lines.push({
        en: `ACWI is ${fall} below its 52-week high (${peak ? `${peak.close} on ${peak.date}` : '—'}; ${latest ? `${latest.close} on ${latest.date}` : '—'}), past the ${tier} tier.`,
        zh: `ACWI 自 52 週高點下跌 ${fall}（高點 ${peak ? `${peak.date} 的 ${peak.close}` : '—'}；最新 ${latest ? `${latest.date} 的 ${latest.close}` : '—'}），已達 ${tier} 級距。`,
      });
      lines.push(
        detail.share === undefined
          ? {
              en: `So the next tranche goes in now with the current one: ${twd(detail.cashTwd)} of the ${twd(detail.waitingTwd ?? 0)} waiting, split by the core targets. Each tier fires once in this drawdown.`,
              zh: `因此下一批提前與本批一起投入：等待中的 ${twd(detail.waitingTwd ?? 0)} 中投入 ${twd(detail.cashTwd)}，依核心目標權重分配。每個級距在這波下跌中只觸發一次。`,
            }
          : {
              en: `So ${percent(detail.share, 0)} of the cash waiting goes in now: ${twd(detail.cashTwd)} of ${twd(detail.waitingTwd ?? 0)}, split by the core targets${detail.share < 1 ? '; the tranches left deploy the rest at the usual pace' : ''}. Each tier fires once in this drawdown.`,
              zh: `因此等待中資金的 ${percent(detail.share, 0)} 現在投入：${twd(detail.waitingTwd ?? 0)} 中的 ${twd(detail.cashTwd)}，依核心目標權重分配${detail.share < 1 ? '；其餘依原節奏由剩下的批次投入' : ''}。每個級距在這波下跌中只觸發一次。`,
            },
      );
      lines.push(...keptLine(detail));
      break;
    }
    default:
      break;
  }
  return [...lines, ...cashLines(detail, names)];
}

/** "Sell 3 AAPL ≈ 236.00 USD each, ≈ NT$22,939" / "Take NT$5,000 out of Savings". */
export function orderLine(order: DraftOrder): Bilingual {
  if (order.kind === 'balance') {
    return order.side === 'withdraw'
      ? { en: `Take ${twd(order.amountTwd)} out of ${order.label}`, zh: `自「${order.label}」轉出 ${twd(order.amountTwd)}` }
      : { en: `Put ${twd(order.amountTwd)} into ${order.label}`, zh: `存入「${order.label}」${twd(order.amountTwd)}` };
  }
  const each = money(order.price, order.currency);
  const amount = twd(order.amountTwd);
  return order.side === 'buy'
    ? { en: `Buy ${quantity(order.qty)} ${order.ticker} at about ${each}, about ${amount}`, zh: `買進 ${order.ticker} ${quantity(order.qty)} 股，約 ${each}，約 ${amount}` }
    : { en: `Sell ${quantity(order.qty)} ${order.ticker} at about ${each}, about ${amount}`, zh: `賣出 ${order.ticker} ${quantity(order.qty)} 股，約 ${each}，約 ${amount}` };
}

/** What the engine found for a rule just now, for the rules page; `condition` tells the rules other checks watch. */
export function checkText(check: Check, condition?: string): Bilingual {
  if (check.outcome === 'later' && condition === 'job_failed_consecutively') {
    return {
      en: 'Watched by the data status check, not the engine: failed nights in a row raise the alert on the holdings page and a push.',
      zh: '由資料狀態檢查負責，不經規則引擎：連續失敗的夜晚會在持倉頁顯示警示並推播。',
    };
  }
  switch (check.outcome) {
    case 'fires':
      return check.cooldownUntil
        ? { en: `Fires, but this state was proposed lately: held back until ${check.cooldownUntil} (cooldown).`, zh: `觸發中，但最近已就相同狀態提案：冷卻期至 ${check.cooldownUntil}。` }
        : { en: 'Fires: a proposal is open or drafted at the next check.', zh: '觸發中：已有待處理提案，或在下次檢查時產生。' };
    case 'quiet':
      return { en: 'Not firing.', zh: '未觸發。' };
    case 'covered':
      return check.why === 'R1'
        ? { en: "Over its trigger, but R1's trims bring it back.", zh: '超過觸發點，但 R1 的減碼已足以回到目標。' }
        : { en: 'A class is under its band, but the next monthly contribution covers it, so no sale is proposed (cash first).', zh: '有類別低於門檻，但下一次每月投入即可補足，因此不提出賣出（現金流優先）。' };
    case 'waiting':
      if (check.why === 'dca_day') return { en: 'Waiting for the DCA debit day: set it below.', zh: '尚未設定定期定額扣款日：請在下方設定。' };
      if (check.why === 'usd') return { en: 'Waiting for a USD/TWD rate to value US assets in dollars.', zh: '等待美元匯率，才能以美元計算美國資產。' };
      if (check.why === 'plan') return { en: 'Waiting for a windfall plan: start one on the Windfall page once the money arrives.', zh: '尚無大額資金計畫：資金入帳後，請在「大額資金」頁建立。' };
      if (check.why === 'windfall_cash') return { en: "Waiting for the windfall's cash: record it as a TWD balance in the windfall pool.", zh: '尚無大額資金的現金：請以台幣餘額登錄在大額資金池。' };
      if (check.why === 'gauge') return { en: "Waiting for ACWI's closes: the nightly job loads them.", zh: '等待 ACWI 的收盤價：每夜排程會載入。' };
      return { en: 'Nothing in the regular pool to measure yet.', zh: '一般投入資金池尚無可衡量的持股。' };
    case 'unreadable':
      return { en: 'A threshold is missing or malformed; fix it below.', zh: '門檻數值缺漏或格式錯誤：請在下方修正。' };
    case 'off':
      return { en: 'Turned off.', zh: '已停用。' };
    case 'later':
      return { en: 'Evaluated once its feature is built (a later step).', zh: '相關功能完成後才會評估（之後的步驟）。' };
  }
}
