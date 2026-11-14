import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MORE, SHELL_TABS, reminderPrefs, remindersMessage, shellMove, shellOpenUrl, shellState, shellTab, sitePath } from './shell';

describe('the iOS shell: what the page tells it and does for it', () => {
  it('lists the tabs as the web tab bar does, the dashboard in the middle and More last', () => {
    assert.deepEqual(
      SHELL_TABS.map((tab) => tab.key),
      ['/holdings', '/performance', '/', '/allocation', MORE],
    );
    assert.deepEqual(
      SHELL_TABS.map((tab) => tab.title),
      ['持倉', '績效', '儀表板', '配置', '更多'],
    );
  });

  it('names the tab a page belongs to: its own, a sub-tab, a page folded into it', () => {
    assert.equal(shellTab('/', false), '/');
    assert.equal(shellTab('/volatility', false), '/');
    assert.equal(shellTab('/holdings', false), '/holdings');
    assert.equal(shellTab('/valuation/AAPL', false), '/holdings');
    assert.equal(shellTab('/costs', false), '/performance');
    assert.equal(shellTab('/frontier', false), '/allocation');
  });

  it('names More on a page of a group, and while the list is open over any page', () => {
    assert.equal(shellTab('/plan', false), MORE);
    assert.equal(shellTab('/notifications', false), MORE);
    assert.equal(shellTab('/holdings', true), MORE);
  });

  it('names no tab on a page of neither a tab nor a group, and none signed out', () => {
    assert.equal(shellTab('/dividends', false), null);
    assert.equal(shellState('/login', false, false).tab, null);
    assert.equal(shellState('/login', false, false).signedIn, false);
  });

  it('sends the path, the tab and the tabs in one message', () => {
    assert.deepEqual(shellState('/attribution', false, true), { v: 1, signedIn: true, path: '/attribution', tab: '/performance', tabs: SHELL_TABS });
  });

  it('opens a tab from another page, from its own sub-page and from under the list', () => {
    assert.deepEqual(shellMove('/holdings', '/', false), { do: 'open', href: '/holdings' });
    assert.deepEqual(shellMove('/', '/volatility', false), { do: 'open', href: '/' });
    assert.deepEqual(shellMove('/performance', '/plan', true), { do: 'open', href: '/performance' });
  });

  it('goes to the top on a second tap, toggles the list on More, and ignores a tab it does not know', () => {
    assert.deepEqual(shellMove('/holdings', '/holdings', false), { do: 'top' });
    assert.deepEqual(shellMove('/holdings', '/holdings', true), { do: 'none' });
    assert.deepEqual(shellMove(MORE, '/holdings', false), { do: 'more' });
    assert.deepEqual(shellMove('/nowhere', '/', false), { do: 'none' });
  });
});

describe('the iOS shell: reminders on the phone and the way in from a push', () => {
  const reminders = [
    { id: 'weekly:2026-11-15', kind: 'weekly' as const, at: '2026-11-15T12:00:00.000Z', title: '每週檢視', body: '…', url: '/' },
    { id: 'event:cpi', kind: 'event' as const, at: '2026-11-18T00:00:00.000Z', title: '2 天後：美國 CPI', body: '…', url: '/volatility#events' },
    { id: 'dividend:7:regular', kind: 'dividend' as const, at: '2026-11-20T00:00:00.000Z', title: 'VT 配息', body: '…', url: '/cash-flows' },
  ];

  it('leaves the three the web app pushes off while a device gets its pushes, and the expiry reminder on', () => {
    assert.deepEqual(reminderPrefs(null, 1), { weekly: false, event: false, dividend: false, expiry: true });
    assert.deepEqual(reminderPrefs(undefined, 0), { weekly: true, event: true, dividend: true, expiry: true });
  });

  it('keeps what was chosen, and fills only what is missing or malformed', () => {
    assert.deepEqual(reminderPrefs({ weekly: true, expiry: false, event: 'yes' }, 2), { weekly: true, event: false, dividend: false, expiry: false });
  });

  it('hands the shell only the kinds chosen', () => {
    const message = remindersMessage(reminders, { weekly: true, event: false, dividend: true, expiry: false });
    assert.deepEqual(message.items.map((reminder) => reminder.id), ['weekly:2026-11-15', 'dividend:7:regular']);
    assert.equal(message.v, 1);
    assert.equal(message.expiry, false);
  });

  it('opens a page of the site in the shell, and refuses anything that is not one', () => {
    assert.equal(shellOpenUrl('/volatility#events'), 'longview://open?path=%2Fvolatility%23events');
    assert.equal(shellOpenUrl('/cash-flows?new=dividend&event=7'), 'longview://open?path=%2Fcash-flows%3Fnew%3Ddividend%26event%3D7');
    for (const bad of ['https://evil.example/', '//evil.example', 'volatility', '/\\evil', '']) assert.equal(shellOpenUrl(bad), null, bad);
    assert.equal(sitePath(null), null);
  });
});
