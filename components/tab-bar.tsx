'use client';

import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import { MAIN, matches, name, type Page } from './nav-pages';

/**
 * The phone's tab bar (Hugo, 2026-11-13): a capsule of glass that floats over the page, after
 * iOS's Liquid Glass. Apple's own material is open to native apps only, so this one is built from
 * what a web page is given: the page behind it is blurred live by the browser (backdrop-filter),
 * and the selection is a lens moved by springs, not by fixed curves. A finger laid on the bar
 * lifts the lens; it follows the finger from tab to tab, stretching with its speed, and settles
 * with a small overshoot on the tab it is let go over, which opens. Scrolling down shrinks the bar
 * to its icons, scrolling up brings the names back. The dashboard, the home screen, stays in the
 * middle as the raised round button in the accent colour; chosen, the lens rings it. With "reduce
 * motion" on, the lens moves without springs and the bar keeps its size.
 */

/** Left to right; the fifth place is the "More" button. */
const TABS: ReadonlyArray<{ page: Page; short: string; icon: ReactNode; home?: boolean }> = [
  {
    page: MAIN[1]!,
    short: '持倉',
    icon: (
      <>
        <rect x="3" y="4" width="16" height="14" rx="2" />
        <path d="M3 9 H19 M8 9 V18" />
      </>
    ),
  },
  { page: MAIN[2]!, short: '績效', icon: <path d="M3 16 L9 10 L12.5 13.5 L19 7 M14.5 7 H19 V11.5" /> },
  { page: MAIN[0]!, short: '儀表板', home: true, icon: <path d="M3 10 L11 3.5 L19 10 V18.5 H13.5 V13.5 H8.5 V18.5 H3 Z" /> },
  {
    page: MAIN[3]!,
    short: '配置',
    icon: (
      <>
        <circle cx="11" cy="11" r="7.5" />
        <path d="M11 3.5 V11 H18.5" />
      </>
    ),
  },
];
const MORE = TABS.length;

/** Lights up the moment a tab is tapped, while the server prepares a page not yet kept (globals.css .link-pending). */
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="link-pending" data-pending aria-hidden="true" /> : null;
}

/** One value on a spring: where it is, how fast it moves, where it is headed. */
interface Spring {
  at: number;
  speed: number;
  to: number;
}

/** A finger must travel this far before a press counts as a drag, not a tap. */
const DRAG_PX = 8;
/** The lens settling on a tab: quick, with a small overshoot. */
const SETTLE = { stiffness: 420, damping: 30 };
/** The lens under a finger: stiff enough to stay with it, soft enough to trail. */
const FOLLOW = { stiffness: 900, damping: 52 };
/** How far the page must scroll one way before the bar shrinks or grows back. */
const SCROLL_PX = 12;

