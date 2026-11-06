import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fomcEvents, fredCalendarEvents, fredCalendarUrl } from './events.ts';

// Shaped like the Fed's calendar page and FRED's release calendar on 2026-11-06.
const meeting = (month: string, days: string) =>
  `<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5"><strong>${month}</strong></div>\n<div class="fomc-meeting__date col-xs-4">${days}</div><div>Statement</div></div>`;
const FED = [
  '<div class="panel-heading"><h4><a id="45694">2027 FOMC Meetings</a></h4></div>',
  meeting('January', '26-27'),
  '<div class="panel-heading"><h4><a id="42828">2026 FOMC Meetings</a></h4></div>',
  meeting('June', '16-17*'),
  meeting('December', '8-9*'),
  '<div class="panel-heading"><h4><a id="1">2024 FOMC Meetings</a></h4></div>',
  meeting('Apr/May', '30-1'),
  '<div class="panel-heading"><h4><a id="2">2025 FOMC Meetings</a></h4></div>',
  meeting('August', '22 (notation vote)'),
].join('\n');

const row = (day: string, time: string) =>
  `<tr class="odd"><td text-align="left" colspan="2"><span style="font-weight: bold;">${day}</span> <span style="float: right; font-weight: bold;">Updated</span></td></tr>\n<tr><td nowrap style="width:5%; text-align:right">\n\n   ${time}   </td><td><a href="/release?rid=10">Consumer Price Index</a></td></tr>`;
const FRED = [row('Wednesday October 14, 2026', '7:30 am'), row('Tuesday November 10, 2026', '7:30 am')].join('\n');

describe('event feeds (N8 step 2)', () => {
  it("reads the Fed's meetings as each decision's Taipei time: the second day at 14:00 New York, across months, notation votes left out", () => {
    assert.deepEqual(
      fomcEvents(FED).map((event) => `${event.date} ${event.time} ${event.note ?? ''}`.trim()),
      ['2027-01-28 03:00', '2026-06-18 02:00 with projections 含經濟預測', '2026-12-10 03:00 with projections 含經濟預測', '2024-05-02 02:00'],
    );
    assert.equal(fomcEvents(FED)[0]?.source, 'fed');
  });

  it("reads FRED's calendar as Taipei times (Central Time on the page)", () => {
    assert.equal(fredCalendarUrl(10, 2026), 'https://fred.stlouisfed.org/releases/calendar?rid=10&y=2026');
    const events = fredCalendarEvents(FRED, 'cpi');
    assert.deepEqual(
      events.map((event) => `${event.date} ${event.time} ${event.name.zh}`),
      ['2026-10-14 20:30 美國 CPI', '2026-11-10 21:30 美國 CPI'],
    );
    assert.deepEqual(fredCalendarEvents('<p>No releases</p>', 'payrolls'), []);
  });
});
