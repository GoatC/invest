import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadProposal, loadRules, type Proposal, type RuleRecord } from '@/lib/data';
import { parseId } from '@/lib/forms';
import { proposalTitle, STATUS } from '@/lib/proposal-text';

import { OrdersForm } from '../orders-form';

/** Edit an open proposal's orders before approving it (PRD Section 4, L2 step 4). */
export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireSession();
  const id = parseId((await params).id);
  if (id === undefined) notFound();
  let proposal: Proposal | undefined;
  let rules: RuleRecord[];
  try {
    [proposal, rules] = await Promise.all([loadProposal(supabase, id), loadRules(supabase)]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  if (!proposal) notFound();
  const rule = rules.find((candidate) => candidate.id === proposal.ruleId) ?? { id: proposal.ruleId, condition: '' };

  return (
    <section className="card form">
      <h1>
        <Zh en="Edit the orders" zh="修改下單清單" />
      </h1>
      <p className="muted">
        <Bi {...proposalTitle(rule)} /> · #{proposal.id}
      </p>
      {proposal.status !== 'open' ? (
        <>
          <p className="banner warn">
            <Bi en="Only an open proposal can be edited; this one is:" zh="只有待處理的提案可以修改；這份提案目前是：" /> <Bi {...STATUS[proposal.status]} />
          </p>
          <Link href="/#proposals">
            <Bi en="Back to the proposals" zh="回到提案" />
          </Link>
        </>
      ) : (
        <>
          <p className="muted small">
            <Bi
              en="Change how many shares to trade, or how much to move for a balance. The amounts use the latest close and FX rate the proposal was drafted with; your broker's price will differ a little."
              zh="修改要交易的股數，或餘額要轉出／存入的金額。金額以提案產生時的最近收盤價與匯率計算，實際成交價會略有不同。"
            />
          </p>
          <OrdersForm id={proposal.id} orders={proposal.orders} />
        </>
      )}
    </section>
  );
}