export function TabBar({ path, sheet, inGroup, onMore }: { path: string; sheet: boolean; inGroup: boolean; onMore: () => void }) {
  const router = useRouter();
  const nav = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  const tab = TABS.findIndex(({ page }) => matches(page, path));
  const selected = sheet || inGroup ? MORE : tab;
  /** The engine below reads these each time it needs them, so it is set up once. */
  const live = useRef({ selected, onMore, router });
  live.current = { selected, onMore, router };
  const retarget = useRef<() => void>(() => {});

  useEffect(() => {
    const bar = nav.current;
    const glass = lens.current;
    if (!bar || !glass) return undefined;
    const slots = [...bar.querySelectorAll<HTMLElement>(':scope > a, :scope > button')];
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const x: Spring = { at: 0, speed: 0, to: 0 };
    const y: Spring = { at: 0, speed: 0, to: 0 };
    const w: Spring = { at: 0, speed: 0, to: 0 };
    const h: Spring = { at: 0, speed: 0, to: 0 };
    const lift: Spring = { at: 0, speed: 0, to: 0 };
    const springs = [x, y, w, h, lift];
    let frame = 0;
    let last = 0;
    let placed = false;
    /** The tab the lens rests on: the page's, or the one just let go over until its page shows. */
    let resting = live.current.selected;
    /** While a finger is down: where it started, and whether it has become a drag. */
    let press: { startX: number; dragging: boolean; over: number } | null = null;
    let swallowClick = false;

    /** The lens's box on a tab: the tab's own place in the bar, or a ring round the raised button. */
    const boxOf = (index: number) => {
      const slot = slots[index];
      if (!slot) return null;
      const outer = bar.getBoundingClientRect();
      if (slot.classList.contains('tab-home')) {
        const button = slot.querySelector('.tab-icon')!.getBoundingClientRect();
        const size = button.width + 12;
        return { x: button.left + button.width / 2 - outer.left, y: button.top + button.height / 2 - outer.top, w: size, h: size };
      }
      const rect = slot.getBoundingClientRect();
      return { x: rect.left + rect.width / 2 - outer.left, y: outer.height / 2, w: rect.width - 4, h: outer.height - 8 };
    };

    const nearest = (clientX: number) => {
      let best = 0;
      let distance = Infinity;
      slots.forEach((slot, index) => {
        const rect = slot.getBoundingClientRect();
        const d = Math.abs(clientX - (rect.left + rect.width / 2));
        if (d < distance) [best, distance] = [index, d];
      });
      return best;
    };

    const draw = () => {
      // Stretched along its way, by its speed: the faster it runs, the longer and flatter it is.
      const stretch = still.matches ? 0 : Math.min(Math.abs(x.speed) / 3200, 0.3);
      const raised = 1 + 0.16 * lift.at;
      glass.style.width = `${w.at.toFixed(2)}px`;
      glass.style.height = `${h.at.toFixed(2)}px`;
      glass.style.transform = `translate3d(${(x.at - w.at / 2).toFixed(2)}px, ${(y.at - h.at / 2).toFixed(2)}px, 0) scale(${((1 + stretch) * raised).toFixed(4)}, ${((1 - stretch * 0.42) * raised).toFixed(4)})`;
      // The tab under the lens takes the accent colour as the lens passes.
      const outer = bar.getBoundingClientRect();
      const under = resting < 0 && !press ? -1 : nearest(outer.left + x.at);
      slots.forEach((slot, index) => slot.toggleAttribute('data-lit', index === under));
      bar.dataset['lens'] = under < 0 ? 'none' : slots[under]?.classList.contains('tab-home') ? 'home' : 'tab';
    };

    const step = (now: number) => {
      // A fixed small step however long the frame took, so the spring never blows up after a pause.
      let left = Math.min((now - last) / 1000, 0.064);
      last = now;
      const { stiffness, damping } = press?.dragging ? FOLLOW : SETTLE;
      while (left > 0) {
        const dt = Math.min(left, 0.004);
        left -= dt;
        for (const spring of springs) {
          spring.speed += (stiffness * (spring.to - spring.at) - damping * spring.speed) * dt;
          spring.at += spring.speed * dt;
        }
      }
      const moving = springs.some((spring) => Math.abs(spring.to - spring.at) > 0.05 || Math.abs(spring.speed) > 0.5);
      if (!moving) for (const spring of springs) [spring.at, spring.speed] = [spring.to, 0];
      draw();
      frame = moving ? requestAnimationFrame(step) : 0;
    };

    const run = () => {
      if (still.matches || !placed) {
        for (const spring of springs) [spring.at, spring.speed] = [spring.to, 0];
        draw();
        return;
      }
      if (frame === 0) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    };

    /** Sends the lens to a tab; `clientX`, while dragging, keeps its middle under the finger instead. */
    const aim = (index: number, clientX?: number) => {
      const box = boxOf(index);
      if (!box) return;
      const outer = bar.getBoundingClientRect();
      x.to = clientX === undefined ? box.x : Math.max(box.w / 2, Math.min(outer.width - box.w / 2, clientX - outer.left));
      [y.to, w.to, h.to] = [box.y, box.w, box.h];
      run();
    };

    const rest = () => {
      if (press) return;
      if (resting >= 0) aim(resting);
      else draw();
      if (!placed && bar.getBoundingClientRect().width > 0) {
        placed = true;
        bar.toggleAttribute('data-ready', true);
      }
    };
    retarget.current = () => {
      resting = live.current.selected;
      rest();
    };

    const raise = (up: boolean) => {
      lift.to = up ? 1 : 0;
      bar.toggleAttribute('data-lifted', up);
      run();
    };

    const down = (event: PointerEvent) => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const over = nearest(event.clientX);
      press = { startX: event.clientX, dragging: false, over };
      aim(over);
      raise(true);
    };
    const move = (event: PointerEvent) => {
      if (!press || !event.isPrimary) return;
      if (!press.dragging && Math.abs(event.clientX - press.startX) > DRAG_PX) press.dragging = true;
      if (!press.dragging) return;
      press.over = nearest(event.clientX);
      aim(press.over, event.clientX);
    };
    const up = (event: PointerEvent) => {
      if (!press || !event.isPrimary) return;
      const { dragging, over } = press;
      press = null;
      raise(false);
      resting = over;
      aim(over);
      if (!dragging) return;
      // Let go after a drag: the tab under the finger opens, whatever element the finger started on.
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 60);
      const slot = slots[over];
      if (over === MORE) live.current.onMore();
      else if (over !== live.current.selected && slot instanceof HTMLAnchorElement) live.current.router.push(slot.pathname);
    };
    const cancel = () => {
      if (!press) return;
      press = null;
      raise(false);
      retarget.current();
    };
    const click = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    // Scrolling down shrinks the bar to its icons; scrolling up, or the top of the page, brings the names back.
    let anchor = window.scrollY;
    const scrolled = () => {
      const now = Math.max(0, window.scrollY);
      if (Math.abs(now - anchor) < SCROLL_PX) return;
      const shrink = now > anchor && now > 48 && !still.matches;
      anchor = now;
      bar.toggleAttribute('data-mini', shrink);
    };

    const resized = new ResizeObserver(() => rest());
    resized.observe(bar);
    for (const slot of slots) resized.observe(slot);
    bar.addEventListener('pointerdown', down);
    bar.addEventListener('click', click, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('scroll', scrolled, { passive: true });
    rest();
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      bar.removeEventListener('pointerdown', down);
      bar.removeEventListener('click', click, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('scroll', scrolled);
    };
  }, []);

  // The page or the sheet changed: the lens goes to the tab that is now the current one.
  useEffect(() => retarget.current(), [selected]);

  return (
    <nav ref={nav} className="tab-bar" aria-label="Tabs 分頁">
      <span className="tab-glass" aria-hidden="true" />
      <span ref={lens} className="tab-lens" aria-hidden="true" />
      {TABS.map(({ page, short, icon, home }, index) => {
        const current = selected === index;
        return (
          <Link key={page.href} href={page.href} draggable={false} lang="zh-Hant" aria-label={name(page.label)} aria-current={current ? 'page' : undefined} className={[home ? 'tab-home' : '', current ? 'current' : ''].filter(Boolean).join(' ') || undefined}>
            <span className="tab-icon">
              <svg width={home ? 26 : 22} height={home ? 26 : 22} viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {icon}
              </svg>
            </span>
            <span className="tab-name">{short}</span>
            <Pending />
          </Link>
        );
      })}
      <button type="button" lang="zh-Hant" aria-label="更多 More" aria-expanded={sheet} aria-controls="nav-sheet" className={selected === MORE ? 'current' : undefined} onClick={onMore}>
        <span className="tab-icon">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M5 11 H5.2 M11 11 H11.2 M17 11 H17.2" />
          </svg>
        </span>
        <span className="tab-name">更多</span>
      </button>
    </nav>
  );
}
