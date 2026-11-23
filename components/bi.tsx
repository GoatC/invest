import { textMode, type Bilingual } from '@/lib/i18n';

/**
 * A text written in both languages, shown in Chinese alone at every width (CLAUDE.md, Chinese only, 2026-11-18). A
 * name (lib/i18n.ts textMode 'both') keeps its English beside it, out of sight (globals.css `.bi > [lang='en']`), so a
 * screen reader still says both; a sentence or a figure line is Chinese alone; a name the same in both (FinMind) once.
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

/** A page title: Chinese only (the bilingual rule's one exception, with the navigation). Takes a bilingual label as is. */
export function Zh({ zh }: Bilingual) {
  return <span lang="zh-Hant">{zh}</span>;
}
