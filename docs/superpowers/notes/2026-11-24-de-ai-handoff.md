# De-AI the iOS app: handoff for the next session

Status: proposals made, waiting on Hugo's choices. Not an approved design yet.

## Start here

1. Read Hugo's choices: `ArtifactData list` on https://claude.ai/artifact/SF7WuGoqnhDo1hG4t3wkrY, collection `decisions` (one document per proposal id: `choice` apply / skip / discuss, `variant`, `note`).
2. Ask about every `discuss` before building it.
3. Write the design doc for the `apply` items (`docs/superpowers/specs/`), get it approved, then plan it.

## What Hugo asked for (2026-11-24)

- Goal: take the AI look out of the app and offer better looking options. Usage itself does not feel stuck; it feels not smooth enough, and opening takes a while.
- The Ink design (docs/design-handoff/) no longer binds: build on top of it freely.
- Liquid Glass stays only on the bottom tab bar and the top bar (帳號 / logo, 搜尋, 通知, 更新). Everything else loses its glass.
- The VaR line: flat on first open, right only after tapping 1個月 then 1週. Also make the line more sensitive, so the last week's movement is easy to see.

## The proposals (ids as in the artifact)

| Id | Proposal | Where |
| --- | --- | --- |
| D01 | Two boxes deep at most (summary block loses inner rules and frames) | globals.css `.summary-block`, inner cards |
| D02 | Holdings' add-actions go into the bar's ＋ menu | app/holdings/page.tsx page head, shell ＋ |
| D03 | Pool and period filters as one line of menus | performance, attribution, stress, regression `.filters` |
| D04 | ⓘ rows beside the title; underlined links become rows with › | `details.info` in cards |
| D05 | Six type sizes (17 / 15 / 13 / 20 / 26 / 34), tabular numbers | globals.css (97 font-size declarations today, 25 sizes on screen) |
| D06 | Status as a small orange glyph, red/green kept for moves; chart violet `--chart-7` replaced | `.status-icon`, `.sig`, tokens |
| D07 | No decorative glow or grain (poster keeps its line) | `.glow.page`, `.hero-glow`, `.hero-grain` |
| L01 | Ground: keep Ink green-grey, or iOS system grey with no frames (variant) | tokens |
| G01 | Reminder capsule above the tab bar: into the bell badge, or opaque in place (variant) | ios/Shell (accessory, G04 of the Liquid Glass artifact) |
| G02 | Opaque sheet for new trade; system segmented control | ios/Shell |
| S01 | Opening screen lifts when its own page is drawn; others keep preloading; no opening screen within 30 minutes | components/splash.tsx, components/preload.tsx |
| V01 | VaR first-draw fix (always) + sensitivity variant: A tight y-range on 52 weeks, B last 4 weeks daily under 1週 | see below |

The screens were made by injecting [2026-11-24-de-ai-prototype.css](2026-11-24-de-ai-prototype.css) into the running app in shell mode with [2026-11-24-shellshots.mjs](2026-11-24-shellshots.mjs) (`node shellshots.mjs <out> <tag> [css] "<tokens>"` against the e2e stand-in kept running). The CSS is throwaway: it shows the look, not the implementation.

## VaR line: what is known

- Web (Chromium) draws the line correctly on the first load.
- In shell mode the page hands the shell the same spec on first load and after the toggle: `spark: true`, line and point series of 53 values, `y` 1200–1600 with 5 ticks, box 322 × 72 at the same place. So the flat line is made on the native side (ios/Shell/NativeCharts.swift), not by the page.
- Not reproduced: no simulator in a cloud session. Next step: add a VaR spark spec to ios/tests/look/index.html and screenshot it in the look job, first draw against a second draw.
- Sensitivity: the line is `sparkline()` in lib/models/risk.ts (one point a week, 52 weeks); the y range comes from ECharts' `scale: true` extent, rounded out to nice numbers.

## Other findings kept for later

The earlier audit's ten flow proposals (proposal → trade prefill, one to-do inbox, banners, title cards, filters first, form-first pages, one ＋, trade-form order, Chinese-only names and 44px, dashboard "this week") are in this session's chat; D02 and D03 overlap two of them.
