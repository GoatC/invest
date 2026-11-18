import { textMode, type Bilingual } from '@/lib/i18n';

/**
 * A text written in both languages, shown by the Chinese-first rule (lib/i18n.ts textMode): a name
 * in English and Chinese side by side, a sentence or a figure line in Chinese alone, a name the
 * same in both (FinMind) once. `label` keeps a field, column or figure label bilingual.
 */
export function Bi({ en, zh, label = false }: Bilingual & { label?: boolean }) {
  const mode = textMode({ en, zh }, label);
  if (mode === 'same') return <span className="bi">{en}</span>;
  if (mode === 'zh')
    return (
      <span className="bi" lang="zh-Hant">
        {zh}
      </span>
    );
  return (
    <span className="bi">
      <span lang="en">{en}</span> <span lang="zh-Hant">{zh}</span>
    </span>
  );
}

/** A label: always both languages (a field, a column, a figure's name). */
export function Label(text: Bilingual) {
  return <Bi {...text} label />;
}

/** A page title: Chinese only (the bilingual rule's one exception, with the navigation). Takes a bilingual label as is. */
export function Zh({ zh }: Bilingual) {
  return <span lang="zh-Hant">{zh}</span>;
}
