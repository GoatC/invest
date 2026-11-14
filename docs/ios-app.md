# iOS App（免費簽署的原生外殼）

把「長期投資」裝成 iPhone 上的原生 App：分頁列是 iOS 自己畫的 Liquid Glass，內容仍是同一個網站。

The iOS shell: the system tab bar (Liquid Glass) over one web view of the same site. Free signing with a personal Apple ID; rebuilt and reinstalled every 7 days. The web app (PWA) stays as it is.

## 先知道這幾件事

- **它是什麼**：一個很薄的 App。分頁列是原生的，頁面是 Vercel 上的同一個網站，資料在同一個 Supabase。網站更新後 App 立刻跟著更新，不必重裝。
- **每 7 天要重裝一次**：免費 Apple ID 簽的 App 只有 7 天效期。到期後 App 打不開，接上 Mac 再按一次 ▶ 就好（第 8 節），資料與登入都會保留。
- **不要刪除 App 再裝**：直接覆蓋安裝。刪除會清掉登入狀態，要重新登入。
- **收不到推播**：免費簽署的 App 沒有推播，App 裡的網頁也收不到網頁推播。**主畫面上原本的網頁版請留著**，推播由它收。App 改用手機自己排的提醒，只涵蓋可預知的事（見第 9 節）。
- **其他限制**（Apple 官方）：一台手機最多 3 個自簽 App；每 7 天最多註冊 10 個 App 識別碼、3 台裝置。

## 1. 需要準備

- Mac，已安裝 Xcode（你有了）。
- iPhone，以及一條傳輸線。
- 你的 Apple ID（一般帳號即可，不必付費）。
- 這個 repo 在 Mac 上的資料夾 `invest`。

## 2. 取得最新程式

這一步把 GitHub 上最新的程式抓到 Mac。打開「終端機」，進入 `invest` 資料夾：

```bash
cd ~/invest        # 換成你的資料夾位置
git pull
```

Mac 上還沒有這個資料夾的話，改執行：

```bash
git clone https://github.com/GoatC/invest.git
cd invest
```

## 3. 在 Xcode 加入 Apple ID

這一步讓 Xcode 能用你的 Apple ID 簽署 App。只需做一次。

1. 打開 Xcode。
2. 選單列 **Xcode → Settings…**，點 **Accounts**（或 Apple Accounts）。
3. 按左下角 **＋**，選 **Apple Account**，輸入 Apple ID 與密碼。
4. 完成後列表會出現你的帳號，右邊寫著 **Personal Team**。這就是免費的簽署身分。

## 4. 寫入簽署設定

這一步產生一個只存在你 Mac 上的設定檔 `ios/Local.xcconfig`，裡面有三樣東西：網站網址、你的 Apple 團隊代號、App 的識別碼。repo 是公開的，所以這個檔案不會進 git。只需做一次。

在終端機（`invest` 資料夾內）執行：

```bash
./ios/setup.sh
```

它會問你**網站網址**：貼上 Vercel 的網址，例如 `my-app.vercel.app`。團隊代號它會自己找。

看到「已寫入 ios/Local.xcconfig」就完成了。

如果它說找不到團隊代號：加入 Apple ID 後，Xcode 要選過一次 Team 才會記下代號。請這樣做，再執行一次 `./ios/setup.sh`：

1. 用 Xcode 打開 `ios/LongView.xcodeproj`。
2. 點左側最上方藍色圖示的 **LongView**，再點中間 **TARGETS** 底下的 **LongView**。
3. 點上方的 **Signing & Capabilities**，在 **Team** 選單選你的名字（後面寫著 Personal Team）。下方出現紅色錯誤訊息沒關係。

腳本會從專案檔讀出代號、寫進 `ios/Local.xcconfig`，並把專案檔還原。還是不行的話，把畫面上的文字貼給 Claude。

## 5. 準備 iPhone

只需做一次。

