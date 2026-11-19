# 外觀切換與新載入畫面 · Appearance switch and the new opening screen

日期：2026-11-19 · 提出：Hugo · 狀態：草稿，待 Hugo 核可

## 1. 為什麼

Hugo 想要好看一點的載入畫面，並且自己決定 App 是淺色還是深色，而不是跟著手機。三種載入畫面的比較頁：https://claude.ai/artifact/5Dk4KJX7JdAwKFi1mujW4N 。他選了 **B「夜幕光暈」**。

## 2. Hugo 的決定（2026-11-19）

- **載入畫面一律用 B**，不論 App 是淺色或深色。
- **App 預設是淺色**，不再跟著手機的深色模式。
- **設定裡有「淺色｜深色」切換**，讓他自己選。
- 載入畫面和現在一樣**不能滑動**：App 打開前，什麼都碰不到。
- 外觀切換做成全 App 的（網頁、圖表、iOS App 的原生列都跟著換），不只換載入畫面。

## 3. 要做到、不做、做了也算失敗

**要做到**
- 載入畫面 B：近黑底（`#0b1018`），左下角一團勿忘草藍光暈（緩慢呼吸），中間是白色線框圖示，圖示裡那條上升的線畫出來，下面是「長期投資」，底部一條細進度線。
- 淺色是所有新開啟的預設；選了深色，之後每次打開都是深色，直到再切回來。
- 切換後立刻生效，不必重新整理；圖表跟著重畫。
- iOS App：原生分頁列、導覽列、Swift Charts 跟著選擇；下次啟動一開始就是對的。
- 主畫面小工具不受影響，維持深色 B。

**不做**
- 「跟隨手機」選項（Hugo 要的是淺色預設，加上手動切換）。
- 重新設計淺色或深色的配色：沿用現有的兩套顏色。配色會在之後的 Claude Design session 整體重做。
- 在不同裝置之間同步這個選擇。

**做了也算失敗**
- 打開時先閃一下錯的顏色，或載入畫面在淺色和深色間跳動。
- 載入畫面可以被滑動、捲動，或底下的頁面露出來被點到。
- 為了等動畫，讓打開 App 變慢（載入畫面仍然在該消失時就消失）。
- 載入畫面的動畫在「減少動態」開啟時還在動。

## 4. 限制

- 版面框架（`app/layout.tsx`）不讀資料庫（CLAUDE.md：點擊要從記憶體立刻回應）。所以這個選擇要存在裝置上，並且在頁面畫出來之前就讀到。
- iPhone 第一個畫面（iOS 的啟動圖、網頁版的 startup image）是不會動的圖片，只能跟著手機的明暗。因為載入畫面一律是深色 B，兩種圖都畫成 B，就不會有落差。
- iOS 啟動圖（`UILaunchScreen`）只有一個底色加一張置中的圖，畫不了光暈。所以啟動圖是純 `#0b1018` 加圖示，光暈由接手的原生封面淡入。
- 免費簽署、Liquid Glass 規格、中文優先、字少、44px、對比 4.5:1 等規則照舊。

## 5. 考慮過的做法

| | 做法 | 取捨 |
|---|---|---|
| **A（採用）** | 選擇存在這台裝置上；頁面在畫出之前就由 `<head>` 裡的一小段程式掛上 `data-theme="dark"`；深色的顏色改成只在 `data-theme="dark"` 時套用，不再看手機設定。 | 改動最小、最穩。因為不再跟著手機，深色顏色只需寫一份，不必重複。 |
| B | 每個顏色都改寫成「淺色／深色一對」，切換時只告訴瀏覽器用哪一組。 | 顏色只有一個來源，但要改寫整份樣式表的每個顏色，風險大，而且配色很快就要重做。 |
| C | 存在資料庫，各裝置同步。 | 版面框架不能讀資料庫，每次打開都會先閃錯的顏色；外觀本來就是各裝置各自設定。 |

## 6. 決定好的做法

### 6.1 選擇存在哪、怎麼套用

- 新檔 `lib/theme.ts`：
  - `type Theme = 'light' | 'dark'`
  - `readTheme(stored: string | null): Theme`：只有 `'dark'` 算深色，其他（沒有、壞掉的值）一律 `'light'`；
  - `THEME_KEY = 'theme'`（localStorage 的鍵）；
  - `THEME_SCRIPT`：一段放在 `<head>` 最前面的同步小程式，讀 localStorage，選深色就在 `<html>` 掛 `data-theme="dark"`，並把 `<meta name="theme-color">` 換成深色值。讀不到就是淺色。
  - `applyTheme(theme)`：切換時用，更新 `data-theme`、theme-color 和 localStorage。
- `app/layout.tsx`：`<head>` 加入 `THEME_SCRIPT`；`viewport.colorScheme` 改成 `'light'`，`<html>` 的 `color-scheme` 由 CSS 依 `data-theme` 決定；`themeColor` 改成單一淺色值，由 `THEME_SCRIPT` 換成深色。
- `app/globals.css`：三個 `@media (prefers-color-scheme: dark)` 區塊（第 54、561、3648 行附近）改成 `:root[data-theme='dark']`、`html[data-theme='dark'] .tab-bar`、`html[data-shell][data-theme='dark']`。另加 `:root{color-scheme: light}`、`:root[data-theme='dark']{color-scheme: dark}`，讓表單元件與捲軸也跟著換。
- `components/echarts.tsx`：不再用 `matchMedia('(prefers-color-scheme: dark)')`，改看 `<html>` 的 `data-theme`，用 MutationObserver 觀察它，變了就重畫（和現在跟著手機變時的做法一樣）。
- 全專案再搜一次 `prefers-color-scheme`，把其他跟著手機明暗的地方也一併改掉（`lib/splash.ts` 的啟動圖除外，見 6.3）。

