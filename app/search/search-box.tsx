'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { highlight, searchIndex, type SearchEntry, type SearchKind } from '@/lib/search-index';

const GROUP: Record<SearchKind, string> = { page: '功能', holding: '持股', setting: '設定', help: '說明' };
const ORDER: readonly SearchKind[] = ['page', 'holding', 'setting', 'help'];
/** Common places, shown before anything is typed. */
const SUGGESTED = ['var', 'page:/look-through', 'page:/plan', 'page:/import'];
const RECENT_KEY = 'longview.search.recent';

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function keepRecent(query: string) {
  try {
    const next = [query, ...readRecent().filter((item) => item !== query)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A private window or blocked storage: the search still works, it just forgets.
  }
}

function Row({ entry, query, onOpen }: { entry: SearchEntry; query: string; onOpen: () => void }) {
  const [before, hit, after] = highlight(entry.title, query);
  return (
    <li>
      <Link href={entry.href} prefetch onClick={onOpen}>
        <span className="search-name">
          {before}
          {hit && <b>{hit}</b>}
          {after}
        </span>
        <span className="muted small">{entry.where}</span>
      </Link>
    </li>
  );
}

/** The field, with the keyboard up at once, and its results grouped by kind. */
export function SearchBox({ index }: { index: readonly SearchEntry[] }) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecent()), []);
  const results = useMemo(() => searchIndex(index, query), [index, query]);
  const suggested = useMemo(() => SUGGESTED.map((key) => index.find((entry) => entry.key === key)).filter((entry): entry is SearchEntry => entry !== undefined), [index]);
  const open = () => {
    if (query.trim()) keepRecent(query.trim());
  };

  return (
    <div className="search-box">
      <label className="search-field">
        <span className="visually-hidden">搜尋功能、持股、設定</span>
        <svg width="17" height="17" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="9.5" cy="9.5" r="6.5" />
          <path d="M14.5 14.5l5 5" />
        </svg>
        <input type="search" enterKeyHint="search" autoFocus autoComplete="off" placeholder="搜尋功能、持股、設定" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      {query.trim() ? (
        results.length === 0 ? (
          <p className="muted">找不到「{query.trim()}」</p>
        ) : (
          ORDER.map((kind) => {
            const rows = results.filter((entry) => entry.kind === kind);
            if (rows.length === 0) return null;
            return (
              <div key={kind} className="search-group">
                <h2>{GROUP[kind]}</h2>
                <ul className="link-rows">
                  {rows.map((entry) => (
                    <Row key={entry.key} entry={entry} query={query} onOpen={open} />
                  ))}
                </ul>
              </div>
            );
          })
        )
      ) : (
        <>
          {recent.length > 0 && (
            <div className="search-group">
              <h2>最近搜尋</h2>
              <div className="search-recent">
                {recent.map((item) => (
                  <button key={item} type="button" onClick={() => setQuery(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="search-group">
            <h2>建議</h2>
            <ul className="link-rows">
              {suggested.map((entry) => (
                <Row key={entry.key} entry={entry} query="" onOpen={open} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
