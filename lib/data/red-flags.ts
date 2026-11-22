/**
 * N3 red-flag indicator: company profiles, manual entries, scans and the settings.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { addDays } from '../dates';
import type { EngineInput } from '../models/engine';
import { buildPortfolio } from '../models/portfolio';
import { assess, EVENT_INDICATORS, readRedFlagSettings, readScans, scanDue, scanRows, type Assessment, type CompanyInput, type EventIndicator, type FlagEvent, type ManualEntry, type ManualIndicator, type Profile, type RedFlagSettings, type Scan } from '../models/red-flags';
import type { Market } from '../models/types';
import { allRows, DataError, rows } from './core';
import { loadHoldingsData, type HoldingsData, type SecurityRecord } from './holdings';
import { loadQuarters } from './valuation';

/** A company profile as saved, with what the nightly job needs to update it. */
export interface ProfileRecord extends Profile {
  ticker: string;
  businessId: string | null;
  source: string;
}

interface ProfileRow {
  ticker: string;
  industry_code: string | null;
  industry: string | null;
  sic: number | null;
  auditor: string | null;
  business_id: string | null;
  checked: unknown;
  source: string;
}

const PROFILE_COLUMNS = 'ticker, industry_code, industry, sic, auditor, business_id, checked, source';

function readChecked(value: unknown): Profile['checked'] {
  const out: Profile['checked'] = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!(EVENT_INDICATORS as readonly string[]).includes(key) || typeof entry !== 'object' || entry === null) continue;
    const { on, since } = entry as Record<string, unknown>;
    if (typeof on === 'string') out[key as EventIndicator] = { on, ...(typeof since === 'string' ? { since } : {}) };
  }
  return out;
}

export function toProfile(row: ProfileRow): ProfileRecord {
  return {
    ticker: row.ticker,
    industryCode: row.industry_code,
    industry: row.industry,
    sic: row.sic === null ? null : Number(row.sic),
    auditor: row.auditor,
    businessId: row.business_id,
    checked: readChecked(row.checked),
    source: row.source,
  };
}

/** The columns a profile is saved with. */
export function profileColumns(profile: ProfileRecord): ProfileRow & { updated_at: string } {
  return {
    ticker: profile.ticker,
    industry_code: profile.industryCode,
    industry: profile.industry,
    sic: profile.sic,
    auditor: profile.auditor,
    business_id: profile.businessId,
    checked: profile.checked,
    source: profile.source,
    updated_at: new Date().toISOString(),
  };
}

export interface EntryRecord extends ManualEntry {
  ticker: string;
}

const ENTRY_COLUMNS = 'id, ticker, indicator, as_of, value, note';

async function loadRedFlagSettingsUncached(supabase: SupabaseClient): Promise<RedFlagSettings | undefined> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'red_flags'));
  return readRedFlagSettings(found[0]?.value);
}

/** The single stocks N3 lights: held, or actively watched. */
async function flagSecurities(supabase: SupabaseClient, holdings?: HoldingsData): Promise<{ securities: SecurityRecord[]; held: Set<string>; watched: Set<string>; data: HoldingsData }> {
  const [data, watchRows] = await Promise.all([holdings ?? loadHoldingsData(supabase), rows<{ ticker: string; active: boolean }>('watchlist', supabase.from('watchlist').select('ticker, active'))]);
  const held = new Set(buildPortfolio(data).holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])));
  const watched = new Set(watchRows.filter((row) => row.active).map((row) => row.ticker));
  return { securities: data.securities.filter((security) => security.productType === 'stock' && (held.has(security.ticker) || watched.has(security.ticker))), held, watched, data };
}

/** Saved scans since `from`, per ticker, newest first. */
async function loadScans(supabase: SupabaseClient, tickers: readonly string[], from: string): Promise<Map<string, Scan[]>> {
  if (tickers.length === 0) return new Map();
  const found = await allRows<Parameters<typeof readScans>[0][number]>('red_flags', (start, end) =>
    supabase.from('red_flags').select('ticker, flag_date, indicator, value, level, coverage_pct, detail').in('ticker', [...tickers]).gte('flag_date', from).order('flag_date', { ascending: false }).order('id').range(start, end),
  );
  return readScans(found);
}

/** What the nightly job reads for N3: the companies, their saved profiles, and whether each is due a scan. Undefined before config red_flags. */
export async function loadRedFlagCompanies(supabase: SupabaseClient, today: string): Promise<{ settings: RedFlagSettings; companies: Array<{ ticker: string; market: Market; due: boolean; profile: ProfileRecord | null }> } | undefined> {
  const settings = await loadRedFlagSettings(supabase);
  if (!settings) return undefined;
  const { securities } = await flagSecurities(supabase);
  const tickers = securities.map((security) => security.ticker);
  const [profiles, newest] = await Promise.all([
    tickers.length ? rows<ProfileRow>('company_profiles', supabase.from('company_profiles').select(PROFILE_COLUMNS).in('ticker', tickers)) : Promise.resolve([]),
    tickers.length ? rows<{ ticker: string; flag_date: string }>('red_flags', supabase.from('red_flags').select('ticker, flag_date').in('ticker', tickers).gte('flag_date', addDays(today, -settings.scanDays * 2)).order('flag_date', { ascending: false })) : Promise.resolve([]),
  ]);
  const byTicker = new Map(profiles.map((row) => [row.ticker, toProfile(row)]));
  return {
    settings,
    companies: securities.map((security) => ({
      ticker: security.ticker,
      market: security.market,
      due: scanDue(newest.find((row) => row.ticker === security.ticker)?.flag_date, today, settings.scanDays),
      profile: byTicker.get(security.ticker) ?? null,
    })),
  };
}

