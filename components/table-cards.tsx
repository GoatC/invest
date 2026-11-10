'use client';

import { useEffect } from 'react';

/**
 * On a phone a table of more than three columns shows each row as a small card (globals.css,
 * "Row cards"): the first cell as its title, every other cell under its column's name. The names
 * come from here: each cell is given its column header's Chinese text as `data-label`, which the
 * style sheet prints above the value. Mounted once, in the layout; it names the cells of whatever
 * table is on the page, also after a page fills in new rows.
 */
export function TableCards() {
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return undefined;
    let queued = false;
    const label = () => {
      queued = false;
      for (const table of main.querySelectorAll<HTMLTableElement>('.table-wrap > table')) {
        const heads = Array.from(table.querySelectorAll('thead tr:last-child > th'));
        if (heads.length <= 3) continue;
        const names = heads.map((head) => (head.querySelector('[lang="zh-Hant"]')?.textContent ?? head.textContent ?? '').trim());
        for (const row of table.querySelectorAll('tbody > tr, tfoot > tr')) {
          Array.from(row.children).forEach((cell, index) => {
            const name = names[index];
            if (index > 0 && name && cell.getAttribute('data-label') !== name) cell.setAttribute('data-label', name);
          });
        }
      }
    };
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(label);
    });
    observer.observe(main, { childList: true, subtree: true });
    label();
    return () => observer.disconnect();
  }, []);
  return null;
}
