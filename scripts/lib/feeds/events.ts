/**
 * The event calendar's feeds (N8 step 2): the FOMC meetings on the Fed's calendar page, and US CPI
 * and the jobs report on FRED's release calendar (BLS's own schedule refuses scripts). Each event
 * is turned into Taipei's date and time (lib/models/events).
 */
import { clock24, KIND_NAMES, toTaipei, type MarketEvent } from '../../../lib/models/events.ts';

export const FED_CALENDAR = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthNumber(name: string): number | undefined {
  const key = name.trim().toLowerCase();
  const index = MONTHS.findIndex((month) => month === key || month.slice(0, 3) === key.slice(0, 3));
  return index < 0 ? undefined : index + 1;
}

/**
 * Each meeting's rate decision: the second day (a range "17-18", across months "Apr/May 30-1"),
 * at 14:00 New York. A notation vote or an unscheduled call has no range and is left out; "*"
 * marks a meeting with the Summary of Economic Projections.
 */
export function fomcEvents(html: string): MarketEvent[] {
  const out: MarketEvent[] = [];
  let year: number | undefined;
  for (const match of html.matchAll(/<h4><a id="\d+">(\d{4}) FOMC Meetings<\/a><\/h4>|fomc-meeting__month[^>]*><strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g)) {
    if (match[1]) {
      year = Number(match[1]);
      continue;
    }
    if (!year) continue;
    const range = /^\s*(\d{1,2})\s*-\s*(\d{1,2})(\*?)/.exec(match[3] ?? '');
    if (!range) continue;
    const months = (match[2] ?? '').split('/');
    const month = monthNumber(months[months.length - 1] ?? '');
    if (!month) continue;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(Number(range[2])).padStart(2, '0')}`;
    const taipei = toTaipei(date, '14:00', 'America/New_York');
    out.push({ kind: 'fomc', date: taipei.date, time: taipei.time, name: KIND_NAMES.fomc, source: 'fed', note: range[3] ? 'with projections 含經濟預測' : null });
  }
  return out;
}

/** FRED's release ids: the Consumer Price Index and the Employment Situation. */
export const FRED_RELEASES = { cpi: 10, payrolls: 50 } as const;

export function fredCalendarUrl(release: number, year: number): string {
  return `https://fred.stlouisfed.org/releases/calendar?rid=${release}&y=${year}`;
}

/** FRED's calendar rows: a bold "Tuesday November 10, 2026", then the time "7:30 am" (Central Time). */
export function fredCalendarEvents(html: string, kind: 'cpi' | 'payrolls'): MarketEvent[] {
  const out: MarketEvent[] = [];
  for (const match of html.matchAll(/font-weight: bold;">\w+day (\w+) (\d{1,2}), (\d{4})<\/span>[\s\S]*?<td nowrap[^>]*>\s*([\d:]+\s*[ap]m)\s*<\/td>/gi)) {
    const month = monthNumber(match[1] ?? '');
    const time = clock24(match[4] ?? '');
    if (!month || !time) continue;
    const date = `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
    const taipei = toTaipei(date, time, 'America/Chicago');
    out.push({ kind, date: taipei.date, time: taipei.time, name: KIND_NAMES[kind], source: 'fred', note: null });
  }
  return out;
}
