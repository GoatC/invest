import type { Bilingual } from '@/lib/i18n';

/** English and Traditional Chinese side by side; both are required. */
export function Bi({ en, zh }: Bilingual) {
  return (
    <span className="bi">
      <span>{en}</span> <span lang="zh-Hant">{zh}</span>
    </span>
  );
}
