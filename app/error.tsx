'use client';

import { Bi } from '@/components/bi';

/** Shown when a page fails unexpectedly; database read errors have their own message. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card narrow form">
      <p className="banner danger" role="alert">
        <Bi en="Something went wrong while loading this page." zh="載入此頁面時發生錯誤。" />
      </p>
      <div>
        <button type="button" className="button" onClick={reset}>
          <Bi en="Try again" zh="重試" />
        </button>
      </div>
    </section>
  );
}
