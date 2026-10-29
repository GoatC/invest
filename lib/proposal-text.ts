/**
 * The words of the rules engine (PRD Section 4): each proposal's title and why it fired, with its
 * figures (design principle 4: explain every number), each draft order as a line, and what the
 * engine found for each rule. Bilingual; the pages and the trade form share them.
 */
import { money, percent, points, quantity, twd } from './format';
import type { Bilingual } from './i18n';
import type { Check, ClosedReason, DraftOrder, ProposalDetail, ProposalStatus } from './models/engine';
import { flagLine } from './red-flag-text';

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
  price_at_or_below_value_multiple: { en: 'Buy zone', zh: '進入買入區' },
  price_at_or_above_value_multiple: { en: 'Trim zone', zh: '進入減碼區' },
  value_change_exceeds: { en: 'Valuation updated', zh: '估值更新' },
  red_flag_worsens: { en: 'Red flag worsens', zh: '紅旗惡化' },
  satellite_red_flag: { en: 'Red flag turns red', zh: '紅旗轉紅' },
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
        ? { en: `${twd(detail.cashTwd)} to invest · ${twd(detail.leftTwd)} stays as cash (whole shares)`, zh: `可投入 ${twd(detail.cashTwd)} · ${twd(detail.leftTwd)} 留作現金（股數取整）` }
        : { en: `${twd(detail.cashTwd)} to invest`, zh: `可投入 ${twd(detail.cashTwd)}` },
    );
  }
  if (detail.untradedTwd && detail.untradedTwd >= 1) {
    lines.push({ en: `${twd(detail.untradedTwd)} of it is gold in grams: adjust by hand, or leave it`, zh: `其中 ${twd(detail.untradedTwd)} 是實體黃金（克）：請自行調整或保留` });
  }
  if (detail.noFund && detail.noFund.length > 0) {
    const listed = detail.noFund.map((id) => className(names, id));
    lines.push({
      en: `No fund to buy for ${listed.map((name) => name.en).join(', ')}: hold one, or set a benchmark ETF`,
      zh: `${listed.map((name) => name.zh).join('、')}沒有可買進的基金：請先持有一檔，或設定基準 ETF`,
    });
  }
  return lines;
}

/** Windfall orders: what strategic cash's share leaves in the balance, which is strategic cash already. */
function keptLine(detail: ProposalDetail): Bilingual[] {
  if (!detail.keptTwd || detail.keptTwd < 1) return [];
  return [{ en: `Strategic cash's share, ${twd(detail.keptTwd)}, stays in the balance`, zh: `戰略現金的部分 ${twd(detail.keptTwd)} 留在原帳戶` }];
}

function classLine(row: { id: string; weight: number; target: number; band: number | null }, names: Names): Bilingual {
  const name = className(names, row.id);
  const drift = points(row.weight - row.target);
  const band = row.band === null ? null : points(row.band).replace(/^\+/, '±');
  return {
    en: `${name.en}: ${percent(row.weight)} / ${percent(row.target, 0)} target (${drift}${band ? `; band ${band}` : ''})`,
    zh: `${name.zh}：${percent(row.weight)} / 目標 ${percent(row.target, 0)}（${drift}${band ? `；門檻 ${band}` : ''}）`,
  };
}

