import type { Bilingual } from '@/lib/i18n';

/** English and Traditional Chinese side by side; both are required. A name the same in both (FinMind) shows once. */
export function Bi({ en, zh }: Bilingual) {
  if (en === zh) return <span className="bi">{en}</span>;
  return (
    <span className="bi">
      <span>{en}</span> <span lang="zh-Hant">{zh}</span>
    </span>
  );
}

/** A page title: Chinese only (the bilingual rule's one exception, with the navigation). Takes a bilingual label as is. */
export function Zh({ zh }: Bilingual) {
  return <span lang="zh-Hant">{zh}</span>;
}
