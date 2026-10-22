import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { TaipeiTime } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadProposals, loadRules, type Proposal, type RuleRecord } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { money, quantity, twd } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { orderTotals, type DraftOrder } from '@/lib/models/engine';
import { CLOSED, orderLine, proposalTitle, stateText, STATUS, whyLines, type RuleLike } from '@/lib/proposal-text';

import { approveProposal, checkRules, dismissProposal, markFilled } from './actions';

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function savedMessage(params: Params): Bilingual | undefined {
  switch (one(params, 'saved')) {
    case 'checked': {
      const created = Number(one(params, 'created') ?? 0);
      const closed = Number(one(params, 'closed') ?? 0);
      return {
        en: `Rules checked: ${created} new proposal${created === 1 ? '' : 's'}, ${closed} closed.`,
        zh: `已檢查規則：新增 ${created} 份提案，關閉 ${closed} 份。`,
      };
    }
    case 'approved':
      return { en: 'Approved. Place the orders at your broker, record the trades, then mark it filled.', zh: '已核准。請到券商下單、登錄交易，再標記為已成交。' };
    case 'dismissed':
      return { en: 'Dismissed. The rule will not propose the same thing again for its cooldown.', zh: '已略過。冷卻期內，規則不會再就相同狀態提案。' };
    case 'filled':
      return { en: 'Marked filled.', zh: '已標記為成交。' };
    case 'edited':
      return { en: 'Orders saved; approve them when they look right.', zh: '已儲存下單清單；確認無誤後即可核准。' };
    case 'trade':
      return { en: 'Trade recorded. Record the others, then mark the proposal filled.', zh: '已登錄交易。登錄其餘交易後，再把提案標記為已成交。' };
    case 'stale':
      return { en: 'That proposal had already moved on (the nightly check or another tab); nothing was changed.', zh: '這份提案的狀態已經改變（每夜檢查或其他分頁），因此沒有變更。' };
    default:
      return undefined;
  }
}

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let proposals: Proposal[];
  let rules: RuleRecord[];
  let names: Map<string, Bilingual>;
  try {
    const [found, ruleRows, classes] = await Promise.all([loadProposals(supabase, today), loadRules(supabase), loadAssetClasses(supabase)]);
    proposals = found;
    rules = ruleRows;
    names = new Map(classes.map((assetClass) => [assetClass.id, { en: assetClass.nameEn, zh: assetClass.nameZh }]));
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const ruleOf = (proposal: Proposal): RuleLike => byId.get(proposal.ruleId) ?? { id: proposal.ruleId, condition: '' };
  const open = proposals.filter((proposal) => proposal.status === 'open');
  const approved = proposals.filter((proposal) => proposal.status === 'approved');
  const decided = proposals.filter((proposal) => proposal.status !== 'open' && proposal.status !== 'approved');
  const saved = savedMessage(params);
  const failed = one(params, 'failed');

  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.proposals} />
        </h1>
        <p className="muted">
          <Bi
            en="When a rule fires, the app drafts a proposal with an order list and stops there (L2): you approve, edit or dismiss it, place the orders at your broker yourself, then record the trades and mark it filled. The rules are checked after every nightly price update, or now with the button."
            zh="規則觸發時，App 會產生附建議下單清單的提案，然後停下來（L2）：由你核准、修改或略過，自己到券商下單，再登錄交易並標記為已成交。每晚價格更新後會檢查規則，也可以按下方按鈕立即檢查。"
          />
        </p>
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
        <div className="row">
          <form action={checkRules}>
            <button type="submit" className="button primary">
              <Bi en="Check the rules now" zh="立即檢查規則" />
            </button>
          </form>
          <Link href="/rules" className="button">
            <Bi en="Rules and thresholds" zh="規則與門檻" />
          </Link>
        </div>
      </section>

      <section className="card form">
        <h2>
          <Bi en={`Open (${open.length})`} zh={`待處理（${open.length}）`} />
        </h2>
        {open.length === 0 ? (
          <p className="muted">
            <Bi en="No open proposals: no rule needs a decision now." zh="沒有待處理的提案：目前沒有需要決定的事。" />
          </p>
        ) : (
          open.map((proposal) => <OpenProposal key={proposal.id} proposal={proposal} rule={ruleOf(proposal)} names={names} />)
        )}
      </section>

      {approved.length > 0 && (
        <section className="card form">
          <h2>
            <Bi en={`Approved, to trade (${approved.length})`} zh={`已核准，待下單（${approved.length}）`} />
          </h2>
          {approved.map((proposal) => (
            <ApprovedProposal key={proposal.id} proposal={proposal} rule={ruleOf(proposal)} names={names} />
          ))}
        </section>
      )}

      <section className="card form">
        <h2>
          <Bi en="Decided and closed" zh="已決定與已關閉" />
        </h2>
        <Decided proposals={decided} ruleOf={ruleOf} />
      </section>
    </>
  );
}

function Heading({ proposal, rule }: { proposal: Proposal; rule: RuleLike }) {
  return (
    <div className="row spread">
      <h3>
        <Bi {...proposalTitle(rule)} />
      </h3>
      <span className="muted small">
        #{proposal.id} · <TaipeiTime at={proposal.createdAt} />
      </span>
    </div>
  );
}

function Why({ proposal, rule, names }: { proposal: Proposal; rule: RuleLike; names: ReadonlyMap<string, Bilingual> }) {
  return (
    <ul className="formula">
      {whyLines(rule, proposal.detail, names).map((line) => (
        <li key={line.en}>
          <Bi {...line} />
        </li>
      ))}
    </ul>
  );
}

