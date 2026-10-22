/** Today's date in Taipei as YYYY-MM-DD; the app keeps Taipei time (PRD Sections 4 and 5). */
export function taipeiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The ISO date `days` days after `date` (before it, for a negative count). */
export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** True for a month written YYYY-MM. */
export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The YYYY-MM month `months` after `month` (before it, for a negative count). */
export function addMonths(month: string, months: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (number - 1) + months;
  const targetYear = Math.floor(index / 12);
  return `${String(targetYear).padStart(4, '0')}-${String(index - targetYear * 12 + 1).padStart(2, '0')}`;
}

/** How many months `to` is after `from`, both YYYY-MM. */
export function monthsBetween(from: string, to: string): number {
  const index = (month: string) => {
    const [year, number] = month.split('-').map(Number) as [number, number];
    return year * 12 + number - 1;
  };
  return index(to) - index(from);
}

/** The last day of a YYYY-MM month, as YYYY-MM-DD. */
export function lastDayOf(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}