### 6.2 設定裡的開關

- 新元件 `components/theme-switch.tsx`（client）：一列「外觀」加上兩段式控制「淺色｜深色」。名稱照 CLAUDE.md 規則：寬螢幕中英並列，手機只顯示中文；每段至少 44px；選取中的一段用 `aria-pressed`。點了立刻 `applyTheme`。
- 放在兩個地方，都在「更新最新資料」旁邊：寬螢幕的「設定」選單（`components/site-nav.tsx` 的 `nav-menu`），以及手機的「更多」sheet（iOS App 的「更多」頁也是它）。不另開新頁面，所以不必改 `components/nav-pages.ts`。

### 6.3 載入畫面 B

- `components/splash.tsx` 與 `globals.css` 的 `.splash*`：
  - 底 `#0b1018`，加一層左下角的光暈（`radial-gradient`，勿忘草藍 `#6fa3db` → `#34689c` → 透明），以 5.2 秒緩慢呼吸（透明度與 1.06 倍縮放）；
  - 圖示：白色細框的圓角方塊，裡面先有一條淡淡的線軌，白線在 0.7 秒內畫出來（`stroke-dashoffset`，曲線 `cubic-bezier(0.16,1,0.3,1)`）；
  - 「長期投資」20px 粗體、字距 0.14em；
  - 底部一條 120×3 的細進度線（`#8db8ea`），沿用 `components/preload.tsx` 給的 `--progress`；
  - 不論 `data-theme` 都長這樣（只用固定顏色，不讀主題變數）。
- **不能滑動**：載入畫面還在時，`html` 加 `overflow: hidden`，載入畫面本身 `touch-action: none` 和 `overscroll-behavior: none`，擋住底下頁面的捲動與點擊。現有的 `.leaving` 淡出、12 秒保險淡出和 `data-opened` 照舊。
- **減少動態**：線直接畫好、光暈不呼吸，只保留淡入淡出。
- 離開：沿用現有 360ms 淡出，圖示略放大。
- `lib/splash.ts` 的 `SPLASH_GROUND` 改成 B 的底色，淺色、深色都是 `#0b1018`；`scripts/splash_images.ts` 改畫 B 的靜態第一格（底色、光暈、只有淡線軌的圖示），重新產生 `public/splash/*`。

### 6.4 iOS App

- `lib/shell.ts` 的 `ShellState` 加 `theme?: 'light' | 'dark'`，由 `components/shell-bridge.tsx` 每次回報時一起送出；`ios/Shell/ShellState.swift` 讀它（沒送時視為不變）。
- `ShellViewController` 收到後設定 `view.window?.overrideUserInterfaceStyle`（`.light`／`.dark`），原生分頁列、導覽列、sheet、Swift Charts 都跟著換，並存進 `UserDefaults`；`SceneDelegate` 建立視窗時先讀它（預設 `.light`），所以下次啟動一開始就是對的。
- 啟動畫面與封面改成 B：
  - `LaunchGround` 色票：淺色、深色都是 `#0b1018`；
  - `LaunchMark`（`scripts/ios_images.ts` 重畫）：白色線框圖示，只有淡淡的線軌；
  - `CoverView`（`ios/Shell/Screens.swift`）：同一個底色加上同一張圖示，再淡入左下角的光暈（`CAGradientLayer`，`.radial`），並用 `CAShapeLayer` 的 `strokeEnd` 在 0.7 秒內把白線畫出來；「減少動態」開啟時直接畫好；
  - 封面期間狀態列維持白字。
- `NoticeView` 等用到 `launchGround` 的地方會跟著變成近黑底，白字照樣看得清楚。

### 6.5 測試與確認

- `lib/theme.test.ts`：`readTheme` 的預設與壞值、`THEME_SCRIPT` 在沒有 localStorage 時不出錯（用一個假的 `document`／`localStorage` 執行）。
- `lib/shell.test.ts`：`shellState` 帶上 `theme`。
- e2e：在「更多」切到深色 → `<html data-theme="dark">`、背景變深色；重新整理後仍是深色；切回淺色。手機寬度下載入畫面是 B，並且在消失前無法捲動底下的頁面。390px 截圖與 TEXT_REPORT 都要看。
- `E2E_DRIVER=bench.mjs npm run test:e2e`：開啟速度不能比現在慢（CLAUDE.md 對外殼變動的要求）。
- 「iOS shell build」：兩個 Xcode 都編譯通過；`look` 的 `00-opening` 截圖要看到 B 的封面。
- `docs/ios-app.md` 第 10 節「請在手機上確認」更新第 1 項（啟動畫面），並新增一項：切換深色後原生列跟著變，重開 App 仍是深色。PRD 第 5 節記下這兩個決定。

## 7. 留給實作者的

- 光暈與呼吸動畫的細部數值（照比較頁 B 的樣子即可）。
- `THEME_SCRIPT` 怎麼放進 `<head>`（照 `components/splash.tsx` 的 `OPENED` 寫法）。
- theme-color 的深色值（深色主題的頁首底色）。
- CoverView 光暈的確切圖層做法。