const ACTION: Record<DraftOrder['side'], Bilingual> = {
  buy: { en: 'Buy', zh: '買進' },
  sell: { en: 'Sell', zh: '賣出' },
  deposit: { en: 'Put in', zh: '存入' },
  withdraw: { en: 'Take out', zh: '轉出' },
};

/** Where to record an order once traded: the trade form filled in, or the balance's edit page. */
function recordLink(order: DraftOrder, proposalId: number): string {
  if (order.kind === 'balance') return `/assets/${order.assetId}`;
  const query = new URLSearchParams({ ticker: order.ticker, side: order.side, qty: String(order.qty), pool: 'regular', proposal: String(proposalId) });
  return `/holdings/new?${query.toString()}`;
}

function Orders({ proposal, checklist }: { proposal: Proposal; checklist?: boolean }) {
  const { orders } = proposal;
  if (orders.length === 0) {
    return (
      <p className="muted">
        <Bi en="No orders: nothing to trade, only to review." zh="沒有下單清單：只需檢視，不必交易。" />
      </p>
    );
  }
  const { sold, bought } = orderTotals(orders);
  return (
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
              <Bi en="Price (latest close)" zh="價格（最近收盤）" />
            </th>
            <th className="num">
              <Bi en="Amount (TWD)" zh="金額（台幣）" />
            </th>
            <th className="num">
              <Bi en="Est. fee" zh="預估費用" />
            </th>
            {checklist && (
              <th>
                <Bi en="Once traded" zh="成交後" />
              </th>
            )}
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
              <td className="num">—</td>
              {checklist && (
                <td>
                  <Link href={recordLink(order, proposal.id)}>
                    <Bi {...(order.kind === 'trade' ? { en: 'Record the trade', zh: '登錄交易' } : { en: 'Update the balance', zh: '修改餘額' })} />
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>
              <Bi en="Money out of sales and balances; money into purchases" zh="賣出與轉出的金額；買進與存入的金額" />
            </td>
            <td className="num nowrap">
              {twd(sold)} / {twd(bought)}
            </td>
            <td />
            {checklist && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DismissForm({ proposal, label }: { proposal: Proposal; label: Bilingual }) {
  return (
    <form action={dismissProposal} className="row">
      <input type="hidden" name="id" value={proposal.id} />
      <label className="field">
        <Bi en="Reason (optional)" zh="理由（選填）" />
        <input name="reason" maxLength={500} autoComplete="off" />
      </label>
      <button type="submit" className="button">
        <Bi {...label} />
      </button>
    </form>
  );
}

function OpenProposal({ proposal, rule, names }: { proposal: Proposal; rule: RuleLike; names: ReadonlyMap<string, Bilingual> }) {
  return (
    <article id={`proposal-${proposal.id}`} className="proposal form">
      <Heading proposal={proposal} rule={rule} />
      <Why proposal={proposal} rule={rule} names={names} />
      <Orders proposal={proposal} />
      <p className="muted small">
        <Bi
          en={`Fees are estimated once F15 is built (step 11). ${proposal.expiresAt ? 'Unless acted on, it closes on ' : ''}`}
          zh={`費用在 F15 完成後估算（第 11 步）。${proposal.expiresAt ? '若未處理，將於以下時間關閉：' : ''}`}
        />
        {proposal.expiresAt && <TaipeiTime at={proposal.expiresAt} />}
      </p>
      <div className="row">
        <form action={approveProposal}>
          <input type="hidden" name="id" value={proposal.id} />
          <button type="submit" className="button primary">
            <Bi en="Approve" zh="核准" />
          </button>
        </form>
        {proposal.orders.length > 0 && (
          <Link href={`/proposals/${proposal.id}`} className="button">
            <Bi en="Edit the orders" zh="修改下單清單" />
          </Link>
        )}
      </div>
      <DismissForm proposal={proposal} label={{ en: 'Dismiss', zh: '略過' }} />
    </article>
  );
}

function ApprovedProposal({ proposal, rule, names }: { proposal: Proposal; rule: RuleLike; names: ReadonlyMap<string, Bilingual> }) {
  return (
    <article id={`proposal-${proposal.id}`} className="proposal form">
      <Heading proposal={proposal} rule={rule} />
      <p>
        <Bi
          en="Execution checklist: place each order at your broker, then record it here, or import the broker's statement CSV. Mark the proposal filled once they are in."
          zh="執行清單：到券商逐筆下單，再在此登錄，或匯入券商對帳單 CSV。全部登錄後，把提案標記為已成交。"
        />
      </p>
      <Orders proposal={proposal} checklist />
      <details>
        <summary>
          <Bi en="Why it was proposed" zh="提案原因" />
        </summary>
        <Why proposal={proposal} rule={rule} names={names} />
      </details>
      <form action={markFilled}>
        <input type="hidden" name="id" value={proposal.id} />
        <button type="submit" className="button primary">
          <Bi en="Mark filled" zh="標記為已成交" />
        </button>
      </form>
      <DismissForm proposal={proposal} label={{ en: 'Cancel it', zh: '取消提案' }} />
    </article>
  );
}

function Decided({ proposals, ruleOf }: { proposals: readonly Proposal[]; ruleOf: (proposal: Proposal) => RuleLike }) {
  if (proposals.length === 0) {
    return (
      <p className="muted">
        <Bi en="None yet." zh="尚無紀錄。" />
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th>#</th>
            <th>
              <Bi en="Proposal" zh="提案" />
            </th>
            <th>
              <Bi en="Status" zh="狀態" />
            </th>
            <th>
              <Bi en="Drafted" zh="產生時間" />
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
                {proposal.dismissReason && <span className="muted small"> “{proposal.dismissReason}”</span>}
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
