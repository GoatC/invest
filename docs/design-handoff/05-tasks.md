# 05 Tasks, in order

Do them in this order; each ends with its check. Explain each setup step to Hugo in plain Traditional Chinese
before running it (CLAUDE.md). Ask Hugo the open questions in README.md before tasks 6 and 9.

1. **Tokens.** Replace the variables in `app/globals.css` from `ink-theme.css` (light and dark). Charts untouched.
   Check: every page renders in both themes; contrast ≥4.5:1 for text, ≥3:1 for controls (values in 01 already pass).
2. **Glow strength function + config row.** Migration for `config.glow`; pure function in `lib/` with the unit test values from 01.
   Check: `npm test` passes with the four acceptance values.
3. **Dashboard poster.** Surface ground, glow layer, grain, value as one run at the new sizes, one capsule, today's dot; remove the pools line and 累計 chip.
   Check: at 402 px the value keeps ≥24 px clear of the right edge with the fallback font; the four states (小漲, 持平, 大跌, 里程碑) match the canvas.
4. **Rules fold.** `RuleBoard` as one disclosure row, closed by default, amber only.
   Check: keyboard and VoiceOver can open it; `aria-expanded` changes.
5. **Allocation and Holdings.** Amber watch / rebalance in `BandRow`; assumptions row; Holdings summary block and view chips; page washes on Holdings, Performance, Allocation.
   Check: no `--danger-*` or red ✕ left in rule UI (`git grep -n "danger" app components`).
6. **Dashboard bar buttons.** Person, search, bell lent to the shell (after Hugo answers open question 1); `placement: "leading"` in the shell for person.
   Check: in the simulator the bar shows person left and three glass buttons right, segmented control centred.
7. **Accessory tint and haptics.** Amber glass tint on `act` items; light impact on first appearance.
   Check: in the simulator and on a device; Reduce Transparency still readable.
8. **Swift Charts colours.** Pass colours in the chart specs; poster line end mark; performance, monthly bars, donut, sparkline per 03.
   Check: light, dark, and 綠漲紅跌 all correct on a device.
9. **Motion.** The opening sequence and the milestone ring (after Hugo gives the milestone list), with Reduce Motion fallbacks.
   Check: plays once after new data, not on every open; with Reduce Motion it fades.
10. **Copy and docs.** 「人生時間軸」 label; update CLAUDE.md's bilingual rule if Hugo agrees (open question 3); update the PRD's UI section to point here.

Out of scope: the home-screen widget, chart designs, navigation structure.
