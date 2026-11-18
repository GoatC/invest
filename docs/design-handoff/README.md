# Design handoff: 甲 墨綠克制 (Ink)

The visual direction Hugo chose on 2026-11-18, ready for Claude Code to build. Read this file first, then the
others in order. Everything here is a design decision already made; Hugo's answers to the open questions are
at the end.

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
4. One glow per screen, from the top-right corner, its strength set by the size of the 7-day move. Rule states keep the app's icons: red ✕ 需處理, amber ! 留意, blue ✓ 正常.
5. Native iOS draws the bars, segmented controls, tab bar and the 「下一步」 accessory in Liquid Glass; the page draws content only.

## Constraints that still apply (CLAUDE.md)

- Thresholds live in the rules / config tables, never hard-coded: the flat band and glow scale below are a new `config` row.
- Every model function ships with unit tests; the glow strength is a pure function and gets one.
- Public repo: demo seed data only. The figures in the mockups (NT$1,234,567 etc.) are demo values.
- UI text is shown in 繁體中文 (CLAUDE.md, updated 2026-11-18); English stays in accessible names only.

## Hugo's answers (2026-11-18)

1. **Person button** opens a short account page (帳號), in a sheet. The app may later be shared with family, so it shows 家人共用 as 尚未開放; sharing itself is a later phase (it changes the single-user rule and needs per-person data under RLS).
2. **Search button** opens a search like pulling down on the iPhone home screen: a search field with the keyboard up, which finds any feature (page, sub-tab, setting, help), holding or setting.
3. **Red ✕ stays red.** Wherever the app uses ✕ (alert tone: a cap breach such as R1, a class that needs rebalancing), it stays red ✕ with `--danger-*`. Amber ! is for 留意 (watch) and data problems.
4. **CLAUDE.md** now says UI text is shown in Chinese.
5. **Milestone** = total value crossing each NT$100,000 step.
6. **Chart colours** stay as they are.
