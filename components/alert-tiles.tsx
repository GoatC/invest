import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import type { AlertItem, AlertGauge, AlertTone } from '@/lib/alerts';
import type { Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

const ICON: Record<AlertTone, string> = { alert: '✕', watch: '!', info: 'i', ok: '✓' };
const ROLE: Record<AlertTone, 'alert' | 'status'> = { alert: 'alert', watch: 'alert', info: 'status', ok: 'status' };

/** A bar from 0 to a little past the larger of the figure and the limit: the figure fills it, the limit and target are ticks. */
function Gauge({ gauge }: { gauge: AlertGauge }) {
  const top = Math.max(gauge.value, gauge.limit, gauge.target ?? 0) * 1.15 || 1;
  const at = (value: number) => `${Math.min(100, Math.max(0, (value / top) * 100)).toFixed(1)}%`;
  const over = gauge.value > gauge.limit;
  return (
    <span className="alert-gauge" aria-hidden="true">
      <span className={`alert-gauge-fill${over ? ' over' : ''}`} style={{ width: at(gauge.value) }} />
      {gauge.target !== undefined && <span className="alert-gauge-tick target" style={{ left: at(gauge.target) }} />}
      <span className="alert-gauge-tick limit" style={{ left: at(gauge.limit) }} />
    </span>
  );
}

/**
 * Warnings as small tiles that read at a glance (in place of a sentence per warning): a status
 * icon, a code, the name, the figure, a gauge against the limit and a few short chips. An optional
 * heading names the group in a few words, e.g. "會違反規則（仍可儲存）".
 * `actions` gives a tile its own buttons, by item key (a question to answer, such as a dividend to
 * record or skip); such a tile is not itself a link. `more` adds a line or a fold under a tile's
 * buttons, by item key (a rule warning's suggestion and its figures).
 */
export function AlertTiles({
  items,
  heading,
  tone,
  actions,
  more,
}: {
  items: readonly AlertItem[];
  heading?: Bilingual;
  tone?: AlertTone;
  actions?: Readonly<Record<string, ReactNode>>;
  more?: Readonly<Record<string, ReactNode>>;
}) {
  if (items.length === 0) return null;
  const groupTone = tone ?? items[0]?.tone ?? 'info';
  return (
    <div className={`alert-group ${groupTone}`} role={ROLE[groupTone]}>
      {heading && (
        <div className="alert-heading">
          <span className={`alert-icon ${groupTone}`} aria-hidden="true">
            {ICON[groupTone]}
          </span>
          <Bi {...heading} />
        </div>
      )}
      <ul className="alert-tiles">
        {items.map((item) => {
          const body = (
            <>
              <span className="alert-top">
                {!heading && (
                  <span className={`alert-icon ${item.tone}`} aria-hidden="true">
                    {ICON[item.tone]}
                  </span>
                )}
                {item.code && <span className="alert-code">{item.code}</span>}{' '}
                <span className="alert-title">
                  <Bi {...item.title} label />
                </span>{' '}
                {item.value !== undefined && <strong className="alert-value">{item.value}</strong>}
              </span>
              {item.gauge && <Gauge gauge={item.gauge} />}{' '}
              {item.chips && item.chips.length > 0 && (
                <span className="alert-chips">
                  {item.chips.map((chip) => (
                    <Fragment key={chip.label.en}>
                      <span className="alert-chip" title={chip.label.en}>
                        <span lang="zh-Hant">{chip.label.zh}</span> <b>{chip.value}</b>
                      </span>{' '}
                    </Fragment>
                  ))}
                </span>
              )}
            </>
          );
          return (
            <li key={item.key} className={`alert-tile ${item.tone}`} {...(item.anchor ? { id: item.anchor } : {})}>
              {item.href && !actions?.[item.key] ? (
                <Link href={item.href} className="alert-link">
                  {body}
                </Link>
              ) : (
                body
              )}
              {actions?.[item.key] && <span className="alert-actions">{actions[item.key]}</span>}
              {more?.[item.key] && <div className="alert-more">{more[item.key]}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