/** Why a proposal fired: its figures, a short line each. howLines holds the method, folded behind ⓘ. */
export function whyLines(rule: RuleLike, detail: ProposalDetail, names: Names): Bilingual[] {
  const pool = twd(detail.poolTwd);
  const lines: Bilingual[] = [];
  switch (rule.condition) {
    case 'single_stock_weight_above': {
      const cap = percent(detail.limit ?? 0, 0);
      for (const stock of detail.stocks ?? []) {
        lines.push({
          en: `${stock.ticker}: ${percent(stock.weight)} of the regular pool (${twd(stock.valueTwd)} of ${pool}) > ${cap} cap · sell ≈ ${twd(stock.trimTwd)}`,
          zh: `${stock.ticker}：占一般投入資金池 ${percent(stock.weight)}（${pool} 中的 ${twd(stock.valueTwd)}）> ${cap} 上限 · 賣出約 ${twd(stock.trimTwd)}`,
        });
        // Whole shares round a sale up, so the cap is met; with a costly share that can be much more.
        if (stock.soldTwd !== undefined && stock.soldTwd > stock.trimTwd * 1.5 + 1) {
          lines.push({ en: `Whole shares: ${twd(stock.soldTwd)} of ${stock.ticker}, more than needed`, zh: `以整股計需賣出 ${stock.ticker} ${twd(stock.soldTwd)}，多於所需` });
        }
      }
      break;
    }
    case 'satellite_weight_above':
      lines.push({
        en: `Satellite: ${percent(detail.weight ?? 0)} of the regular pool (${twd(detail.satelliteTwd ?? 0)} of ${pool}) > ${percent(detail.trigger ?? 0, 0)} · trim ≈ ${twd(detail.trimTwd ?? 0)} → ${percent(detail.target ?? 0, 0)}`,
        zh: `衛星部位：占一般投入資金池 ${percent(detail.weight ?? 0)}（${pool} 中的 ${twd(detail.satelliteTwd ?? 0)}）> ${percent(detail.trigger ?? 0, 0)} · 減碼約 ${twd(detail.trimTwd ?? 0)} → ${percent(detail.target ?? 0, 0)}`,
      });
      if (detail.countedTwd) lines.push({ en: `R1 already sells ${twd(detail.countedTwd)} of it`, zh: `R1 的提案已賣出其中 ${twd(detail.countedTwd)}` });
      break;
    case 'class_drift_exceeds':
      for (const row of detail.classes ?? []) lines.push(classLine(row, names));
      break;
    case 'day_after_dca':
      lines.push({
        en: `${twd(detail.contributionTwd ?? 0)} debited on ${detail.dcaDate ?? '—'} → the core classes furthest below target (pool ${pool} before it)`,
        zh: `${detail.dcaDate ?? '—'} 扣款 ${twd(detail.contributionTwd ?? 0)} → 最低於目標的核心類別（投入前資金池 ${pool}）`,
      });
      if (detail.satelliteShareTwd) lines.push({ en: `${twd(detail.satelliteShareTwd)} of it goes to the buy-zone proposal`, zh: `其中 ${twd(detail.satelliteShareTwd)} 用於買入區提案` });
      break;
    case 'first_weekend_of_month':
      lines.push({ en: `Yearly check of the regular pool, ${pool}`, zh: `一般投入資金池 ${pool} 的年度檢查` });
      for (const row of detail.classes ?? []) lines.push(classLine(row, names));
      break;
    case 'us_situs_value_above': {
      const rate = detail.usdTwd ? `${detail.usdTwd}` : '—';
      const held = (detail.situs ?? []).map((row) => `${row.ticker} ${money(row.valueUsd, 'USD', 0)}`).join(', ');
      lines.push({
        en: `US-situs assets: ${money(detail.situsUsd ?? 0, 'USD', 0)} > ${money(detail.limitUsd ?? 0, 'USD', 0)} exempt (NT$${rate} a dollar): ${held}`,
        zh: `美國資產：${money(detail.situsUsd ?? 0, 'USD', 0)} > 免稅額 ${money(detail.limitUsd ?? 0, 'USD', 0)}（1 美元兌 ${rate} 台幣）：${held}`,
      });
      lines.push({ en: '→ Irish-domiciled equivalents, new money first · No orders drafted', zh: '→ 愛爾蘭註冊的同類 ETF，新資金優先 · 不產生下單清單' });
      break;
    }
    case 'tranche_due': {
      const left = detail.tranchesLeft ?? 0;
      lines.push({
        en: `Tranche due ${detail.dueDate ?? '—'}: ${twd(detail.waitingTwd ?? 0)} ÷ ${left} tranche${left === 1 ? '' : 's'} = ${twd(detail.cashTwd)}, by the core targets`,
        zh: `${detail.dueDate ?? '—'} 到期分批：${twd(detail.waitingTwd ?? 0)} ÷ ${left} 批 = ${twd(detail.cashTwd)}，依核心目標權重`,
      });
      lines.push(...keptLine(detail));
      break;
    }
    case 'index_drawdown_tier': {
      const peak = detail.peak;
      const latest = detail.latest;
      lines.push({
        en: `ACWI −${percent(detail.drawdown ?? 0)} from its 52-week high (${peak ? `${peak.close} on ${peak.date}` : '—'} → ${latest ? `${latest.close} on ${latest.date}` : '—'}) · tier ${percent(detail.tier ?? 0, 0)}`,
        zh: `ACWI 自 52 週高點 −${percent(detail.drawdown ?? 0)}（${peak ? `${peak.date} 的 ${peak.close}` : '—'} → ${latest ? `${latest.date} 的 ${latest.close}` : '—'}）· 級距 ${percent(detail.tier ?? 0, 0)}`,
      });
      lines.push(
        detail.share === undefined
          ? { en: `Next tranche now: ${twd(detail.cashTwd)} of ${twd(detail.waitingTwd ?? 0)} waiting`, zh: `下一批提前投入：等待中 ${twd(detail.waitingTwd ?? 0)} 的 ${twd(detail.cashTwd)}` }
          : { en: `${percent(detail.share, 0)} of the cash now: ${twd(detail.cashTwd)} of ${twd(detail.waitingTwd ?? 0)} waiting`, zh: `現在投入等待資金的 ${percent(detail.share, 0)}：${twd(detail.waitingTwd ?? 0)} 中的 ${twd(detail.cashTwd)}` },
      );
      lines.push(...keptLine(detail));
      break;
    }
    case 'price_at_or_below_value_multiple':
      for (const row of detail.zone ?? []) {
        const room = row.roomTwd !== undefined && row.roomTwd < (detail.satelliteShareTwd ?? 0) ? { en: ` · R1 / R2 room ${twd(row.roomTwd)}`, zh: ` · R1／R2 可容納 ${twd(row.roomTwd)}` } : { en: '', zh: '' };
        lines.push({
          en: `${row.ticker}: ${money(row.price, row.currency)} ≤ ${percent(row.multiple, 0)} of its ${money(row.value, row.currency)} value (${money(row.value * row.multiple, row.currency)})${room.en}`,
          zh: `${row.ticker}：${money(row.price, row.currency)} ≤ 內在價值 ${money(row.value, row.currency)} 的 ${percent(row.multiple, 0)}（${money(row.value * row.multiple, row.currency)}）${room.zh}`,
        });
      }
      lines.push({ en: `From this month's contribution: up to ${twd(detail.satelliteShareTwd ?? 0)}`, zh: `來自本月投入：最多 ${twd(detail.satelliteShareTwd ?? 0)}` });
      break;
    case 'price_at_or_above_value_multiple':
      for (const row of detail.zone ?? []) {
        lines.push({
          en: `${row.ticker}: ${money(row.price, row.currency)} ≥ ${percent(row.multiple, 0)} of its ${money(row.value, row.currency)} value · sell ${percent(detail.sellShare ?? 0, 0)} of ${twd(row.heldTwd ?? 0)}`,
          zh: `${row.ticker}：${money(row.price, row.currency)} ≥ 內在價值 ${money(row.value, row.currency)} 的 ${percent(row.multiple, 0)} · 賣出 ${twd(row.heldTwd ?? 0)} 的 ${percent(detail.sellShare ?? 0, 0)}`,
        });
      }
      break;
    case 'value_change_exceeds':
      for (const row of detail.changes ?? []) {
        lines.push({
          en: `${row.ticker}: ${row.previous.toFixed(2)} (${row.previousOn}) → ${row.value.toFixed(2)} (${row.valuedOn}), ${row.change > 0 ? '+' : ''}${percent(row.change)}`,
          zh: `${row.ticker}：${row.previous.toFixed(2)}（${row.previousOn}）→ ${row.value.toFixed(2)}（${row.valuedOn}），${row.change > 0 ? '+' : ''}${percent(row.change)}`,
        });
      }
      lines.push({ en: 'Review the assumptions on the Valuation page · No orders drafted', zh: '請到「估值」頁檢視假設 · 不產生下單清單' });
      break;
    case 'red_flag_worsens':
      for (const row of detail.flags ?? []) lines.push(flagLine(row));
      lines.push({ en: 'Review the indicators on the Red flags page · No orders drafted', zh: '請到「紅旗指標」頁檢視指標 · 不產生下單清單' });
      break;
    case 'satellite_red_flag':
      for (const row of detail.flags ?? []) {
        lines.push(flagLine(row));
        if (row.soldTwd !== undefined) lines.push({ en: `Exit option: sell ${twd(row.soldTwd)} of ${twd(row.heldTwd ?? 0)}`, zh: `出場選項：賣出 ${twd(row.heldTwd ?? 0)} 中的 ${twd(row.soldTwd)}` });
      }
      break;
    default:
      break;
  }
  return [...lines, ...cashLines(detail, names)];
}

