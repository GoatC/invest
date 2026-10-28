import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { Info } from '@/components/info';
import { ChangeList, HistorySection, TaipeiTime } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadEngineInput, loadRuleChanges, type OrderSettings, type Proposal, type RuleChange, type RuleRecord } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { CONDITIONS, evaluate, type Check, type EngineInput } from '@/lib/models/engine';
import { checkText, proposalTitle, STATUS } from '@/lib/proposal-text';

import { RuleForm, SettingsForm } from './forms';

type Params = Record<string, string | string[] | undefined>;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The rules engine's rules (PRD Section 4): what each found just now, its thresholds and their history. */
export default async function RulesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let input: EngineInput;
  let rules: RuleRecord[];
  let proposals: Proposal[];
  let changes: RuleChange[];
  let orders: OrderSettings;
  try {
    [{ input, rules, proposals, orders }, changes] = await Promise.all([loadEngineInput(supabase, today, new Date().toISOString()), loadRuleChanges(supabase)]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  // What each rule finds right now; nothing is saved from this page.
  const checks = new Map(evaluate(input).checks.map((check) => [check.ruleId, check]));
  const rank = (rule: RuleRecord) => {
    const index = (CONDITIONS as readonly string[]).indexOf(rule.condition);
    return index < 0 ? CONDITIONS.length : index;
  };
  const sorted = [...rules].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  const saved = typeof params['saved'] === 'string' ? params['saved'] : undefined;

  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.rules} />
        </h1>
        {saved && (
          <p className="banner ok" role="status">
            <Bi {...(saved === 'settings' ? { en: 'Settings saved.', zh: '已儲存設定。' } : { en: `${saved} saved; the change is logged below.`, zh: `已儲存 ${saved}；修改紀錄列於下方。` })} />
          </p>
        )}
        <p>
          <Link href="/proposals">
            <Bi en="Go to the proposals" zh="前往提案" />
          </Link>
        </p>
      </section>

      <section id="settings" className="card form">
        <h2>
          <Bi en="Monthly DCA, proposals and orders" zh="每月定期定額、提案與下單" />
        </h2>
        <SettingsForm
          initial={{
            dcaAmountTwd: input.dca.amountTwd === null ? '' : String(input.dca.amountTwd),
            dcaDay: input.dca.dayOfMonth === null ? '' : String(input.dca.dayOfMonth),
            expiryDays: input.expiryDays === null ? '' : String(input.expiryDays),
            fractionalUs: orders.fractionalMarkets.includes('US') ? 'on' : '',
            fractionalUk: orders.fractionalMarkets.includes('UK') ? 'on' : '',
            shareDecimals: String(orders.shareDecimals || 4),
          }}
        />
      </section>

      <section className="card form">
        <h2>
          <Bi en="Every rule" zh="所有規則" />
        </h2>
        {sorted.map((rule) => (
          <RuleRow key={rule.id} rule={rule} check={checks.get(rule.id)} proposals={proposals.filter((proposal) => proposal.ruleId === rule.id)} />
        ))}
      </section>

      <HistorySection title={{ en: 'Edit history of the rules', zh: '規則的修改紀錄' }} count={changes.length}>
        {changes.length === 0 ? (
          <p className="muted">
            <Bi en="No edits yet." zh="尚無修改紀錄。" />
          </p>
        ) : (
          <ul className="form">
            {changes.map((change) => (
              <li key={change.id}>
                <strong>{change.ruleId}</strong> <TaipeiTime at={change.changedAt} />
                <ChangeList changes={change.changes} />
              </li>
            ))}
          </ul>
        )}
      </HistorySection>
    </>
  );
}

/** Each finding at a glance: ✓ nothing to do, ! a proposal, ✕ broken, … not yet. */
const ICON: Record<Check['outcome'], [string, string]> = {
  fires: ['!', 'watch'],
  quiet: ['✓', 'ok'],
  covered: ['✓', 'ok'],
  waiting: ['…', 'idle'],
  unreadable: ['✕', 'rebalance'],
  off: ['–', 'idle'],
  later: ['…', 'idle'],
};

function RuleRow({ rule, check, proposals }: { rule: RuleRecord; check: Check | undefined; proposals: Proposal[] }) {
  const evaluated = check && check.outcome !== 'later';
  const live = proposals.find((proposal) => proposal.status === 'open' || proposal.status === 'approved');
  const title: Bilingual = evaluated ? proposalTitle(rule) : { en: `${rule.id} · ${rule.feature}`, zh: `${rule.id} · ${rule.feature}` };
  return (
    <article id={`rule-${rule.id}`} className="rule-row form">
      <div className="row spread">
        <h3>
          <Bi {...title} />
        </h3>
        <span className={rule.enabled ? 'badge' : 'badge warn'}>
          <Bi {...(rule.enabled ? { en: 'On', zh: '啟用' } : { en: 'Off', zh: '停用' })} />
        </span>
      </div>
      {check && (
        <p className={`rule-check ${check.outcome === 'fires' ? 'banner warn' : check.outcome === 'unreadable' ? 'banner danger' : 'muted'}`}>
          <span className={`status-icon ${ICON[check.outcome][1]}`} aria-hidden="true">
            {ICON[check.outcome][0]}
          </span>{' '}
          <Bi {...checkText(check, rule.condition)} />
          {live && (
            <>
              {' '}
              <Link href={`/proposals#proposal-${live.id}`}>
                <Bi en={`Proposal #${live.id}`} zh={`提案 #${live.id}`} />
              </Link>{' '}
              <span className="small">
                (<Bi {...STATUS[live.status]} />)
              </span>
            </>
          )}
        </p>
      )}
      <Info label={{ en: 'What it does', zh: '規則說明' }}>
        <Bi en={rule.descEn} zh={rule.descZh} />
      </Info>
      <details>
        <summary>
          <Bi en="Thresholds and cooldown" zh="門檻與冷卻期" />
        </summary>
        <p className="muted small">
          <Bi en={`Condition ${rule.condition}, action ${rule.action}. Stored threshold: `} zh={`判斷式 ${rule.condition}，動作 ${rule.action}。目前門檻：`} />
          <code>{JSON.stringify(rule.threshold)}</code>
        </p>
        <RuleForm id={rule.id} enabled={rule.enabled} cooldownDays={rule.cooldownDays} threshold={record(rule.threshold)} />
      </details>
    </article>
  );
}
