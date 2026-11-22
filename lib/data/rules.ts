/**
 * The rules table, its edit log, and the proposals (standing warnings) the engine raised.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { addDays } from '../dates';
import { readDetail, readOrders, type ClosedReason, type DraftOrder, type EngineQuote, type EngineRule, type ProposalDetail, type ProposalRecord, type ProposalStatus } from '../models/engine';
import type { PortfolioData } from '../models/portfolio';
import { restateTrades } from '../models/splits';
import type { Market } from '../models/types';
import { latestFx, latestPrices } from '../models/valuation';
import { diffRows, type FieldChange } from './audit';
import { rows, setting } from './core';

/** A rule as the rules table holds it. */
export interface RuleRecord extends EngineRule {
  feature: string;
  descEn: string;
  descZh: string;
  action: string;
  updatedAt: string;
}

async function loadRulesUncached(supabase: SupabaseClient): Promise<RuleRecord[]> {
  const found = await rows<{
    id: string;
    feature: string;
    desc_en: string;
    desc_zh: string;
    condition: string;
    threshold: unknown;
    action: string;
    cooldown_days: number;
    enabled: boolean;
    updated_at: string;
  }>('rules', supabase.from('rules').select('id, feature, desc_en, desc_zh, condition, threshold, action, cooldown_days, enabled, updated_at').order('id'));
  return found.map((row) => ({
    id: row.id,
    feature: row.feature,
    descEn: row.desc_en,
    descZh: row.desc_zh,
    condition: row.condition,
    threshold: row.threshold,
    action: row.action,
    cooldownDays: Number(row.cooldown_days),
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }));
}

/** One edit to a rule, from rule_changes. */
export interface RuleChange {
  id: number;
  ruleId: string;
  changedAt: string;
  changes: FieldChange[];
}

export async function loadRuleChanges(supabase: SupabaseClient): Promise<RuleChange[]> {
  const found = await rows<{ id: number; rule_id: string; changed_at: string; old_value: Record<string, unknown>; new_value: Record<string, unknown> }>(
    'rule_changes',
    supabase.from('rule_changes').select('id, rule_id, changed_at, old_value, new_value').order('changed_at', { ascending: false }).order('id', { ascending: false }).limit(200),
  );
  return found.map((row) => ({ id: row.id, ruleId: row.rule_id, changedAt: row.changed_at, changes: diffRows(row.old_value, row.new_value) }));
}

/** A saved proposal. */
export interface Proposal extends ProposalRecord {
  orders: DraftOrder[];
  detail: ProposalDetail;
  dismissReason: string | null;
  decidedAt: string | null;
  filledAt: string | null;
  closedReason: ClosedReason | null;
}

const PROPOSAL_COLUMNS = 'id, rule_id, state, status, created_at, expires_at, orders, detail, dismiss_reason, decided_at, filled_at, closed_reason';

interface ProposalRow {
  id: number;
  rule_id: string;
  state: string;
  status: ProposalStatus;
  created_at: string;
  expires_at: string | null;
  orders: unknown;
  detail: unknown;
  dismiss_reason: string | null;
  decided_at: string | null;
  filled_at: string | null;
  closed_reason: ClosedReason | null;
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: Number(row.id),
    ruleId: row.rule_id,
    state: row.state,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    orders: readOrders(row.orders),
    detail: readDetail(row.detail),
    dismissReason: row.dismiss_reason,
    decidedAt: row.decided_at,
    filledAt: row.filled_at,
    closedReason: row.closed_reason,
  };
}

/** How far back the engine and the page read decided proposals: past a year's review. */
const PROPOSAL_DAYS = 400;

/** Every open proposal (a standing warning), and the others of the last 400 days, newest first. */
async function loadProposalsUncached(supabase: SupabaseClient, today: string): Promise<Proposal[]> {
  const since = addDays(today, -PROPOSAL_DAYS);
  const found = await rows<ProposalRow>(
    'proposals',
    supabase
      .from('proposals')
      .select(PROPOSAL_COLUMNS)
      .or(`status.eq.open,created_at.gte.${since}`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
  );
  return found.map(toProposal);
}

export async function loadProposal(supabase: SupabaseClient, id: number): Promise<Proposal | undefined> {
  const [row] = await rows<ProposalRow>('proposals', supabase.from('proposals').select(PROPOSAL_COLUMNS).eq('id', id));
  return row ? toProposal(row) : undefined;
}

/** How share counts are rounded in draft orders (config orders): fractions for these markets, to these decimals. */
export interface OrderSettings {
  fractionalMarkets: Market[];
  shareDecimals: number;
}

/** config orders, read defensively: without it, every order is in whole shares. */
export function orderSettings(value: unknown): OrderSettings {
  const markets = setting(value, 'fractional_markets');
  const decimals = setting(value, 'share_decimals');
  return {
    fractionalMarkets: Array.isArray(markets) ? markets.filter((market): market is Market => market === 'US' || market === 'UK' || market === 'TW') : [],
    shareDecimals: typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 1 && decimals <= 4 ? decimals : 0,
  };
}

/** The latest close and TWD rate of every security that has both, with the decimals its orders may have. */
export function engineQuotes(data: PortfolioData, orders: OrderSettings = { fractionalMarkets: [], shareDecimals: 0 }): Map<string, EngineQuote> {
  const prices = latestPrices(data.prices, restateTrades(data.trades, data.splits));
  const fx = latestFx(data.fx, data.trades);
  const out = new Map<string, EngineQuote>();
  for (const security of data.securities) {
    const price = prices.get(security.ticker);
    const rate = fx.get(security.currency);
    const decimals = orders.fractionalMarkets.includes(security.market) ? orders.shareDecimals : 0;
    if (price && rate) out.set(security.ticker, { price: price.value, currency: security.currency, fxRate: rate.value, decimals });
  }
  return out;
}

// One read per request (core.ts).
export const loadRules = cache(loadRulesUncached);
export const loadProposals = cache(loadProposalsUncached);