export interface FlagCompany {
  security: SecurityRecord;
  held: boolean;
  watched: boolean;
  profile: ProfileRecord | null;
  events: FlagEvent[];
  entries: EntryRecord[];
  /** The indicators now, from the saved filings, events and entries. */
  assessment: Assessment;
  /** Saved weekly scans, newest first. */
  scans: Scan[];
}

export interface RedFlagData {
  settings: RedFlagSettings | undefined;
  companies: FlagCompany[];
}

/** Every company N3 lights, assessed now, with its saved scans of the last year. */
async function loadRedFlagDataUncached(supabase: SupabaseClient, today: string, only?: readonly string[], holdings?: HoldingsData): Promise<RedFlagData> {
  const [settings, { securities, held, watched, data }] = await Promise.all([loadRedFlagSettings(supabase), flagSecurities(supabase, holdings)]);
  if (!settings) return { settings, companies: [] };
  const chosen = securities.filter((security) => !only || only.includes(security.ticker));
  const tickers = chosen.map((security) => security.ticker);
  if (tickers.length === 0) return { settings, companies: [] };
  const [profiles, events, entries, quarters, scans] = await Promise.all([
    rows<ProfileRow>('company_profiles', supabase.from('company_profiles').select(PROFILE_COLUMNS).in('ticker', tickers)),
    rows<{ ticker: string; indicator: EventIndicator; event_date: string; source: string; title: string; url: string | null; value: number | null }>(
      'red_flag_events',
      supabase.from('red_flag_events').select('ticker, indicator, event_date, source, title, url, value').in('ticker', tickers).order('event_date', { ascending: false }),
    ),
    rows<{ id: number; ticker: string; indicator: ManualIndicator; as_of: string; value: number; note: string }>('red_flag_entries', supabase.from('red_flag_entries').select(ENTRY_COLUMNS).in('ticker', tickers).order('as_of', { ascending: false })),
    loadQuarters(supabase, tickers),
    loadScans(supabase, tickers, addDays(today, -366)),
  ]);
  const prices = new Map(data.prices.map((price) => [price.ticker, price]));
  const profileOf = new Map(profiles.map((row) => [row.ticker, toProfile(row)]));
  return {
    settings,
    companies: chosen
      .map((security) => {
        const profile = profileOf.get(security.ticker) ?? null;
        const mine = events.filter((row) => row.ticker === security.ticker).map((row): FlagEvent => ({ indicator: row.indicator, date: row.event_date, source: row.source, title: row.title, url: row.url, value: row.value === null ? null : Number(row.value) }));
        const typed = entries.filter((row) => row.ticker === security.ticker).map((row): EntryRecord => ({ id: Number(row.id), ticker: row.ticker, indicator: row.indicator, asOf: row.as_of, value: Number(row.value), note: row.note }));
        const filings = quarters.get(security.ticker);
        const price = prices.get(security.ticker);
        const input: CompanyInput = {
          ticker: security.ticker,
          market: security.market,
          quarters: filings?.quarters ?? [],
          reportCurrency: filings?.currency ?? null,
          price: price ? { close: price.close, date: price.date, currency: security.currency } : null,
          profile,
          events: mine,
          entries: typed,
        };
        return { security, held: held.has(security.ticker), watched: watched.has(security.ticker), profile, events: mine, entries: typed, assessment: assess(input, settings, today), scans: scans.get(security.ticker) ?? [] };
      })
      .sort((a, b) => Number(b.held) - Number(a.held) || a.security.ticker.localeCompare(b.security.ticker)),
  };
}

/** The weekly scan: each company asked for assessed now and saved as today's rows (upserted by day and indicator). */
export async function scanRedFlags(supabase: SupabaseClient, today: string, tickers: readonly string[]): Promise<{ scanned: string[] }> {
  if (tickers.length === 0) return { scanned: [] };
  const data = await loadRedFlagData(supabase, today, tickers);
  const out = data.companies.flatMap((company) => scanRows(company.assessment, today));
  for (let at = 0; at < out.length; at += 500) {
    const { error } = await supabase.from('red_flags').upsert(out.slice(at, at + 500), { onConflict: 'ticker,flag_date,indicator' });
    if (error) throw new DataError('red_flags', error.message);
  }
  return { scanned: data.companies.map((company) => company.security.ticker) };
}

/** What the two N3 rules read: each company's saved scans of the last half year; undefined before config red_flags. */
export async function loadFlagInputs(supabase: SupabaseClient, today: string, holdings: HoldingsData): Promise<EngineInput['redFlags']> {
  const settings = await loadRedFlagSettings(supabase);
  if (!settings) return undefined;
  const { securities } = await flagSecurities(supabase, holdings);
  const scans = await loadScans(supabase, securities.map((security) => security.ticker), addDays(today, -183));
  return [...scans.entries()].map(([ticker, list]) => ({ ticker, scans: list }));
}

// One read per request (core.ts).
export const loadRedFlagSettings = cache(loadRedFlagSettingsUncached);
export const loadRedFlagData = cache(loadRedFlagDataUncached);
