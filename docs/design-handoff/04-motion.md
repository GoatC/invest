# 04 Motion

Every animation plays once and stops; none loops. With Reduce Motion on (`prefers-reduced-motion: reduce` on
the web, `UIAccessibility.isReduceMotionEnabled` in the shell) each one becomes a 150 ms fade or nothing.

The opening sequence plays only on the first open after the nightly data arrives (compare the data date with a
value kept in `localStorage`); every other open shows the end state at once.

| # | Trigger | Element | What moves | Duration | Delay | Easing |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | first open after new data | poster `.glow` | opacity 0 → k | 700 ms | 80 ms | cubic-bezier(.2,.7,.2,1) |
| 2 | same | poster value (one text run) and decimals | translateY(.45em) → 0, opacity 0 → 1 | 560 ms | 140 ms / 200 ms | same |
| 3 | same | poster line | stroke draws left → right (web: dash offset; shell: Swift Charts' own animation on appear) | 900 ms | 260 ms | cubic-bezier(.3,.6,.2,1) |
| 4 | after 3 | today's dot | appears (240 ms), then one ripple ring r 5 → 22 pt, opacity .55 → 0 | 1200 ms | 1100 ms / 1150 ms | cubic-bezier(.2,.7,.2,1) |
| 5 | value crosses a milestone (once per milestone, kept in the database) | ring around the value | scale .55 → 1.35, opacity .55 → 0, `--flat` 2 px; plus success haptic | 1400 ms | 900 ms | same |
| 6 | rule accessory appears | `NextView` | system appearance; light haptic | system | — | system |
| 7 | tab / segment / range change | page | system spring | system | — | system |

Web keyframes (as used on the canvas):

```css
@keyframes lvGlow { from { opacity: 0 } to { opacity: var(--glow-k, 1) } }
@keyframes lvRise { from { opacity: 0; transform: translateY(.45em) } to { opacity: 1; transform: none } }
@keyframes lvDraw { from { stroke-dashoffset: var(--len) } to { stroke-dashoffset: 0 } }
@keyframes lvRipple { 0% { opacity: .55; r: 5 } 100% { opacity: 0; r: 22 } }
@keyframes lvRing { 0% { opacity: .55; transform: scale(.55) } 100% { opacity: 0; transform: scale(1.35) } }
@media (prefers-reduced-motion: reduce) { .hero * { animation-duration: 1ms !important; animation-delay: 0ms !important } }
```

Use `animation-fill-mode: forwards` (not `both`) on 4 and 5, so nothing shows before they start.

Milestones (Hugo, 2026-11-18): the total value crossing each NT$100,000 step. The step is a setting in `config`
(`{"milestone_step_twd": 100000}` in the `glow` row or its own row), not code. Keep the last celebrated step on
the server (a small state row), not in `localStorage`, so a new phone does not replay it; a fall back below a step
and a rise past it again does not celebrate twice. Pure function with a unit test: 1,198,000 → 1,201,000 crosses
1,200,000; 1,201,000 → 1,199,000 → 1,203,000 celebrates nothing new.
