'use client';

import { useEffect, useState } from 'react';

import { applyTheme, storedTheme, type ThemeChoice } from '@/lib/theme';

const CHOICES: ReadonlyArray<{ value: ThemeChoice; zh: string; en: string }> = [
  { value: 'light', zh: '淺色', en: 'Light' },
  { value: 'dark', zh: '深色', en: 'Dark' },
  { value: 'auto', zh: '自動', en: 'Automatic' },
];

/**
 * 外觀 on 帳號 (Hugo, 2026-11-19): 淺色 by default, 深色, or 自動 following the phone. The choice is kept
 * on this device and shown at once (lib/theme.ts); inside the iOS shell the page tells the shell, which
 * themes its own bars (components/shell-bridge.tsx).
 */
export function ThemeSwitch() {
  // Light until mounted: the server cannot know this device's choice.
  const [choice, setChoice] = useState<ThemeChoice>('light');
  useEffect(() => setChoice(storedTheme()), []);

  return (
    <div className="theme-row">
      <span>外觀</span>
      <div className="theme-choice" role="group" aria-label="外觀 Appearance">
        {CHOICES.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={choice === item.value}
            aria-label={`${item.zh} ${item.en}`}
            onClick={() => {
              applyTheme(item.value);
              setChoice(item.value);
            }}
          >
            {item.zh}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * On every page: with 自動 chosen, keeps following the phone after a reload (THEME_SCRIPT set the theme
 * once, before the first paint), and sets the bar colour where the head script ran before its tag.
 */
export function ThemeFollow() {
  useEffect(() => applyTheme(storedTheme()), []);
  return null;
}
