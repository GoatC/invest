import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MORE, SHELL_TABS, shellMove, shellState, shellTab } from './shell';

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