1. 用傳輸線把 iPhone 接上 Mac。手機跳出「信任這部電腦？」時按**信任**，輸入手機密碼。
2. 開啟**開發者模式**（iOS 要求，才能執行自己簽的 App）：
   - 手機上 **設定 → 隱私權與安全性 → 開發者模式**，打開。
   - 手機會要求重新啟動；重開後再按一次**開啟**並輸入密碼。
   - 找不到「開發者模式」這一項時，先做第 6 節按一次 ▶，它就會出現。

## 6. 建置並安裝

這一步把程式編譯成 App、用你的 Apple ID 簽署、裝進手機。一個指令做完，不必打開 Xcode。

1. iPhone 用傳輸線接上 Mac，並解鎖。
2. 在終端機（`invest` 資料夾內）執行：

   ```bash
   ./ios/install.sh
   ```

   也可以在 Finder 打開 `invest/ios`，**雙擊「重新安裝.command」**，效果相同。
3. 第一次大約 1–3 分鐘。過程中 Mac 可能要求輸入登入密碼以使用「鑰匙圈」裡的簽署憑證：輸入後按**永遠允許**，之後就不會再問。
4. 看到「✓ 完成。這一版可用到 …」就裝好了，日期是這一版到期的時間。

出現錯誤時，指令會用中文說明該怎麼做；看不懂的話，把「錯誤訊息」那一段整段貼給 Claude。

**也可以用 Xcode 安裝**：雙擊 `ios/LongView.xcodeproj`，上方裝置選單選你的 iPhone，按 ▶。Xcode 若問要不要「Update to recommended settings」，請按**取消**。

## 7. 第一次開啟：信任開發者

第一次裝好時，手機會說「未受信任的開發者」而不讓 App 開啟。這是 iOS 對自簽 App 的保護，需要你確認一次：

1. 手機上 **設定 → 一般 → VPN 與裝置管理**。
2. 在「開發者 App」底下點你的 Apple ID。
3. 按**信任**。手機需要連上網路。
4. 回主畫面，點「長期投資」。

接著用原本的帳號密碼**登入一次**。之後開啟 App、每週重裝都不必再登入。

## 8. 每週重裝

App 到期（裝好後第 7 天）就打不開，資料與登入不會消失。重裝一次就好：

1. iPhone 接上 Mac（或設定好下面的 Wi‑Fi 重裝），解鎖。
2. 雙擊 `ios/重新安裝.command`（或在終端機執行 `./ios/install.sh`）。
3. 等它顯示「✓ 完成」。

它會順便取得最新程式（`git pull`），再建置、簽署、安裝並打開 App，最後告訴你下次的到期日。不必等到過期：任何時候執行都會重新起算 7 天。

**放進 Dock，以後點一下就好**：把 Finder 裡的「重新安裝.command」拖到 Dock 右側（垃圾桶旁邊）。

### 不接線，用 Wi‑Fi 重裝（選用）

設定一次之後，Mac 和 iPhone 在同一個 Wi‑Fi、手機解鎖，就能直接執行，不必接線：

1. 先用傳輸線接上。
2. 打開 Xcode，選單列 **Window** 底下打開裝置視窗（名稱是 **Devices and Simulators** 或 **Device Hub**，依 Xcode 版本而定）。
3. 左側點你的 iPhone，勾選 **Connect via network**。
4. 拔掉傳輸線。之後執行重裝指令時，畫面會顯示「找到：你的 iPhone（Wi-Fi）」。

Wi‑Fi 比傳輸線慢，偶爾會找不到手機；找不到時接上傳輸線即可。

## 9. App 內提醒與從推播跳進 App

### App 內提醒

App 不能收推播，所以「可以事先知道」的提醒改由手機自己排：

- **每週檢視**：在你設定的每週檢視時間。
- **事件前**：聯準會、CPI 等事件的前幾天（天數同推播設定），早上 08:00。
- **配息日**：持股的配息發放日，早上 08:00。
- **重裝提醒**：這一版到期的前一晚 20:00，提醒你接上 Mac 執行重新安裝。

規則警示、波動警報、新聞這類**突發**的通知無法事先排，仍只由主畫面的網頁版推播。

