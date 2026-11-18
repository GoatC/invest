# 02 Web components

Paths are on `main` as of 2026-11-18. Keep behaviour, data and copy; change only what is listed. Each item
names what the final screen shows on the design canvas page 「甲 定稿方向」.

## Dashboard (`app/page.tsx`)

**Poster (`<section className="hero">`)**
- Ground: `--hero-bg` is now `--surface`; add one `.glow` layer (`data-tone` = up / down / flat from the 7-day move, `--glow-k` from the strength function in 01-tokens) as the poster's first child, plus a near-invisible grain overlay (SVG `feTurbulence`, `mix-blend-mode: overlay`, ~6 % opacity) so the gradient never bands.
- Content, top to bottom: date line 「總市值 · 11/18 收盤」; the value as ONE text run: `NT$` 18 px / 700 / muted, integer 46 px / 800 / tabular / −0.02em, decimals 30 px / 700 / muted; ONE capsule for the 7-day move (`--*-soft` ground, `--*-on-soft` text, ▲ ▼ or 「持平」); the existing edge-to-edge line.
- Remove from the poster: the pools line (一般／大額) and the 累計 chip. The pools move to Holdings (they are already there) and the all-time figure stays in the line's aria-label.
- The line: unchanged geometry (132 px, 3 pt round, dashed zero line); add today's dot at its end in `--up` / `--down` / `--flat` with a 2.5 px ring in `--surface`.

**Rules (`RuleBoard`)**
- Becomes one disclosure row, closed by default: amber badge !, 「規則」, 「N 項注意」 in `--warn-text`, one muted summary line naming the rules that fire (「R1 單一個股上限 · 5/25 債券偏離」), a chevron. Use `<details>`/`<summary>` or a button with `aria-expanded`.
- Open: the existing rows (code, name, note, gauge, value). Watch / rebalance are amber; ok is forget-me-not ✓. No red.
- With nothing firing: ✓ badge, 「全部正常」, still closed.

**Value at Risk (`components/risk-card.tsx`)**: format unchanged (Hugo: keep the app's format). Only the tokens change.

**Order** stays: poster → rules → VaR → watchlist → coming week → donut → windfall → against plan.

## Holdings (`app/holdings/page.tsx`, `app/holdings/overview.tsx`)

- `Summary` stays above the views, two to a row at phone width, drawn as one hairline-ruled block (no card shadows): 一般投入資金池, 大額資金池, 衛星部位占比 (with 「R2 觸發點 25%」), 上市持股未實現損益 (`--up` / `--down` with ▲ ▼).
- The view switch (卡片／排行／買點／板塊／訊號) becomes chips under the summary; the section tabs (總覽／交易／現金流／觀察清單) are the shell's segmented control (see 03).
- Page headline wash: `.glow.page` with the tone of 「昨日」, k fixed at 0.45.

## Performance (`app/performance/page.tsx`)

- Headline 「8.42%」 at 46 px / 800 with the difference against the benchmark beside it (▲ 0.7 pt 對基準).
- Page wash: `.glow.page` toned by the difference against the benchmark, k 0.5.
- Charts: unchanged design; in the shell they are Swift Charts (03).

## Allocation (`app/allocation/page.tsx`)

- `BandRow`: watch = amber outline !, 「留意」; rebalance = amber filled !, 「需再平衡」 (was red ✕; see open question 2). Fill colours: ok `--accent`, watch / rebalance `--status-warning`. Band stripe `--accent-soft`, target tick `--text`.
- Page wash `.glow.page[data-tone='warn']` only while some class needs rebalancing.
- 資本市場假設 becomes one row with 「MM/DD 檢視」 and a chevron to `/allocation/assumptions`.
- Donut (`components/allocation-charts.tsx`): no change.

## More sheet and navigation

- `components/nav-pages.ts`: unchanged structure. Label fix: the timeline row reads 「人生時間軸」.
- `components/tab-bar.tsx` (PWA only): tokens only; the shell's tab bar is native.

## Shared

- Direction text everywhere (holdings rows, performance, summary): `--up` / `--down` plus ▲ ▼; never colour alone.
- Warnings everywhere: `--warn-badge` + `--warn-badge-ink` !, never `--danger-*`.
- Numbers: a figure is one text node; never split digits into separate boxes (it breaks when a viewer falls back to a wider font).
- Remove card shadows (`--shadow-soft: none`); lists are hairline-ruled, edge to edge at phone width.
