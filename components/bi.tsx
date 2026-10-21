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