/** How a proposal's orders are worked out: the method behind its figures, shown behind ⓘ. */
export function howLines(rule: RuleLike, detail: ProposalDetail): Bilingual[] {
  const kept: Bilingual[] = detail.keptTwd && detail.keptTwd >= 1 ? [{ en: 'Strategic cash stays in the balance the windfall waits in, which is strategic cash already.', zh: '戰略現金的部分留在大額資金等待中的帳戶，它本身就是戰略現金。' }] : [];
  switch (rule.condition) {
    case 'single_stock_weight_above':
      return [
        { en: 'Trim = the stock\'s value − the cap × the regular pool. The proceeds stay in the regular pool and buy the core classes furthest below their targets.', zh: '減碼金額 = 該股市值 − 上限 × 一般投入資金池。賣出所得留在一般投入資金池，買進最低於目標的核心類別。' },
        { en: 'When one share costs more than the trim, edit the order to sell less and stay a little over the cap, or let its market trade in fractions on the Rules page.', zh: '一股價格高於減碼金額時，可修改下單清單少賣一些（會略高於上限），或在「規則」頁讓該市場以零股（小數股）下單。' },
      ];
    case 'satellite_weight_above':
      return [{ en: 'The trim is pro rata across the satellite holdings, less what R1 already sells; the proceeds buy the core classes furthest below their targets. F8 never buys the satellite.', zh: '依各衛星持股比例減碼，扣除 R1 已賣出的部分；所得買進最低於目標的核心類別。F8 不會買進衛星部位。' }];
    case 'class_drift_exceeds':
      return [{ en: 'Classes past their band sell back to target; the proceeds buy the ones under their band first, then the others furthest below target.', zh: '超過門檻的類別賣回目標，所得優先買進低於門檻的類別，其次是其他最低於目標的類別。' }];
    case 'day_after_dca':
      return [{ en: 'Check the debit arrived first. The targets apply to the regular pool plus the new cash.', zh: '請先確認扣款已入帳。目標權重以一般投入資金池加上新資金計算。' }];
    case 'first_weekend_of_month':
      return [{ en: 'Once a year every core class goes back to its target, and the rules and their thresholds are looked over.', zh: '每年一次讓每個核心類別回到目標，並檢視各項規則與門檻。' }];
    case 'us_situs_value_above':
      return [
        { en: "US-situs assets are US shares and US-domiciled ETFs in both pools. A non-US resident's estate is exempt only up to the limit; above it the US taxes the estate.", zh: '美國資產指兩個資金池中的美股與美國註冊 ETF。非美國居民的遺產只在免稅額內免稅，超過的部分會被課美國遺產稅。' },
        { en: 'Irish-domiciled equivalents are not US assets: use them for new money first, and for what is held where the sale is worth its fees and tax (a gain abroad is overseas income). The Costs page compares them. Approve when decided; mark filled once done.', zh: '愛爾蘭註冊的同類 ETF 不屬於美國資產：先用於新資金；已持有的部分，若賣出值得其手續費與稅負（海外已實現獲利屬海外所得）再轉換。「費用與稅務」頁有比較。決定後核准，完成後標記為已成交。' },
      ];
    case 'tranche_due':
      return [{ en: 'Each tranche deploys the cash still waiting over the tranches still to go, split by the core targets; the satellite takes none of the windfall.', zh: '每一批以「仍在等待的現金 ÷ 剩下的批數」投入，依核心目標權重分配；大額資金不投入衛星部位。' }, ...kept];
    case 'index_drawdown_tier':
      return [{ en: 'Each tier fires once per drawdown; after a partial deployment, the tranches left deploy the rest at the usual pace.', zh: '每個級距在同一波下跌中只觸發一次；部分投入後，其餘依原節奏由剩下的批次投入。' }, ...kept];
    case 'price_at_or_below_value_multiple':
      return [
        { en: "While a watched stock is in its buy zone, up to the contribution's satellite share (MONTHLY_CONTRIBUTION) goes to it each month, split over the stocks in the zone; the month's contribution puts the rest into the core. Each buy stays within R1's cap and R2's 20% target.", zh: '觀察清單個股在買入區期間，每月投入中最多衛星比例（MONTHLY_CONTRIBUTION）的金額可投入，多檔時平分；當月其餘投入核心類別。每筆買進都受 R1 上限與 R2 的 20% 目標限制。' },
        { en: 'The value is the base case of the model its alerts use, as last saved on the Valuation page.', zh: '內在價值為警報所用模型的基本情境，取「估值」頁最後儲存的數值。' },
      ];
    case 'price_at_or_above_value_multiple':
      return [{ en: 'Selling a share of the holding takes profit while the price is well above value; the proceeds stay in the regular pool and buy the core classes furthest below target.', zh: '股價明顯高於內在價值時賣出部分持股以實現獲利；所得留在一般投入資金池，買進最低於目標的核心類別。' }];
    case 'red_flag_worsens':
      return [{ en: "A weekly scan found the stock's light worse than before. A light is display only: check what fired, then dismiss with a reason or keep watching.", zh: '每週掃描發現該股燈號比之前差。燈號只供參考：請檢視觸發的指標，再略過（可附理由）或持續觀察。' }];
    case 'satellite_red_flag':
      return [
        { en: 'A satellite stock turned red: look at what fired again. The exit is drafted so it is ready; edit or dismiss it if the case still holds.', zh: '衛星持股轉為紅燈：請重新檢視觸發的指標。出場清單已先準備好；若投資理由仍成立，可修改或略過。' },
        { en: 'The proceeds stay in the regular pool and buy the core classes furthest below target.', zh: '賣出所得留在一般投入資金池，買進最低於目標的核心類別。' },
      ];
    case 'value_change_exceeds':
      return [{ en: 'A new quarter changed the figures the value is worked out from. Check the growth rates and any typed figures still fit, then save the valuation again.', zh: '新一季財報改變了計算內在價值的數字。請確認成長率與自訂數字是否仍合適，再重新儲存估值。' }];
    default:
      return [];
  }
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
  if (check.outcome === 'later' && condition === 'job_failed_consecutively') return { en: 'Watched by the data status check', zh: '由資料狀態檢查負責' };
  switch (check.outcome) {
    case 'fires':
      return check.cooldownUntil ? { en: `Fires · held back until ${check.cooldownUntil} (cooldown)`, zh: `觸發中 · 冷卻至 ${check.cooldownUntil}` } : { en: 'Fires', zh: '觸發中' };
    case 'quiet':
      return { en: 'Not firing', zh: '未觸發' };
    case 'covered':
      return check.why === 'R1' ? { en: "Covered by R1's trims", zh: '由 R1 的減碼處理' } : { en: 'Covered by the next contribution', zh: '下次每月投入可補足' };
    case 'waiting':
      if (check.why === 'dca_day') return { en: 'Waiting for the DCA debit day', zh: '尚未設定定期定額扣款日' };
      if (check.why === 'usd') return { en: 'Waiting for a USD/TWD rate', zh: '等待美元匯率' };
      if (check.why === 'plan') return { en: 'Waiting for a windfall plan', zh: '尚無大額資金計畫' };
      if (check.why === 'windfall_cash') return { en: "Waiting for the windfall's cash", zh: '尚無大額資金的現金' };
      if (check.why === 'gauge') return { en: "Waiting for ACWI's closes", zh: '等待 ACWI 的收盤價' };
      if (check.why === 'valuation') return { en: 'Waiting for a saved valuation', zh: '尚無已儲存的估值' };
      if (check.why === 'red_flags') return { en: 'Waiting for a red-flag scan', zh: '尚無紅旗掃描' };
      return { en: 'Nothing to measure yet', zh: '尚無可衡量的持股' };
    case 'unreadable':
      return { en: 'Threshold missing or malformed', zh: '門檻缺漏或格式錯誤' };
    case 'off':
      return { en: 'Turned off', zh: '已停用' };
    case 'later':
      return { en: 'Comes with a later step', zh: '之後的步驟才評估' };
  }
}
