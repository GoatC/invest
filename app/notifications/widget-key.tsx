'use client';

import { useActionState, useState } from 'react';

import { Bi } from '@/components/bi';
import { taipeiToday } from '@/lib/dates';

import { makeWidgetKey, type WidgetKeyState } from './actions';

const START: WidgetKeyState = { key: null, message: null, ok: false };

/**
 * The home-screen widget's key (docs/ios-app.md, "主畫面小工具"): made here, pasted once into the
 * widget (long-press it → Edit Widget). Only its hash is kept, so the key shows this once; a new
 * one ends the old one at once.
 */
export function WidgetKey({ createdAt }: { createdAt: string | null }) {
  const [state, action, working] = useActionState(makeWidgetKey, START);
  const [copied, setCopied] = useState(false);
  const made = state.ok ? new Date().toISOString() : createdAt;

  return (
    <div className="form">
      {made && (
        <p className="muted small">
          <Bi en="Key made" zh="鑰匙建立於" /> {taipeiToday(new Date(made))}
        </p>
      )}
      <form
        action={action}
        onSubmit={(event) => {
          if (made && !window.confirm('換一把鑰匙？舊鑰匙會立刻失效。')) event.preventDefault();
          setCopied(false);
        }}
      >
        <button type="submit" className="button" disabled={working}>
          <Bi {...(made ? { en: 'Replace the key', zh: '換一把鑰匙' } : { en: 'Make a key', zh: '產生鑰匙' })} />
        </button>
      </form>
      {state.key && (
        <div className="row">
          <input readOnly value={state.key} aria-label="Widget key 小工具鑰匙" onFocus={(event) => event.currentTarget.select()} />
          <button
            type="button"
            className="button primary"
            onClick={async () => {
              await navigator.clipboard.writeText(state.key ?? '');
              setCopied(true);
            }}
          >
            <Bi {...(copied ? { en: 'Copied', zh: '已拷貝' } : { en: 'Copy', zh: '拷貝' })} />
          </button>
        </div>
      )}
      {state.key && (
        <p className="small" role="status">
          <Bi en="Shown this once." zh="只顯示這一次。" />
        </p>
      )}
      {state.message && (
        <p className="banner warn" role="alert">
          <Bi {...state.message} />
        </p>
      )}
    </div>
  );
}
