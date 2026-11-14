'use client';

import { useEffect, useState } from 'react';

import type { Bilingual } from '@/lib/i18n';
import { REMINDER_PREFS_KEY, reminderPrefs, type ReminderPrefs, type RemindersStatus } from '@/lib/shell';

import { Bi } from './bi';
import { Info } from './info';
import { REMINDERS_STATUS, REMINDERS_SYNC } from './shell-bridge';

/**
 * Inside the iOS shell only (lib/shell.ts): which reminders this phone schedules for itself, and
 * whether iOS lets it show them. The choices stay on the phone; a change is handed to the shell at
 * once (components/shell-bridge.tsx). Outside the shell nothing is drawn.
 */

const KINDS: ReadonlyArray<{ key: keyof ReminderPrefs; label: Bilingual }> = [
  { key: 'weekly', label: { en: 'Weekly review', zh: '每週檢視' } },
  { key: 'event', label: { en: 'Event ahead', zh: '事件前' } },
  { key: 'dividend', label: { en: 'Dividend day', zh: '配息日' } },
  { key: 'expiry', label: { en: 'Reinstall reminder', zh: '重裝提醒' } },
];

interface Known {
  status?: RemindersStatus;
  pushDevices?: number;
}

function known(): Known {
  return (window as unknown as { longviewReminders?: Known }).longviewReminders ?? {};
}

function stored(): unknown {
  try {
    return JSON.parse(localStorage.getItem(REMINDER_PREFS_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function dateText(iso: string): string {
  return new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function ShellReminders() {
  const [inShell, setInShell] = useState(false);
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null);
  const [status, setStatus] = useState<RemindersStatus | undefined>(undefined);

  useEffect(() => {
    if (!document.documentElement.hasAttribute('data-shell')) return undefined;
    setInShell(true);
    const now = known();
    setPrefs(reminderPrefs(stored(), now.pushDevices ?? 0));
    setStatus(now.status);
    const heard = (event: Event) => {
      setStatus((event as CustomEvent<RemindersStatus>).detail);
      // The count of devices came with the reminders: the defaults may read it now.
      setPrefs(reminderPrefs(stored(), known().pushDevices ?? 0));
    };
    window.addEventListener(REMINDERS_STATUS, heard);
    return () => window.removeEventListener(REMINDERS_STATUS, heard);
  }, []);

  if (!inShell || !prefs) return null;

  const change = (key: keyof ReminderPrefs, on: boolean) => {
    const next = { ...prefs, [key]: on };
    setPrefs(next);
    try {
      localStorage.setItem(REMINDER_PREFS_KEY, JSON.stringify(next));
    } catch {
      // Storage refused: the choice holds until the app closes.
    }
    window.dispatchEvent(new Event(REMINDERS_SYNC));
  };

  return (
    <section className="card form" id="shell-reminders">
      <h2>
        <Bi en="Reminders in the app" zh="App 內提醒" />
      </h2>
      <Info>
        <Bi
          en="Notifications the phone schedules itself, for the next 14 days, each time the app opens: what can be known ahead. A rule warning or the volatility alert still comes only as a push of the Home Screen web app. While a device gets those pushes, the first three start off, so nothing comes twice. The reinstall reminder comes at 20:00 the evening before this build runs out."
          zh="由手機自己排的通知，每次開啟 App 時排入未來 14 天、可預知的提醒。規則警示與波動警報仍只由主畫面的網頁版推播。已有裝置在收推播時，前三項預設關閉，以免收到兩次。重裝提醒在這一版到期前一晚 20:00。"
        />
      </Info>
      <p className={status && !status.allowed ? 'banner warn' : 'banner info'} role="status" id="shell-reminders-status">
        {status === undefined ? (
          <Bi en="Checking…" zh="檢查中…" />
        ) : !status.allowed ? (
          <Bi en="Notifications are off: Settings → Notifications → 長期投資." zh="通知未允許：到 設定 → 通知 → 長期投資 開啟。" />
        ) : (
          <Bi
            en={`${status.scheduled} scheduled${status.expires ? ` · this build runs out ${dateText(status.expires)}` : ''}`}
            zh={`已排 ${status.scheduled} 則${status.expires ? ` · 這一版 ${dateText(status.expires)} 到期` : ''}`}
          />
        )}
      </p>
      <div className="check-list">
        {KINDS.map(({ key, label }) => (
          <label key={key} className="check-row">
            <input type="checkbox" checked={prefs[key]} onChange={(event) => change(key, event.target.checked)} />
            <Bi {...label} />
          </label>
        ))}
      </div>
    </section>
  );
}
