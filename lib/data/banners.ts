/**
 * The in-app banner (lib/models/banners.ts): what is saved that waits on Hugo, and its snoozes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { guideBanners, readBannerSettings, type Banner, type BannerSettings } from '../models/banners';
import { rows } from './core';
import { loadDividendView } from './dividends';
import { loadCashFlows, loadHoldingsData } from './holdings';
import { loadProposals } from './rules';
import { loadWindfallPlan } from './windfall';

/** config banners; undefined before its migration. */
async function loadBannerSettings(supabase: SupabaseClient): Promise<BannerSettings | undefined> {
  const [row] = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'banners'));
  return row ? readBannerSettings(row.value) : undefined;
}

/** How long ✕ hides a banner; undefined before config banners exists. */
export async function loadBannerSnooze(supabase: SupabaseClient): Promise<number | undefined> {
  return (await loadBannerSettings(supabase))?.snoozeDays;
}

/** The in-app banners needed now (lib/models/banners), the most pressing first; none before config banners exists. */
async function loadBannersUncached(supabase: SupabaseClient, today: string): Promise<Banner[]> {
  const settings = await loadBannerSettings(supabase);
  if (!settings?.enabled) return [];
  const [holdings, flows, dividends, plan, proposals, devices, dismissals] = await Promise.all([
    loadHoldingsData(supabase),
    loadCashFlows(supabase),
    loadDividendView(supabase, today),
    loadWindfallPlan(supabase),
    loadProposals(supabase, today),
    rows<{ id: number }>('push_subscriptions', supabase.from('push_subscriptions').select('id').limit(1)),
    rows<{ key: string; until: string }>('banner_dismissals', supabase.from('banner_dismissals').select('key, until').gt('until', today)),
  ]);
  const arrivals = flows.filter((flow) => flow.type === 'windfall');
  const cash = holdings.manualAssets.filter((asset) => asset.unit === 'TWD');
  return guideBanners(
    {
      dividends: dividends?.due ?? [],
      proposals: proposals.filter((proposal) => proposal.status === 'open').map((proposal) => ({ id: proposal.id })),
      windfall: {
        arrivedTwd: arrivals.reduce((sum, flow) => sum + flow.amountTwd, 0),
        lastArrival: arrivals.reduce<string | null>((newest, flow) => (newest === null || flow.flowDate > newest ? flow.flowDate : newest), null),
        cashTwd: cash.filter((asset) => asset.pool === 'windfall').reduce((sum, asset) => sum + asset.quantity, 0),
        traded: holdings.trades.some((trade) => trade.pool === 'windfall'),
        hasPlan: plan !== undefined,
      },
      balances: cash.map((asset) => ({ id: asset.id, name: asset.name, valuedOn: asset.valuedOn })),
      trades: holdings.trades.length,
      assets: holdings.manualAssets.length,
      devices: devices.length,
      dismissed: new Map(dismissals.map((row) => [row.key, row.until])),
    },
    settings,
    today,
  );
}

// One read per request (core.ts).
export const loadBanners = cache(loadBannersUncached);
