'use client';

import { useEffect, useState } from 'react';

import { HANDOFF_KEY, VIA_PUSH, shellOpenUrl } from '@/lib/shell';

import { Bi } from './bi';
import { Info } from './info';

/**
 * From a push of the web app into the iOS shell (lib/shell.ts). A tapped push opens the web app on
 * its page with `via=push` in the address (public/sw.js); on a device where Hugo has chosen so,
 * the page then asks iOS to open the same page in the shell (`longview://open`, which the shell's
 * Info.plist claims), and either way takes the mark out of the address. Never inside the shell.
 */
export function PushHandoff() {
  useEffect(() => {
    if (document.documentElement.hasAttribute('data-shell')) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(VIA_PUSH)) return;
    url.searchParams.delete(VIA_PUSH);
    const path = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', path);
    let wanted = false;
    try {
      wanted = localStorage.getItem(HANDOFF_KEY) === '1';
    } catch {
      wanted = false;
    }
    const target = wanted ? shellOpenUrl(path) : null;
    if (target) window.location.href = target;
  }, []);
  return null;
}

/** The choice, on the push page of the web app; not drawn inside the shell, where it means nothing. */
export function PushHandoffSetting() {
  const [shown, setShown] = useState(false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (document.documentElement.hasAttribute('data-shell')) return;
    setShown(true);
    try {
      setOn(localStorage.getItem(HANDOFF_KEY) === '1');
    } catch {
      setOn(false);
    }
  }, []);

  if (!shown) return null;
  return (
    <div className="form" id="push-handoff">
      <label className="check-row">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => {
            setOn(event.target.checked);
            try {
              if (event.target.checked) localStorage.setItem(HANDOFF_KEY, '1');
              else localStorage.removeItem(HANDOFF_KEY);
            } catch {
              // Storage refused: nothing is kept.
            }
          }}
        />
        <Bi en="Open pushes in the iOS app" zh="點推播改開 iOS App" />
      </label>
      <Info>
        <Bi
          en="On this device: a tapped push opens its page in the iOS app instead of here. Turn it off once the app has run out or is removed."
          zh="只影響這台裝置：點推播後改在 iOS App 開啟同一頁。App 過期或刪除後請關閉。"
        />
      </Info>
    </div>
  );
}
