# 03 iOS shell and Swift Charts

The shell already draws the right things natively (`ios/Shell/ShellViewController.swift`): the system tab bar
(Liquid Glass), the one-line centred navigation bar with the page's controls as glass buttons, the sub-tabs as a
`UISegmentedControl` in the bar's middle (G03), and the tab-bar accessory `NextView` (G04,
`ios/Shell/Screens.swift`). Keep all of it. Changes:

## Navigation bar

- Keep the one-line centred title; no large titles (Hugo 2026-11-16).
- Dashboard: the page lends four controls with `data-shell-action` / `data-shell-symbol`: person (left, `person.crop.circle`), search (`magnifyingglass`), bell (`bell`, with a badge dot when something is unread), refresh (`arrow.clockwise`, exists). The shell needs a left item from the page's list (today only `back` uses the left side): add a `placement: "leading"` field to an action. What search and person open is open question 1.
- Sub-tabs stay in the segmented control, Allocation's five included (`apportionsSegmentWidthsByContent` already set). Check the five at the largest Dynamic Type size on a device.

## 「下一步」 accessory (rule warnings)

- `NextView` already shows the first banner with `exclamationmark.circle.fill` in `.systemOrange` for `act` items. Add the amber tint to the glass for `act` items: wrap the content in a `UIVisualEffectView` with `UIGlassEffect()` whose `tintColor` is `UIColor.systemOrange.withAlphaComponent(0.12)`, or the iOS 26 equivalent on `UITabAccessory`. Do not hand-draw translucency.
- Text stays one line, subheadline, truncating; 「＋N」 in secondaryLabel; chevron in tertiaryLabel; long-press 「稍後再說」 (exists).
- On first appearance of an `act` item: one `UIImpactFeedbackGenerator(style: .light)` impact. Never repeat while it stays.

## Haptics (`components/shell-bridge.tsx` → `haptic` handler)

| Event | Haptic |
| --- | --- |
| Save confirmed (exists) | success |
| Something refused (exists) | warning |
| Rule accessory appears | light impact (shell side) |
| Milestone crossed (new) | success, once |

## Swift Charts (`ios/Shell/NativeCharts.swift`, `lib/native-chart.ts`)

Charts keep their current design; only colours and the poster line's end mark change.

| Chart | Colours |
| --- | --- |
| Poster line | stroke = label colour (`--text`), 3 pt round; zero rule dashed at 40 %; new `PointMark` at the last point, 5 pt, filled `--up` / `--down` / `--flat`, 2.5 pt ring in surface |
| Performance line | portfolio `--accent`, benchmark `--chart-context`; trailing y axis, horizontal grid, month labels (system default) |
| Monthly returns `BarMark` | each bar `--up` or `--down` by sign |
| Donut `SectorMark` | `--chart-1` … `--chart-8` as today; inner target ring at 45 % opacity; `angularInset` 1, `cornerRadius` 4 |
| VaR sparkline | `--chart-context` line, today's point `--chart-1` |

Pass the colours from the page in the spec (as the line spec already passes `lineWidth`), so light / dark and
the 紅漲綠跌 setting are decided in one place.

## Widget

`ios/Widget/*`: unchanged. The home-screen widget stays dark B.
