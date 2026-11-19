'use client';

import { useLayoutEffect, useRef } from 'react';

import { keepMilestone } from '@/app/actions';

/** The data date the opening sequence last played for, on this device. */
const INTRO_KEY = 'longview.intro.date';
/** The milestone step whose ring this device last played, so a page kept in memory does not play it twice. */
const RING_KEY = 'longview.milestone.played';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function keep(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export interface PosterMilestone {
  /** The step the value stands at, to keep on the server. */
  step: number;
  /** A new step: play the ring and the success haptic once. */
  celebrate: boolean;
  /** Whether the server should keep `step` (a new step, or the first time). */
  record: boolean;
}

/**
 * The poster's motion (Ink design, docs/design-handoff/04-motion.md). The opening sequence (the glow, the value rising,
 * the line drawing, today's dot and its ripple) plays on the first open after new data arrives, kept by its date in
 * localStorage; every other open shows the end state at once. The milestone ring plays once per NT$100,000 step, kept
 * on the server (app_state), with the shell's success haptic as it starts. The style sheet holds the animations, run
 * only under `.hero[data-intro]` and `.hero[data-milestone]` and paused while the opening screen is up; set before the
 * first paint here, so nothing shows its end state first. Reduce Motion cuts them to nothing.
 */
export function PosterMotion({ dataDate, milestone }: { dataDate: string; milestone: PosterMilestone | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const recorded = useRef<number | null>(null);
  useLayoutEffect(() => {
    const hero = ref.current?.closest<HTMLElement>('.hero');
    if (!hero) return undefined;
    if (read(INTRO_KEY) !== dataDate && keep(INTRO_KEY, dataDate)) hero.dataset.intro = '';

    if (!milestone) return undefined;
    const step = String(milestone.step);
    const ring = hero.querySelector<HTMLElement>('.hero-ring');
    let feel: (() => void) | undefined;
    if (milestone.celebrate && ring && read(RING_KEY) !== step && keep(RING_KEY, step)) {
      hero.dataset.milestone = '';
      feel = () => (window as { webkit?: { messageHandlers?: { haptic?: { postMessage(kind: string): void } } } }).webkit?.messageHandlers?.haptic?.postMessage('success');
      ring.addEventListener('animationstart', feel, { once: true });
    }
    if (milestone.record && recorded.current !== milestone.step) {
      recorded.current = milestone.step;
      void keepMilestone(milestone.step).catch(() => undefined);
    }
    return () => {
      if (feel) ring?.removeEventListener('animationstart', feel);
    };
  }, [dataDate, milestone]);
  return <span ref={ref} hidden />;
}