**第一次開啟這個版本時**，手機會問「長期投資想傳送通知」，請按**允許**。之後每次開啟 App，都會重新排好未來 14 天的提醒。

**開關在哪裡**：App 裡 更多 → 推播 →「App 內提醒」。

- 這裡也會顯示「已排幾則」與「這一版幾月幾日到期」。
- 網頁版已經在推播時，前三項預設關閉，以免同一件事收到兩次。之後不再用網頁版收推播時，把它們打開即可。
- 顯示「通知未允許」時：到手機的 設定 → 通知 → 長期投資，打開「允許通知」。

### 點網頁版的推播，改開 App（選用）

想讓網頁版的推播一點就跳到 App 的同一頁：

1. 打開**主畫面的網頁版**（不是 App），到 更多 → 推播。
2. 勾選「點推播改開 iOS App」。

之後點推播時，網頁版會先打開，再請 iOS 改開 App；iOS 可能會先問一次「要在『長期投資』中打開嗎？」。App 過期或刪除後，請把這個勾選取消。

## 10. 請在手機上確認

外殼是在沒有 Xcode 的環境寫的：能不能編譯已由 GitHub 上的 Xcode 檢查過，但下面這些只有實機看得到。請逐項試，有問題告訴 Claude。

1. 啟動畫面：藍底白色標誌，接著同一個畫面出現進度條，沒有閃白。
2. 登入頁沒有分頁列；登入後底部出現玻璃分頁列，順序為 持倉、績效、儀表板、配置、更多，儀表板被選取。
3. 點每個分頁：頁面立刻出現，分頁列的選取跟著移動。
4. 在績效頁點「歸因」子分頁：分頁列仍選在績效。
5. 點「更多」：整頁清單；點「規則」後分頁列仍選在更多。再點別的分頁能離開。
6. 往下捲：分頁列縮小；往上捲恢復。
7. 持倉頁的「＋」是右上角的玻璃圓鈕，點它開啟新增交易；頁面最底部的內容沒有被分頁列蓋住。
8. 儀表板的海報延伸到螢幕最上方，狀態列的時間與電量是白色、看得清楚。
9. 刪除一筆測試交易：會跳出確認視窗，按取消不會刪。
10. 點一個外部來源連結：由 Safari 開啟，回到 App 仍在原頁。
11. 把 App 滑掉重開：不必重新登入。
12. 下週重裝後：不必重新登入。
13. 第一次開啟這個版本時，手機詢問是否允許通知；按允許後，更多 → 推播 的「App 內提醒」顯示「已排 N 則」與到期日。
14. 在「App 內提醒」把每週檢視打開：到了每週檢視時間，手機跳出「每週檢視」通知；點它會打開儀表板。
15. 到期前一晚 20:00 收到「長期投資明天到期」。
16. （選用）網頁版勾選「點推播改開 iOS App」後，傳一則測試推播並點它：會改開 App。
17. 持倉、績效、配置與「更多」的頁名是 iOS 的大標題，往下捲時縮成置中的一行；頁面內容沒有被標題蓋住，網頁自己的「長期投資」頁首不再出現。
18. 點一檔持股進入走勢頁：左上角有返回鈕，點它或從螢幕左緣往右滑，都回到持倉。
19. 儀表板右上角的「更新最新資料」是玻璃圓鈕；往下捲過海報後，狀態列的字變成深色（深色模式時維持白色）。
20. 有提醒時（例如規則警示、待登錄的配息），分頁列上方出現一顆玻璃膠囊，顯示第一則與「＋N」；頁面裡不再有橫幅。點它開到要處理的頁面；按住它選「稍後再說」會收起。往下捲讓分頁列縮小時，膠囊併到同一列。

## 11. 回報問題時請附上

- **編譯或安裝失敗**：Xcode 左側點紅色驚嘆號，選取錯誤訊息，按右鍵 **Copy** 貼給 Claude；整個視窗的截圖也有幫助。
- **App 裡的畫面不對**：手機截圖，並說明是哪一頁、做了什麼。
- **版本**：Xcode 版本（選單 Xcode → About Xcode）與手機的 iOS 版本。

