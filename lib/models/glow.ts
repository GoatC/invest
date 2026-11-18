/**
 * The Ink (甲) design's direction glow and milestones (docs/design-handoff/01-tokens.md, 04-motion.md).
 *
 * The poster glows in the colour of the 7-day move: within the flat band it is the forget-me-not "flat" glow at a
 * fixed strength; beyond it, red or green, stronger with the size of the move, full at `fullAtPct`. The page applies
 * the strength `k` as the glow layer's opacity. A milestone is the total value passing a new multiple of
 * `milestoneStepTwd`; each step is celebrated once, so a fall below a step and a rise past it again celebrates nothing.
 *
 * Every threshold comes from config `glow` (CLAUDE.md: thresholds live in the config table, never in code).
 */

export type GlowTone = 'up' | 'down' | 'flat';

export interface GlowSettings {
  /** A move whose size is under this many percent is flat. */
  flatBandPct: number;
  /** A move of this many percent or more glows at full strength. */
  fullAtPct: number;
  /** The strength just past the flat band. */
  kMin: number;
  /** The strength of the flat glow. */
  kFlat: number;
  /** The total value is celebrated each time it passes a new multiple of this (TWD). */
  milestoneStepTwd: number;
}

/** config glow; undefined before its migration or when malformed. */
export function readGlowSettings(value: unknown): GlowSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const number = (found: unknown, min: number, max: number) => (typeof found === 'number' && Number.isFinite(found) && found >= min && found <= max ? found : undefined);
  const flatBandPct = number(row['flat_band_pct'], 0, 100);
  const fullAtPct = number(row['full_at_pct'], 0, 100);
  const kMin = number(row['k_min'], 0, 1);
  const kFlat = number(row['k_flat'], 0, 1);
  const milestoneStepTwd = number(row['milestone_step_twd'], 1, 1e12);
  if (flatBandPct === undefined || fullAtPct === undefined || kMin === undefined || kFlat === undefined || milestoneStepTwd === undefined) return undefined;
  if (fullAtPct <= flatBandPct) return undefined;
  return { flatBandPct, fullAtPct, kMin, kFlat, milestoneStepTwd };
}

export interface Glow {
  tone: GlowTone;
  /** 0–1: the glow layer's opacity. */
  k: number;
}

/**
 * The glow for a move given in percent (+1.23 for a 1.23% rise). A move that is not a finite number (no history yet)
 * is flat. Rounded to three places so the page's style stays stable between renders.
 */
export function glowOf(movePct: number | null | undefined, settings: GlowSettings): Glow {
  if (movePct === null || movePct === undefined || !Number.isFinite(movePct)) return { tone: 'flat', k: settings.kFlat };
  const size = Math.abs(movePct);
  if (size < settings.flatBandPct) return { tone: 'flat', k: settings.kFlat };
  const share = (size - settings.flatBandPct) / (settings.fullAtPct - settings.flatBandPct);
  const k = Math.min(1, settings.kMin + (1 - settings.kMin) * share);
  return { tone: movePct > 0 ? 'up' : 'down', k: Math.round(k * 1000) / 1000 };
}

export interface Milestone {
  /** The step to keep as the last one celebrated (TWD). */
  step: number;
  /** Whether this step is new: play the ring and the success haptic once. */
  celebrate: boolean;
}

/**
 * The milestone for a total value, given the last step already celebrated (null before the first time, which only
 * records where the value stands: nothing is celebrated for money already there).
 */
export function milestoneOf(totalTwd: number, lastStepTwd: number | null, settings: Pick<GlowSettings, 'milestoneStepTwd'>): Milestone {
  const step = Math.floor(Math.max(0, totalTwd) / settings.milestoneStepTwd) * settings.milestoneStepTwd;
  if (lastStepTwd === null) return { step, celebrate: false };
  if (step > lastStepTwd) return { step, celebrate: true };
  return { step: lastStepTwd, celebrate: false };
}
