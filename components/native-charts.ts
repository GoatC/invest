'use client';

import type { NativeSpec } from '@/lib/native-chart';

/**
 * Hands charts to the iOS shell to draw with Swift Charts (lib/native-chart.ts) and keeps it told
 * where each one sits in the page: its box in page coordinates, again whenever the page's layout
 * moves (a part opening above it, the page growing), and none while it is out of sight (a closed
 * sub-tab, the More list over the page). The shell places a native chart in the web view's scrolling
 * content at that box (ios/Shell/NativeCharts.swift), so it scrolls with the page; the page keeps
 * the chart's place and its words (legend, table) and draws nothing in it.
 *
 * Only in a shell that listens for charts (`webkit.messageHandlers.chart`), on the main tabs' pages
 * (Hugo, 2026-11-15: the main tabs first).
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Live {
  element: HTMLElement;
  spec: NativeSpec;
  box: Box | null;
}

type Handler = { postMessage: (message: unknown) => void };

/** The pages whose charts the shell draws natively, by path. */
export const NATIVE_PAGES: readonly string[] = ['/', '/holdings', '/performance', '/allocation'];

function handler(): Handler | undefined {
  if (typeof window === 'undefined' || !document.documentElement.hasAttribute('data-shell')) return undefined;
  return (window as unknown as { webkit?: { messageHandlers?: { chart?: Handler } } }).webkit?.messageHandlers?.chart;
}

/** Whether a chart on this page is drawn by the shell. */
export function nativeCharts(): boolean {
  return handler() !== undefined && NATIVE_PAGES.includes(window.location.pathname);
}

const live = new Map<string, Live>();
let counter = 0;
let covered = false;
let frame = 0;
let watching = false;

/** Where the element is in the page, in CSS pixels from the page's top-left; null while it shows nothing. */
function boxOf(element: HTMLElement): Box | null {
  if (covered || !element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return { x: Math.round(rect.left + window.scrollX), y: Math.round(rect.top + window.scrollY), w: Math.round(rect.width), h: Math.round(rect.height) };
}

const same = (a: Box | null, b: Box | null) => (a === null || b === null ? a === b : a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** Tells the shell of every chart whose place changed since it was last told. */
function place(): void {
  frame = 0;
  const shell = handler();
  if (!shell) return;
  for (const [id, chart] of live) {
    const box = boxOf(chart.element);
    if (same(box, chart.box)) continue;
    chart.box = box;
    shell.postMessage({ op: 'move', id, box });
  }
}

function soon(): void {
  if (!frame) frame = requestAnimationFrame(place);
}

/** Once: the layout's movements that can shift a chart without its own size changing. */
function watch(): void {
  if (watching) return;
  watching = true;
  const resize = new ResizeObserver(soon);
  resize.observe(document.documentElement);
  resize.observe(document.body);
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'class', 'style', 'hidden'] });
  document.addEventListener('toggle', soon, true);
  window.addEventListener('resize', soon);
  window.addEventListener('load', soon);
}

/** Each chart's own size watcher, by id. */
const sizes = new Map<string, ResizeObserver>();

/**
 * Asks the shell to draw `spec` over `element`; called again for the same element (new data, a
 * light/dark switch) it hands over the new spec in place. Returns the clean-up, which takes the
 * chart away.
 */
export function showNative(element: HTMLElement, spec: NativeSpec): () => void {
  const shell = handler();
  if (!shell) return () => {};
  const key = element.dataset.nativeChart ?? `chart-${++counter}`;
  element.dataset.nativeChart = key;
  watch();
  const box = boxOf(element);
  live.set(key, { element, spec, box });
  shell.postMessage({ op: 'set', id: key, box, spec });
  if (!sizes.has(key)) {
    const resize = new ResizeObserver(soon);
    resize.observe(element);
    sizes.set(key, resize);
  }
  return () => {
    if (live.get(key)?.element !== element) return;
    sizes.get(key)?.disconnect();
    sizes.delete(key);
    live.delete(key);
    delete element.dataset.nativeChart;
    shell.postMessage({ op: 'remove', id: key });
  };
}

/** The More list covers the page (components/site-nav.tsx): the shell's charts leave while it is open. */
export function coverNative(on: boolean): void {
  if (covered === on) return;
  covered = on;
  place();
}