## 常見狀況

| 畫面上的訊息 | 原因與做法 |
|---|---|
| App 顯示「尚未設定網站」 | 沒有 `ios/Local.xcconfig`：做第 4 節，再按 ▶。 |
| App 顯示「連不上網站」 | 手機沒有網路，或網址打錯：按重試；網址錯就重做第 4 節。 |
| Build input file cannot be found: '…/Provisioning Profiles/….mobileprovision'（在 Xcode 按 ▶ 時） | Xcode 記著一個已經不在的簽署檔：改用 `./ios/install.sh`，它用自己的建置資料夾，遇到這個錯誤會清掉重試。仍要用 Xcode 的話，先按 Product → Clean Build Folder。 |
| 找不到 iPhone | 接上傳輸線、解鎖；手機問「信任這部電腦？」時按信任。用 Wi‑Fi 時，確認兩邊在同一個網路。 |
| Xcode 沒有登入 Apple ID，或登入已過期 | Xcode → Settings → Accounts，重新登入 Apple ID。 |
| Signing for "LongView" requires a development team | 第 4 節沒有找到團隊代號：重新執行 `./ios/setup.sh`。 |
| Failed to register bundle identifier | 識別碼與別人的重複：打開 `ios/Local.xcconfig`，在 `BUNDLE_ID` 最後加幾個字母，存檔再按 ▶。 |
| Developer Mode disabled | 做第 5 節的開發者模式。 |
| 未受信任的開發者 | 做第 7 節。 |
| 「長期投資」已無法使用 | 7 天到期：執行重裝指令（第 8 節）。 |
| 已達 App 數量上限 | 手機上已有 3 個自簽 App：刪掉一個不用的。 |

## 不想用了

長按主畫面的 App 圖示刪除即可。網頁版與資料完全不受影響。

## 給之後維護的人 For maintainers

- 外殼與網頁之間的約定在 `lib/shell.ts`；網頁那一側是 `components/shell-bridge.tsx` 與 `app/globals.css` 的 `html[data-shell]`，原生那一側是 `ios/Shell/`。分頁的名稱、順序與歸屬由網頁決定並傳給外殼。
- `ios/LongView.xcodeproj` 由 `ruby ios/project.rb` 產生（需要 `gem install xcodeproj`）；新增或移除 Swift 檔後重跑。圖示與啟動標誌由 `npm run ios-images` 產生。
- `.github/workflows/ios.yml` 在 `ios/` 有變動時，用 Xcode 26 與 Xcode 27 各編譯一次（模擬器、不簽署），並以 Mac 內建的 bash 3.2 跑 `ios/tests/scripts.sh`：檢查兩支腳本的語法、變數名稱沒有緊接中文字、`setup.sh` 寫出的設定、`install.sh` 從 `ios/tests/devices.json` 選出正確的 iPhone，以及沒有手機時的訊息。
- `ios/install.sh` 用 `xcodebuild -allowProvisioningUpdates -allowProvisioningDeviceRegistration` 簽署（用 Xcode 裡登入的 Apple ID，7 天到期的裝置註冊也會重做），`xcrun devicectl` 安裝與開啟，建置資料夾是 `ios/build`（不進 git）。
- 不使用任何需要付費帳號的能力（推播、關聯網域、App 群組等），免費簽署才簽得過。本機通知與自訂網址 `longview://` 不需要。
- App 內提醒：`lib/models/local-reminders.ts` 決定未來 14 天要排哪些（與推播同一套設定與文字），`app/shell/reminders` 提供給 App 內的網頁，`components/shell-bridge.tsx` 依這台手機的選擇（`components/shell-reminders.tsx`）交給原生端，`ios/Shell/Reminders.swift` 排程並加上到期提醒（讀 App 內的 `embedded.mobileprovision`）。
- 從推播跳進 App：`public/sw.js` 在點推播開啟的網址加上 `via=push`，`components/push-handoff.tsx` 依這台裝置的選擇改開 `longview://open?path=…`，`ios/Shell/Reminders.swift` 的 `Router` 只接受站內路徑。
