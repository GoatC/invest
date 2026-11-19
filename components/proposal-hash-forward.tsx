'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * A link to a rule warning made before 2026-11-19 (a push already sent, a bookmark) points at the dashboard's
 * `#proposals` or `#proposal-12`; the warnings now have their own page, so such a link goes on there.
 */
export function ProposalHashForward() {
  const router = useRouter();
  useEffect(() => {
    const forward = () => {
      const hash = window.location.hash;
      if (hash === '#proposals' || /^#proposal-\d+$/.test(hash)) router.replace(`/proposals${hash === '#proposals' ? '' : hash}`);
    };
    forward();
    // Also when only the hash changes on a dashboard already open (a link tapped from inside the app).
    window.addEventListener('hashchange', forward);
    return () => window.removeEventListener('hashchange', forward);
  }, [router]);
  return null;
}
