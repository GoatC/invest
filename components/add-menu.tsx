'use client';

import Link from 'next/link';

import { LABELS } from '@/lib/i18n';

import { Bi } from './bi';

/**
 * Holdings' one "+" (Hugo's choice D02, 2026-11-24): a trade, a cash flow, a non-listed asset or a
 * statement import, in place of three links beside the title. Lent to the iOS shell's bar as one ＋
 * whose menu lists the same items (`data-shell-item`); the trade opens there in its sheet.
 */
export function AddMenu() {
  return (
    <details
      className="add-menu"
      aria-label="新增 Add"
      data-shell-action="add"
      data-shell-symbol="plus"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a')) event.currentTarget.open = false;
      }}
    >
      <summary aria-label="新增 Add">
        <span aria-hidden="true">＋</span>
      </summary>
      <div className="add-menu-list">
        <a href="#add-trade" data-shell-item="trade" data-shell-symbol="plus.circle" data-shell-sheet="/holdings?sheet=trade">
          <Bi {...LABELS.addTrade} />
        </a>
        <Link href="/cash-flows/new" data-shell-item="cash-flow" data-shell-symbol="banknote">
          <Bi {...LABELS.addCashFlow} />
        </Link>
        <Link href="/assets/new" data-shell-item="asset" data-shell-symbol="house">
          <Bi {...LABELS.addAsset} />
        </Link>
        <Link href="/import" data-shell-item="import" data-shell-symbol="square.and.arrow.down">
          <Bi {...LABELS.importCsv} />
        </Link>
      </div>
    </details>
  );
}
