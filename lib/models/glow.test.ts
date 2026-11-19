import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { glowOf, milestoneOf, pageGlowOf, readGlowSettings } from './glow';

// The seeded config glow (supabase/migrations/20261121100000_glow.sql).
const SETTINGS = readGlowSettings({ flat_band_pct: 0.3, full_at_pct: 5, k_min: 0.4, k_flat: 0.55, milestone_step_twd: 100000 });
if (!SETTINGS) throw new Error('settings');

describe('readGlowSettings', () => {
  it('reads the seeded row', () => {
    assert.deepEqual(SETTINGS, { flatBandPct: 0.3, fullAtPct: 5, kMin: 0.4, kFlat: 0.55, milestoneStepTwd: 100000 });
  });

  it('refuses a missing field, a strength over 1, or a full point inside the flat band', () => {
    assert.equal(readGlowSettings({ flat_band_pct: 0.3, full_at_pct: 5, k_min: 0.4, k_flat: 0.55 }), undefined);
    assert.equal(readGlowSettings({ flat_band_pct: 0.3, full_at_pct: 5, k_min: 1.4, k_flat: 0.55, milestone_step_twd: 100000 }), undefined);
    assert.equal(readGlowSettings({ flat_band_pct: 5, full_at_pct: 5, k_min: 0.4, k_flat: 0.55, milestone_step_twd: 100000 }), undefined);
    assert.equal(readGlowSettings(null), undefined);
    assert.equal(readGlowSettings([]), undefined);
  });
});

describe('pageGlowOf', () => {
  // 02-components.md: Holdings at 0.45, toned by the last session; Performance at 0.5, by the difference against the benchmark.
  const withPages = readGlowSettings({ flat_band_pct: 0.3, full_at_pct: 5, k_min: 0.4, k_flat: 0.55, milestone_step_twd: 100000, page_k: { holdings: 0.45, performance: 0.5 } });

  it('reads each page’s strength, and leaves out one that is missing or out of range', () => {
    assert.deepEqual(withPages?.pageK, { holdings: 0.45, performance: 0.5 });
    assert.deepEqual(readGlowSettings({ flat_band_pct: 0.3, full_at_pct: 5, k_min: 0.4, k_flat: 0.55, milestone_step_twd: 100000, page_k: { holdings: 1.5, performance: 0.5 } })?.pageK, { performance: 0.5 });
    assert.equal(readGlowSettings({ flat_band_pct: 0.3, full_at_pct: 5, k_min: 0.4, k_flat: 0.55, milestone_step_twd: 100000, page_k: [] })?.pageK, undefined);
  });

  it('tones the wash like the poster but keeps the page’s fixed strength', () => {
    assert.deepEqual(pageGlowOf(1.23, 'holdings', withPages), { tone: 'up', k: 0.45 });
    assert.deepEqual(pageGlowOf(-6.8, 'holdings', withPages), { tone: 'down', k: 0.45 });
    assert.deepEqual(pageGlowOf(0.7, 'performance', withPages), { tone: 'up', k: 0.5 });
    assert.deepEqual(pageGlowOf(0.08, 'performance', withPages), { tone: 'flat', k: 0.5 });
    assert.deepEqual(pageGlowOf(null, 'performance', withPages), { tone: 'flat', k: 0.5 });
  });

  it('draws no wash without a strength in config', () => {
    assert.equal(pageGlowOf(1.23, 'holdings', SETTINGS), undefined);
    assert.equal(pageGlowOf(1.23, 'holdings', undefined), undefined);
  });
});

describe('glowOf', () => {
  // The acceptance values in docs/design-handoff/01-tokens.md.
  it('is flat within the band, at the flat strength', () => {
    assert.deepEqual(glowOf(0.08, SETTINGS), { tone: 'flat', k: 0.55 });
    assert.deepEqual(glowOf(-0.29, SETTINGS), { tone: 'flat', k: 0.55 });
  });

  it('grows with the move and is full from 5%', () => {
    assert.deepEqual(glowOf(1.23, SETTINGS), { tone: 'up', k: 0.519 });
    assert.deepEqual(glowOf(-6.8, SETTINGS), { tone: 'down', k: 1 });
    assert.deepEqual(glowOf(5, SETTINGS), { tone: 'up', k: 1 });
  });

  it('starts at k_min just past the band', () => {
    assert.deepEqual(glowOf(0.3, SETTINGS), { tone: 'up', k: 0.4 });
    assert.deepEqual(glowOf(-0.3, SETTINGS), { tone: 'down', k: 0.4 });
  });

  it('is flat with no move to read', () => {
    assert.deepEqual(glowOf(null, SETTINGS), { tone: 'flat', k: 0.55 });
    assert.deepEqual(glowOf(Number.NaN, SETTINGS), { tone: 'flat', k: 0.55 });
  });
});

describe('milestoneOf', () => {
  it('only records where the value stands the first time', () => {
    assert.deepEqual(milestoneOf(1234567, null, SETTINGS), { step: 1200000, celebrate: false });
  });

  it('celebrates passing a new NT$100,000 step', () => {
    assert.deepEqual(milestoneOf(1201000, 1100000, SETTINGS), { step: 1200000, celebrate: true });
  });

  it('does not celebrate the same step twice after a dip', () => {
    // 1,201,000 → 1,199,000 → 1,203,000: the 1,200,000 step was already celebrated.
    const dip = milestoneOf(1199000, 1200000, SETTINGS);
    assert.deepEqual(dip, { step: 1200000, celebrate: false });
    assert.deepEqual(milestoneOf(1203000, dip.step, SETTINGS), { step: 1200000, celebrate: false });
  });

  it('celebrates once when several steps are passed together', () => {
    assert.deepEqual(milestoneOf(1420000, 1200000, SETTINGS), { step: 1400000, celebrate: true });
  });
});
