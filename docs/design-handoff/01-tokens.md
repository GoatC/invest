# 01 Tokens

Source of truth: the Long-View design system, themes `ink` (light, default) and `ink-night` (dark). The values
below are copied from it. Variable names match `app/globals.css` one to one, so the existing components pick
them up without edits; the new variables are additions.

## Existing variables: new values

| Variable | Light (`:root`) | Dark (`prefers-color-scheme: dark`) | Note |
| --- | --- | --- | --- |
| `--bg` | `#f2f5f3` | `#070b09` | ink-green ground, grounds only |
| `--surface` | `#fafbfa` | `#101613` | |
| `--text` | `#141a17` | `#ecf0ee` | 17:1 / 16:1 |
| `--muted` | `#4f5a55` | `#9aa59f` | ≥6.5:1 on both grounds |
| `--border` | `#dce3df` | `#1d2622` | hairlines, decorative |
| `--border-strong` | `#76837d` | `#5e6b65` | inputs, chips, buttons; ≥3.3:1 |
| `--accent` | `#34689c` | `#8db8ea` | the only action colour |
| `--accent-text` | `#ffffff` | `#070b09` | |
| `--accent-soft` | `#dce9f7` | `#1d3149` | |
| `--sky` | `#8db4e2` | `#6fa3db` | decoration only |
| `--ok-bg` / `--ok-text` | `#e5f2ea` / `#1c6a43` | `#14301f` / `#8fd6a6` | |
| `--warn-bg` / `--warn-text` | `#fbf0d8` / `#74500a` | `#2a2111` / `#f6d58d` | |
| `--danger-bg` / `--danger-text` | `#fbe8e6` / `#a02f27` | `#3a1a1a` / `#f5a8a0` | 需處理 with red ✕ (cap breach, rebalance); never for up/down |
| `--status-critical` | `#c8453d` | `#ec7a72` | the red ✕ badge and its gauge fill (✕ in white / `#2a0f0d`) |
| `--info-bg` / `--info-text` | `#e2edf8` / `#2c5d93` | `#1d3149` / `#a9cdf2` | |
| `--status-warning` | `#b07600` | `#e3b341` | gauges |
| `--shadow-soft` | `none` | `none` | Ink layers by ground step and hairline |
| `--card-border` | `1px solid var(--border)` | same | lists are hairline-ruled, not shadowed |
| `--hero-bg` | `var(--surface)` | `var(--surface)` | the poster is no longer an accent-blue slab |
| `--hero-text` | `var(--text)` | `var(--text)` | |
| `--chart-1` … `--chart-8`, `--chart-context` | unchanged | unchanged | Hugo: charts stay as they are |

## New variables

| Variable | Light | Dark | Use |
| --- | --- | --- | --- |
| `--up` | `#c23a43` | `#ff6b70` | rising figure, ▲, today's dot |
| `--down` | `#1b7a4b` | `#34d36a` | falling figure, ▼ |
| `--flat` | `#34689c` | `#8db8ea` | 「持平」 |
| `--up-soft` / `--up-on-soft` | `#fbe8e6` / `#a02f27` | `#f3f5f9` / `#bc2431` | direction capsule |
| `--down-soft` / `--down-on-soft` | `#e2f3ea` / `#1b6b42` | `#f3f5f9` / `#17703a` | |
| `--flat-soft` / `--flat-on-soft` | `#e2edf8` / `#2c5d93` | `#f3f5f9` / `#2b5f96` | |
| `--glow-up-core` / `--glow-up-edge` | `rgba(240,140,140,.62)` / `rgba(251,224,222,.60)` | `rgba(255,86,92,.62)` / `rgba(200,16,46,.28)` | |
| `--glow-down-core` / `--glow-down-edge` | `rgba(104,200,152,.62)` / `rgba(219,241,229,.60)` | `rgba(52,211,106,.52)` / `rgba(31,122,53,.28)` | |
| `--glow-flat-core` / `--glow-flat-edge` | `rgba(141,180,226,.75)` / `rgba(220,233,247,.60)` | `rgba(111,163,219,.50)` / `rgba(52,104,156,.28)` | |
| `--glow-warn-core` / `--glow-warn-edge` | `rgba(242,179,64,.50)` / `rgba(251,236,204,.55)` | `rgba(242,179,64,.40)` / `rgba(120,80,10,.26)` | reserved for a data-problem page head; no screen uses it today |
| `--warn-badge` / `--warn-badge-ink` | `#f2b340` / `#2a1b00` | same | the round ! badge |
| `--radius-capsule` | `16px` | | 32 px capsule |

The 紅漲綠跌 setting already exists (config `sectors`, read into `body:has(#green-up)` / `.green-up` in
`globals.css`). As built, the red and green sets are named by colour in `:root` (`--move-red`, `--move-green`,
their `-soft` / `-on-soft` pairs, `--glow-red-*`, `--glow-green-*`), and that existing switch maps them to `--up*`,
`--down*` and `--glow-up-*` / `--glow-down-*`. Components use only the `--up` / `--down` names.

## Glow strength: a config row, not code

Add a migration that inserts into `config`:

```sql
insert into config (key, value) values
  ('glow', '{"flat_band_pct": 0.3, "full_at_pct": 5, "k_min": 0.4, "k_flat": 0.55}')
on conflict (key) do nothing;
```

The strength is a pure function in `lib/` with a unit test:

- |move| < `flat_band_pct` → tone `flat`, k = `k_flat`
- otherwise tone `up` or `down`, k = min(1, `k_min` + (1 − `k_min`) × (|move| − `flat_band_pct`) ÷ (`full_at_pct` − `flat_band_pct`))

Acceptance values for the test: +0.08 % → flat, 0.55; +1.23 % → up, ≈0.519; −6.80 % → down, 1; +5.00 % → up, 1.

The page applies k as the glow layer's `opacity` (simpler than scaling each colour's alpha, and the look is the
same).
