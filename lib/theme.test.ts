import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readTheme, resolveTheme, THEME_COLOR, THEME_SCRIPT } from './theme';

describe('readTheme', () => {
  it('keeps the three choices and reads anything else as light', () => {
    assert.equal(readTheme('dark'), 'dark');
    assert.equal(readTheme('auto'), 'auto');
    assert.equal(readTheme('light'), 'light');
    for (const bad of [null, undefined, '', 'DARK', 'blue']) assert.equal(readTheme(bad), 'light');
  });
});

describe('resolveTheme', () => {
  it('follows the phone only for auto', () => {
    assert.equal(resolveTheme('auto', true), 'dark');
    assert.equal(resolveTheme('auto', false), 'light');
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
  });
});

/** Runs the head script against a stand-in document, localStorage and matchMedia, as a browser would before the first paint. */
function runScript(options: { stored?: string | null; throws?: boolean; prefersDark?: boolean; meta?: boolean }) {
  const dataset: Record<string, string> = {};
  const meta = { content: THEME_COLOR.light };
  const document = {
    documentElement: { dataset },
    querySelector: (selector: string) => (options.meta === false || selector !== 'meta[name="theme-color"]' ? null : meta),
  };
  const localStorage = {
    getItem: (key: string) => {
      if (options.throws) throw new Error('blocked');
      return key === 'theme' ? (options.stored ?? null) : null;
    },
  };
  const matchMedia = (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && options.prefersDark === true });
  new Function('document', 'localStorage', 'matchMedia', THEME_SCRIPT)(document, localStorage, matchMedia);
  return { theme: dataset['theme'], color: meta.content };
}

describe('THEME_SCRIPT', () => {
  it('marks dark before the first paint and sets the bar colour', () => {
    assert.deepEqual(runScript({ stored: 'dark' }), { theme: 'dark', color: THEME_COLOR.dark });
  });

  it('resolves auto from the phone', () => {
    assert.equal(runScript({ stored: 'auto', prefersDark: true }).theme, 'dark');
    assert.equal(runScript({ stored: 'auto', prefersDark: false }).theme, 'light');
  });

  it('paints light with nothing stored, even on a dark phone', () => {
    assert.deepEqual(runScript({ stored: null, prefersDark: true }), { theme: 'light', color: THEME_COLOR.light });
  });

  it('survives a throwing localStorage and a missing meta', () => {
    assert.equal(runScript({ throws: true, meta: false }).theme, 'light');
  });
});

describe('THEME_COLOR', () => {
  it('keeps the bar colours of each theme', () => {
    assert.deepEqual(THEME_COLOR, { light: '#fafbfa', dark: '#101613' });
  });
});
