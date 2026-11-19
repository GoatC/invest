# Appearance Switch and Opening Screen B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 淺色｜深色｜自動 switch (light by default) that themes the whole app, and opening screen B shown in every theme, still unscrollable.

**Architecture:** The choice lives in this device's localStorage; a synchronous script at the top of `<head>` sets `<html data-theme="light|dark">` before the first paint, and Ink's dark tokens key off `data-theme` instead of `prefers-color-scheme`. The page tells the iOS shell the choice in its state message; the shell sets `overrideUserInterfaceStyle` and remembers it for the next launch. The opening screen (web `.splash`, native `CoverView`, launch images) is redrawn as B with fixed colours.

**Tech Stack:** Next.js App Router, CSS, TypeScript (`tsx --test`), Playwright e2e, Swift/UIKit.

**Spec:** `docs/superpowers/specs/2026-11-19-appearance-and-splash-design.md`

## Global Constraints

- Default `light`; choices `'light' | 'dark' | 'auto'`; anything else stored reads as `light`. localStorage key `theme`.
- `auto` resolves from `matchMedia('(prefers-color-scheme: dark)')` and follows its changes.
- theme-color: light `#fafbfa`, dark `#101613` (today's values in `app/layout.tsx`).
- Opening screen B, fixed colours in every theme: ground `#070b09`; glow top-right `#6fa3db` → `#34689c` → transparent, fades in once over 700 ms; white outline mark (rounded square, `rgba(255,255,255,.22)` rim) with a faint track, the white line drawn once over 700 ms, `cubic-bezier(0.16,1,0.3,1)`; 「長期投資」 20px bold, letter-spacing .14em; progress line 120×3, `#8db8ea` on `rgba(157,176,198,.22)`. No loops (Ink motion rule).
- Unscrollable while shown: `html` `overflow:hidden`, splash `touch-action:none`, `overscroll-behavior:none`.
- Reduced motion: line drawn and glow shown at once (≤150 ms fade), no movement.
- UI text Chinese only; English only in `aria-label`. Every control ≥44px.
- The layout reads nothing from the database.
- iOS: free signing, no new capability; `LaunchGround` both appearances `#070b09`.

## Review Focus

- localStorage blocked or throwing (private mode, shell sandbox): the page still paints light, no exception. (Task 1 test `survives a throwing localStorage`.)
- `auto` with the phone switching to dark while the app is open: the page and, in the shell, the native bars follow without a reload. (Task 2 e2e emulates `colorScheme: 'dark'` with `auto`; Task 4 maps `auto` to `.unspecified`.)
- Changing the switch inside the shell's account sheet: the page behind it and the native bars follow once the sheet closes, by the button or a swipe. (Task 4 Step 2.)
- A reload within the same visit: no opening screen, and the chosen theme from the first paint (no light flash on a dark choice). (Task 2 e2e reload check.)
- Touch-scrolling or tapping during the opening screen: the page under it does not move or react. (Task 3 e2e.)

---

### Task 1: `lib/theme.ts`

**Files:**
- Create: `lib/theme.ts`, `lib/theme.test.ts`

**Interfaces:**
- Produces:
  - `export type ThemeChoice = 'light' | 'dark' | 'auto'`; `export type Theme = 'light' | 'dark'`
  - `export const THEME_KEY = 'theme'`; `export const THEME_COLOR: Record<Theme, string> = { light: '#fafbfa', dark: '#101613' }`
  - `export function readTheme(stored: string | null | undefined): ThemeChoice`
  - `export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme`
  - `export const THEME_SCRIPT: string` (sync, self-contained: reads `localStorage[THEME_KEY]` in try/catch, resolves `auto` with matchMedia, sets `document.documentElement.dataset.theme`, sets `meta[name=theme-color]` content; never throws)
  - `export function applyTheme(choice: ThemeChoice): void` (stores the choice, sets `data-theme` and theme-color, keeps one `matchMedia` change listener while the choice is `auto`)
  - `export function storedTheme(): ThemeChoice` (reads localStorage safely)

- [ ] **Step 1: Write the failing tests**

```ts
describe('readTheme', () => {
  it('keeps the three choices and reads anything else as light', () => {
    assert.equal(readTheme('dark'), 'dark'); assert.equal(readTheme('auto'), 'auto'); assert.equal(readTheme('light'), 'light');
    for (const bad of [null, undefined, '', 'DARK', 'blue']) assert.equal(readTheme(bad), 'light');
  });
});
describe('resolveTheme', () => {
  it('follows the phone only for auto', () => {
    assert.equal(resolveTheme('auto', true), 'dark'); assert.equal(resolveTheme('auto', false), 'light');
    assert.equal(resolveTheme('light', true), 'light'); assert.equal(resolveTheme('dark', false), 'dark');
  });
});
describe('THEME_SCRIPT', () => {
  // Runs the script against a stand-in document, localStorage and matchMedia (new Function with those as parameters).
  it('marks dark before paint and sets the bar colour', () => { /* stored 'dark' → dataset.theme 'dark', meta content '#101613' */ });
  it('resolves auto from the phone', () => { /* stored 'auto', matchMedia dark true → 'dark' */ });
  it('paints light with nothing stored', () => { /* → 'light', '#fafbfa' */ });
  it('survives a throwing localStorage and a missing meta', () => { /* getItem throws, no meta → 'light', no exception */ });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx tsx --test lib/theme.test.ts` → FAIL, module missing.
- [ ] **Step 3: Implement** `lib/theme.ts` per Interfaces; `THEME_SCRIPT` is an IIFE string with no imports.
- [ ] **Step 4: Run to verify they pass** — same command → PASS.
- [ ] **Step 5: Commit** `lib/theme.ts lib/theme.test.ts` — "Theme choice: light by default, dark or auto, set before the first paint".

---

### Task 2: The whole app follows the choice

**Files:**
- Modify: `app/layout.tsx` (`<head>` script before anything else; `viewport.colorScheme: 'light'`; `themeColor: THEME_COLOR.light`)
- Modify: `app/globals.css` (lines ~81, ~605, ~3967: `@media (prefers-color-scheme: dark)` → `:root[data-theme='dark']`, `html[data-theme='dark'] .tab-bar`, `html[data-shell][data-theme='dark']`; add `:root{color-scheme:light}` `:root[data-theme='dark']{color-scheme:dark}`)
- Modify: `components/echarts.tsx:131-165` (MutationObserver on `document.documentElement` `attributeFilter: ['data-theme']` replaces the matchMedia listener)
- Create: `components/theme-switch.tsx` (client)
- Modify: `app/account/page.tsx` (first row of 偏好: `<ThemeSwitch />`)
- Modify: `lib/shell.ts` (`ShellState.theme?: ThemeChoice`; `shellState(..., opened?, theme?)`), `lib/shell.test.ts`
- Modify: `components/shell-bridge.tsx` (send `storedTheme()` in each state; observe `data-theme` beside `data-opened`; `longview.theme()` re-applies `storedTheme()`)
- Modify: `tests/e2e/drive.mjs` (one step)

**Interfaces:**
- Consumes: Task 1 (`THEME_SCRIPT`, `THEME_COLOR`, `applyTheme`, `storedTheme`, `ThemeChoice`).
- Produces: `ShellState.theme` (`'light'|'dark'|'auto'`, Task 4 reads it); `window.longview.theme(): void` (Task 4 calls it).
- `<ThemeSwitch />`: a row 「外觀」 and a segmented group of three `<button aria-pressed>` 「淺色」「深色」「自動」 (`aria-label` 「淺色 Light」 etc.), each ≥44px, state from `storedTheme()` after mount.

- [ ] **Step 1: Failing unit test** in `lib/shell.test.ts`:

```ts
it('tells the shell the appearance chosen', () => {
  assert.equal(shellState('/', false, true, undefined, undefined, true, 'auto').theme, 'auto');
  assert.equal('theme' in shellState('/', false, true), false);
});
```
Run `npx tsx --test lib/shell.test.ts` → FAIL.

- [ ] **Step 2: Implement** `lib/shell.ts`, the bridge, layout, CSS, echarts, the switch and the account row. Run `npx tsx --test lib/shell.test.ts && npm run typecheck` → PASS.

- [ ] **Step 3: e2e step** "appearance: light by default, dark and auto from 帳號, kept across a reload, charts redrawn": open `/account` → `html[data-theme]` is `light`; tap 深色 → `dark` and `body` background is the dark token; reload → still `dark` (read `data-theme` in the first `domcontentloaded`); tap 自動 with `page.emulateMedia({ colorScheme: 'dark' })` → `dark`, then `colorScheme: 'light'` → `light`; tap 淺色; 390px screenshot of the account page.

- [ ] **Step 4: Run** `npm test && E2E_NIGHTLY=0 TEXT_REPORT=… npm run test:e2e` → all ok; look at the screenshot and the account page's text report.

- [ ] **Step 5: Commit** — "Appearance: 淺色｜深色｜自動 on 帳號, light by default; the app no longer follows the phone".

---

### Task 3: Opening screen B (web) and the launch images

Load the `impeccable` skill and its `reference/craft-floor.md` before editing.

**Files:**
- Modify: `components/splash.tsx`, `app/globals.css` (`.splash*` block ~line 1991 and its reduced-motion block)
- Modify: `lib/splash.ts` (`SPLASH_GROUND = { light: '#070b09', dark: '#070b09' }`), `scripts/splash_images.ts` (draw B's still first frame: ground, top-right glow, outline mark with the faint track only); regenerate `public/splash/*` with `npm run splash-images`
- Modify: `tests/e2e/drive.mjs` (extend the "opening the app" step)

**Interfaces:**
- Consumes: `components/preload.tsx` keeps setting `--progress` on `.splash-progress > span` and adding `.leaving`; keep those class names.

- [ ] **Step 1: e2e first** (in the existing opening step, before the screen lifts): `.splash` background is `rgb(7, 11, 9)` in both a light and a dark choice; `document.documentElement` computed `overflow` is `hidden`; a `page.mouse.wheel(0, 600)` and a touch swipe leave `window.scrollY` at 0. Run → FAIL on the colour.
- [ ] **Step 2: Implement** per Global Constraints: glow layer as a child `div` with `animation: … 700ms … forwards`; the line a `polyline` with `stroke-dasharray`/`dashoffset` animated once; `html:has(#splash:not(.leaving))` → `overflow:hidden`; keep `.leaving`, the 12 s failsafe and `data-opened`.
- [ ] **Step 3: Regenerate** `npm run splash-images` (CHROMIUM=/opt/pw-browsers/chromium); open two of the PNGs to check them.
- [ ] **Step 4: Run** the e2e → ok; `E2E_DRIVER=bench.mjs npm run test:e2e` → not slower than before this branch (run it on `origin/main` first for the baseline).
- [ ] **Step 5: Commit** — "Opening screen B: ink-black, a glow from the top right, the mark's line drawn once; still unscrollable".

---

### Task 4: iOS shell

**Files:**
- Modify: `ios/Shell/ShellState.swift` (`let theme: String?` read from `fields["theme"]`)
- Modify: `ios/Shell/ShellViewController.swift` (apply the theme in `heard`; retheme the main page when the sheet closes)
- Modify: `ios/Shell/AppDelegate.swift` (`SceneDelegate` applies the stored style before `makeKeyAndVisible`)
- Modify: `ios/Shell/Screens.swift` (`CoverView` as B)
- Modify: `ios/Shell/Assets.xcassets/LaunchGround.colorset/Contents.json` (both `#070b09`), `scripts/ios_images.ts` (B's mark), regenerate `LaunchMark.imageset` with `npm run ios-images`

**Interfaces:**
- Consumes: `ShellState.theme`, `window.longview.theme()` (Task 2).
- Produces: `enum Appearance { static let key = "longview.theme"; static func style(_ choice: String?) -> UIUserInterfaceStyle }` (`"dark"` → `.dark`, `"auto"` → `.unspecified`, anything else `.light`), in `ShellState.swift`.

- [ ] **Step 1: Apply and remember.** In `heard(_:)`: when `new.theme` is non-nil and differs from the stored one, save it to `UserDefaults.standard` under `Appearance.key` and set `view.window?.overrideUserInterfaceStyle = Appearance.style(new.theme)`. In `SceneDelegate`, set `window.overrideUserInterfaceStyle = Appearance.style(UserDefaults.standard.string(forKey: Appearance.key))` before `makeKeyAndVisible`.
- [ ] **Step 2: The sheet.** Make `ShellViewController` the sheet's `presentationController?.delegate` (`UIAdaptivePresentationControllerDelegate`); in `presentationControllerDidDismiss` and in `closeSheet`'s dismiss completion, run `window.longview&&window.longview.theme&&window.longview.theme()` in the main web view.
- [ ] **Step 3: Cover B.** `CoverView`: `backgroundColor` `#070b09` (via `launchGround`); the `LaunchMark` image centred as now; a `CAGradientLayer(type: .radial)` from the top-right (`#6fa3db` at 0.66 alpha → `#34689c` at 0.3 → clear) faded in with a 0.7 s opacity animation; a `CAShapeLayer` tracing the mark's line (points 12,44 → 26,32 → 36,38 → 52,20 in the mark's 64-unit box, scaled to the image's frame), white, line width scaled from 5/64, round caps, `strokeEnd` 0 → 1 over 0.7 s with `CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)`; with `UIAccessibility.isReduceMotionEnabled`, `strokeEnd = 1` and the glow at full opacity at once. `lift()` unchanged.
- [ ] **Step 4: Assets.** `LaunchGround` both appearances `0x07 0x0B 0x09`; `scripts/ios_images.ts` draws `LaunchMark` as the outline mark with the faint track only (white rim at .22, track at .12, transparent inside); `npm run ios-images`; check the PNGs.
- [ ] **Step 5: Build on GitHub.** Push; wait for "iOS shell build" (both Xcodes, `look`); read `00-opening` (B cover) from the log. `bash ios/tests/scripts.sh` is unchanged (no script edited).
- [ ] **Step 6: Commit** — "iOS: the appearance chosen in the app, remembered for the next launch; the launch cover as B".

---

### Task 5: Docs, review, pull request

**Files:**
- Modify: `docs/ios-app.md` (section 10 item 1 → B cover; new item: 深色 in 帳號 turns the native bars dark, kept after reopening; 自動 follows the phone), `docs/PRD.md` (Section 5: the two decisions), `docs/design-handoff/02-components.md` (外觀 built: 淺色 default)
- Modify: `docs/superpowers/specs/2026-11-19-appearance-and-splash-design.md` 6.4 (the shell gets the choice, `auto` → `.unspecified`)

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** `npm run typecheck && npm test` → clean, all pass.
- [ ] **Step 3:** Final whole-branch review (one fresh reviewer, as agreed for these builds); fix Critical/Important with a failing test first.
- [ ] **Step 4:** Commit, push, open the PR to main (Chinese body, as recent PRs): what changed, what only Hugo's phone shows (the B cover drawing its line; 深色 turning the native bars; reopening keeps it; 自動 following the phone), verification results.
