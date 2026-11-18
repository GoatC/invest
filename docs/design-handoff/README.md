# Design handoff: 甲 墨綠克制 (Ink)

The visual direction Hugo chose on 2026-11-18, ready for Claude Code to build. Read this file first, then the
others in order. Everything here is a design decision already made; open questions are listed at the end and
must go to Hugo before they are built.

| File | What it holds |
| --- | --- |
| [01-tokens.md](01-tokens.md) | `app/globals.css` variable values for light and dark, the new direction / glow / warning tokens, the config row for glow thresholds |
| [ink-theme.css](ink-theme.css) | The same tokens as a drop-in block for `app/globals.css` |
| [02-components.md](02-components.md) | Web components to change, file by file |
| [03-ios-shell.md](03-ios-shell.md) | iOS shell changes (bars, accessory tint, haptics) and Swift Charts colours |
| [04-motion.md](04-motion.md) | Every animation: trigger, property, duration, easing, reduced-motion fallback |
| [05-tasks.md](05-tasks.md) | Ordered task list with acceptance checks |

Visual references (private to Hugo's claude.ai account):

- Design canvas, page 「甲 定稿方向」 light and dark: the final screens, with the dashboard animation playing once.
- Long-View design system, themes `ink` and `ink-night`, README and the Glow card: the token source of truth.

## What the direction is, in five lines

1. Ink-green grounds at very low chroma (`--bg` #f2f5f3 / #070b09): grounds and hairlines only, never a signal.
2. Forget-me-not blue `--accent` is the only action colour.
3. Colour appears only when a number has a direction: red up, green down (紅漲綠跌 setting, swapped by the setting), forget-me-not blue for flat, always with ▲ ▼ or 「持平」.
4. One glow per screen, from the top-right corner, its strength set by the size of the 7-day move; rules use amber, never red.
5. Native iOS draws the bars, segmented controls, tab bar and the 「下一步」 accessory in Liquid Glass; the page draws content only.

## Constraints that still apply (CLAUDE.md)

- Thresholds live in the rules / config tables, never hard-coded: the flat band and glow scale below are a new `config` row.
- Every model function ships with unit tests; the glow strength is a pure function and gets one.
- Public repo: demo seed data only. The figures in the mockups (NT$1,234,567 etc.) are demo values.
- UI text: Chinese only at phone width (390–402 px), bilingual on wide screens (see open question 3).

## Open questions for Hugo (do not build until answered)

1. **Search and bell buttons on the dashboard bar.** Hugo kept the person, search and bell buttons. The app has a notifications page (`/notifications`) but no search and no profile page. Decide what each opens before wiring them.
2. **The ✕ icon.** Allocation's 需再平衡 used red ✕; the direction makes it amber ! (filled). Confirm ✕ is retired from rules, or say where it stays.
3. **CLAUDE.md bilingual rule.** It says all UI text is bilingual; the brief says Chinese only on phones. Update CLAUDE.md to match, or keep both languages on phones.
4. **Chart colours.** Kept as they are by Hugo's decision, though cash (green) and gold (pink-red) echo the up/down colours. Revisit only if Hugo asks.
