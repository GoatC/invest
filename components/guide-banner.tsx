'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { hiddenOn, type Banner } from '@/lib/models/banners';

const ICON: Record<Banner['tone'], string> = { act: '!', info: 'i' };

/**
 * The in-app banner (lib/models/banners): one line under the header that says what waits and takes
 * Hugo there. The most pressing one shows; "＋n" opens the rest. A banner stays off the page it
 * leads to. ✕ hides it for a while on every device; a dividend also offers "skip", for good.
 */
export function GuideBanner({ banners, dismiss, skip }: { banners: readonly Banner[]; dismiss: (formData: FormData) => Promise<void>; skip: (formData: FormData) => Promise<void> }) {
  const path = usePathname();
  const [all, setAll] = useState(false);
  const here = banners.filter((banner) => !hiddenOn(banner, path));
  if (here.length === 0) return null;
  const shown = all ? here : here.slice(0, 1);
  return (
    <aside className="guide" aria-label="提醒 Reminders">
      {shown.map((banner, index) => (
        <div key={banner.key} className={`guide-banner ${banner.tone}`} role="status" data-kind={banner.kind}>
          <span className="guide-icon" aria-hidden="true">
            {ICON[banner.tone]}
          </span>
          <span className="guide-text" lang="zh-Hant" title={banner.text.en}>
            {banner.text.zh}
          </span>
          <span className="guide-actions">
            <Link href={banner.action.href} className="guide-go" lang="zh-Hant" aria-label={`${banner.action.label.zh} ${banner.action.label.en}`}>
              {banner.action.label.zh}
            </Link>
            {banner.skip && (
              <form action={skip}>
                <input type="hidden" name="event" value={banner.skip.eventId} />
                <input type="hidden" name="pool" value={banner.skip.pool} />
                <button type="submit" className="guide-skip" lang="zh-Hant" aria-label="略過 Skip">
                  略過
                </button>
              </form>
            )}
            {index === 0 && here.length > 1 && (
              <button type="button" className="guide-more" aria-expanded={all} aria-label={all ? '收合 Fewer' : `還有 ${here.length - 1} 則 ${here.length - 1} more`} onClick={() => setAll(!all)}>
                {all ? '－' : `＋${here.length - 1}`}
              </button>
            )}
            <form action={dismiss}>
              <input type="hidden" name="key" value={banner.key} />
              <button type="submit" className="guide-close" aria-label="稍後再說 Later">
                ✕
              </button>
            </form>
          </span>
        </div>
      ))}
    </aside>
  );
}
