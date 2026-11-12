import Link from 'next/link';

import { TaipeiTime } from '@/components/history';
import { DataError, loadFeeContext, orDataError, type FeeContext, type Proposal, type RuleRecord } from '@/lib/data';
import type { requireSession } from '@/lib/auth';
import { money, quantity, twd } from '@/lib/format';
import type { Bilingual } from '@/lib/i18n';
import { orderCost, type OrderCost } from '@/lib/models/costs';
import type { DraftOrder } from '@/lib/models/engine';
import { CLOSED, howLines, orderLine, proposalAlert, proposalTitle, stateText, STATUS, suggestionLine, whyLines, type RuleLike } from '@/lib/proposal-text';

import { checkRules, dismissProposal } from '@/app/proposals/actions';
import { AlertTiles } from './alert-tiles';
import { Bi } from './bi';
import { Info } from './info';

type Params = Record<string, string | string[] | undefined>;
type Supabase = Awaited<ReturnType<typeof requireSession>>['supabase'];
type Names = ReadonlyMap<string, Bilingual>;

function one(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function savedMessage(params: Params): Bilingual | undefined {
  switch (one(params, 'saved')) {
    case 'checked': {
      const created = Number(one(params, 'created') ?? 0);
      const closed = Number(one(params, 'closed') ?? 0);
      return { en: `Rules checked: ${created} new, ${closed} cleared.`, zh: `已檢查規則：新增 ${created} 則，解除 ${closed} 則。` };
    }
    case 'dismissed':
      return { en: 'Dismissed.', zh: '已忽略。' };
    case 'stale':
      return { en: 'That warning had already cleared; nothing changed.', zh: '這則警示已經解除，沒有變更。' };
    default:
      return undefined;
  }
}

/**
 * The rule warnings (Hugo, 2026-11-12: a proposal is a standing warning that can be dismissed). Each
 * open one is a tile with a dismiss button, the line of what it suggests, and its figures and
 * suggested orders folded under it; it stays until dismissed or its rule clears. The dismissed and
 * cleared ones fold at the foot.
 */
export async function WarningsPanel({ supabase, params, proposals, rules, names }: { supabase: Supabase; params: Params; proposals: readonly Proposal[]; rules: readonly RuleRecord[]; names: Names }) {
  const feeContext = await orDataError(loadFeeContext(supabase));
  const fees = feeContext instanceof DataError ? undefined : feeContext;
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const ruleOf = (proposal: Proposal): RuleLike => byId.get(proposal.ruleId) ?? { id: proposal.ruleId, condition: '' };
  const open = proposals.filter((proposal) => proposal.status === 'open');
  const closed = proposals.filter((proposal) => proposal.status !== 'open');
  const saved = savedMessage(params);
  const failed = one(params, 'failed');

  return (
    <section className="card form" id="proposals">
      <div className="row spread">
        <h2>
          <Bi en="Rule warnings" zh="規則警示" />
        </h2>
        <div className="row">
          <form action={checkRules}>
            <button type="submit" className="button">
              <Bi en="Check the rules now" zh="立即檢查規則" />
            </button>
          </form>
          <Link href="/rules" className="button">
            <Bi en="Rules and thresholds" zh="規則與門檻" />
          </Link>
        </div>
      </div>
      <Info>
        <Bi
          en="When a rule fires, the app raises a warning with what it suggests, and stops there (L2): you decide and trade at your broker yourself. A warning stays until you dismiss it or the rule no longer fires. The rules are checked after every nightly price update, or now with the button."
          zh="規則觸發時，App 會顯示一則警示與建議動作，然後停下來（L2）：由你決定，並自己到券商下單。警示會一直留著，直到你忽略它，或規則不再觸發。每晚價格更新後會檢查規則，也可以按上方按鈕立即檢查。"
        />
      </Info>
      {saved && (
        <p className="banner ok" role="status">
          <Bi {...saved} />
        </p>
      )}
      {failed && (
        <p className="banner danger" role="alert">
          <Bi en={`Could not check or save: ${failed}`} zh={`無法檢查或儲存：${failed}`} />
        </p>
      )}
      {open.length === 0 ? (
        <p className="muted">
          <Bi en="No warnings." zh="沒有警示。" />
        </p>
      ) : (
        <AlertTiles
          items={open.map((proposal) => ({ ...proposalAlert(proposal, ruleOf(proposal)), anchor: `proposal-${proposal.id}` }))}
          actions={Object.fromEntries(
            open.map((proposal) => [
              String(proposal.id),
              <form key={proposal.id} action={dismissProposal}>
                <input type="hidden" name="id" value={proposal.id} />
                <button type="submit">
                  <Bi en="Dismiss" zh="忽略" />
                </button>
              </form>,
            ]),
          )}
          more={Object.fromEntries(open.map((proposal) => [String(proposal.id), <WarningMore key={proposal.id} proposal={proposal} rule={ruleOf(proposal)} names={names} fees={fees} />]))}
        />
      )}
      {closed.length > 0 && (
        <details>
          <summary>
            <Bi en={`Dismissed and cleared (${closed.length})`} zh={`已忽略與已解除（${closed.length}）`} label />
          </summary>
          <Closed proposals={closed} ruleOf={ruleOf} />
        </details>
      )}
    </section>
  );
}

/** Under a warning's tile: what it suggests in a line, and its figures and suggested orders folded. */
function WarningMore({ proposal, rule, names, fees }: { proposal: Proposal; rule: RuleLike; names: Names; fees: FeeContext | undefined }) {
  const how = howLines(rule, proposal.detail);
  return (
    <>
      <p>
        <Bi {...suggestionLine(rule.condition, proposal.state, proposal.detail, names)} />
      </p>
      <details className="warning-more">
        <summary>
          <Bi en="Why, and the suggested orders" zh="原因與建議下單" label />
        </summary>
        <ul className="formula">
          {whyLines(rule, proposal.detail, names).map((line) => (
            <li key={line.en}>
              <Bi {...line} />
            </li>
          ))}
        </ul>
        {how.length > 0 && (
          <Info>
            {how.map((line) => (
              <p key={line.en}>
                <Bi {...line} />
              </p>
            ))}
          </Info>
        )}
        <Orders orders={proposal.orders} fees={fees} />
      </details>
    </>
  );
}

const ACTION: Record<DraftOrder['side'], Bilingual> = {
  buy: { en: 'Buy', zh: '買進' },
  sell: { en: 'Sell', zh: '賣出' },
  deposit: { en: 'Put in', zh: '存入' },
  withdraw: { en: 'Take out', zh: '轉出' },
};

/** Each trade order's estimated fee and tax (F15), by its security's market and kind; undefined for a balance. */
function orderCosts(orders: readonly DraftOrder[], fees: FeeContext | undefined): Array<OrderCost | undefined> {
  return orders.map((order) => {
    if (order.kind !== 'trade' || !fees) return undefined;
    const security = fees.securities.get(order.ticker);
    return security ? orderCost(order, security, fees.costs) : undefined;
  });
}

function costText(cost: OrderCost | undefined, currency: string): string {
  if (!cost?.known) return '—';
  const fee = money(cost.fee, currency, currency === 'TWD' ? 0 : 2);
  return cost.tax > 0 ? `${fee} + ${money(cost.tax, currency, 0)}` : fee;
}

/** The orders a warning suggests, for reference: Hugo places any he takes at his broker and records them as trades. */
function Orders({ orders, fees }: { orders: readonly DraftOrder[]; fees: FeeContext | undefined }) {
  if (orders.length === 0) {
    return (
      <p className="muted small">
        <Bi en="No orders: only to review." zh="沒有建議下單：只需檢視。" />
      </p>
    );
  }
  const costs = orderCosts(orders, fees);
  const known = costs.filter((cost): cost is OrderCost => cost?.known === true);
  const totalTwd = known.reduce((sum, cost) => sum + cost.feeTwd + cost.taxTwd, 0);
  const broker = fees?.costs.broker;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Bi en="Order" zh="動作" />
              </th>
              <th>
                <Bi en="Fund or account" zh="標的或帳戶" />
              </th>
              <th className="num">
                <Bi en="Shares" zh="股數" />
              </th>
              <th className="num">
                <Bi en="Price" zh="價格" />
              </th>
              <th className="num">
                <Bi en="TWD" zh="台幣" />
              </th>
              <th className="num">
                <Bi en="Est. fee" zh="預估費用" />
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order, index) => (
              <tr key={index} aria-label={`${orderLine(order).en} ${orderLine(order).zh}`}>
                <td>
                  <Bi {...ACTION[order.side]} />
                </td>
                <td>{order.kind === 'trade' ? <strong>{order.ticker}</strong> : order.label}</td>
                <td className="num">{order.kind === 'trade' ? quantity(order.qty) : '—'}</td>
                <td className="num">{order.kind === 'trade' ? money(order.price, order.currency) : '—'}</td>
                <td className="num">{twd(order.amountTwd)}</td>
                <td className="num nowrap">{order.kind === 'trade' ? costText(costs[index], order.currency) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {known.length > 0 && (
        <p className="muted small">
          <Bi en={`Est. fees and tax ≈ ${twd(totalTwd)}${broker ? ` (${broker.nameEn})` : ''}`} zh={`預估費用與稅 ≈ ${twd(totalTwd)}${broker ? `（${broker.nameZh}）` : ''}`} />
        </p>
      )}
    </>
  );
}

function Closed({ proposals, ruleOf }: { proposals: readonly Proposal[]; ruleOf: (proposal: Proposal) => RuleLike }) {
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th>#</th>
            <th>
              <Bi en="Warning" zh="警示" />
            </th>
            <th>
              <Bi en="Status" zh="狀態" />
            </th>
            <th>
              <Bi en="Raised" zh="發出時間" />
            </th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((proposal) => (
            <tr key={proposal.id}>
              <td className="num">{proposal.id}</td>
              <td>
                <Bi {...proposalTitle(ruleOf(proposal))} />
                {proposal.state && <span className="muted small"> {stateText(proposal.state)}</span>}
              </td>
              <td>
                <Bi {...STATUS[proposal.status]} />
                {proposal.status === 'expired' && proposal.closedReason && (
                  <span className="muted small">
                    {' '}
                    <Bi {...CLOSED[proposal.closedReason]} />
                  </span>
                )}
              </td>
              <td className="nowrap">
                <TaipeiTime at={proposal.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
