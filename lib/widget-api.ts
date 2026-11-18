/**
 * The answer of /shell/widget (app/shell/widget/route.ts), the one address the iPhone widget asks
 * (docs/superpowers/specs/2026-11-18-ios-widget-design.md): the key in its Authorization header,
 * checked by the database's widget_figures, which answers null for a wrong or replaced key.
 * The names here are what ios/Widget/WidgetFigures.swift decodes.
 */
import { isStale } from './models/widget';

/** A key as the push page makes it: 32 random bytes in base64url is 43 characters. */
const BEARER = /^Bearer ([A-Za-z0-9_-]{43,128})$/;

/** The key in `Authorization: Bearer <key>`, or null when the header is missing or malformed. */
export function readBearer(header: string | null): string | null {
  return BEARER.exec(header ?? '')?.[1] ?? null;
}

export interface WidgetReplyFigures {
  asOf: string;
  totalTwd: number;
  weekChange: number | null;
  points: number[];
  redUp: boolean;
  stale: boolean;
}

export type WidgetReply = { status: 401; body: { error: 'key' } } | { status: 200; body: { figures: WidgetReplyFigures | null } };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** What to answer for widget_figures' result: null is a wrong key; `figures` null is nothing saved yet. */
export function widgetReply(row: unknown, today: string): WidgetReply {
  const found = record(row);
  if (!found) return { status: 401, body: { error: 'key' } };
  const figures = record(found['figures']);
  if (!figures) return { status: 200, body: { figures: null } };
  const asOf = String(figures['as_of']);
  const staleDays = found['stale_days'];
  const weekChange = figures['week_change'];
  return {
    status: 200,
    body: {
      figures: {
        asOf,
        totalTwd: Number(figures['total_twd']),
        weekChange: weekChange === null || weekChange === undefined ? null : Number(weekChange),
        points: Array.isArray(figures['points']) ? figures['points'].map(Number) : [],
        redUp: figures['red_up'] !== false,
        stale: typeof staleDays === 'number' ? isStale(asOf, today, staleDays) : false,
      },
    },
  };
}
