#!/bin/bash
# Builds the iOS shell, signs it with your free Apple ID and installs it on your iPhone, in one go:
# the weekly reinstall (docs/ios-app.md, step 8). Run it from anywhere:  ./ios/install.sh
# or double-click ios/重新安裝.command in Finder. The iPhone is reached over the cable, or over
# Wi-Fi once Xcode has been told to (docs/ios-app.md). It uses a build folder of its own (ios/build,
# not in git), so nothing Xcode remembers from earlier builds gets in its way.
#
# Written for the bash every Mac has (3.2): a name next to Chinese text is always written ${so},
# and everything runs from main, read whole before it starts, so a `git pull` of a newer copy of
# this file cannot change it mid-run.
#
# For the check on GitHub Actions only: LONGVIEW_DEVICES_JSON names a `devicectl list devices`
# file to read instead of asking devicectl, and LONGVIEW_PICK_ONLY=1 stops once the iPhone is chosen.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/build"
LOG="$BUILD/last-build.log"
APP="$BUILD/Build/Products/Debug-iphoneos/LongView.app"

say() { printf '%s\n' "$*"; }
step() { printf '\n▸ %s\n' "$*"; }
stop() { printf '\n✕ %s\n' "$*" >&2; exit 1; }

# The first lines of an Xcode log that say what went wrong, for pasting to Claude.
show_errors() {
  say "—— 錯誤訊息（整段複製給 Claude）——"
  if grep -qE "error:|Error Domain|failed|Failed" "$1"; then
    grep -E "error:|Error Domain|failed|Failed" "$1" | head -15 || true
  else
    tail -20 "$1"
  fi
  say "—— 完整紀錄：ios/build/$(basename "$1") ——"
}

# The iPhones devicectl knows, best first: identifier, UDID, name, tunnel state, transport.
list_iphones() {
  local json="$1" script
  script="$(mktemp -t longview-devices)"
  cat >"$script" <<'JS'
ObjC.import('Foundation');
function run(argv) {
  var text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null);
  if (!text || text.isNil()) return '';
  var data;
  try { data = JSON.parse(ObjC.unwrap(text)); } catch (e) { return ''; }
  var list = (data.result && data.result.devices) || [];
  var rows = [];
  list.forEach(function (d) {
    var hw = d.hardwareProperties || {}, conn = d.connectionProperties || {}, props = d.deviceProperties || {};
    if (hw.platform && hw.platform !== 'iOS') return;
    if (hw.reality && hw.reality !== 'physical') return;
    if (conn.pairingState && conn.pairingState !== 'paired') return;
    if (conn.tunnelState === 'unavailable') return;
    var rank = (conn.tunnelState === 'connected' ? 0 : 2) + (conn.transportType === 'wired' ? 0 : 1);
    var clean = function (s) { return String(s || '').replace(/[\t\n\r]/g, ' '); };
    rows.push({ rank: rank, line: [clean(d.identifier), clean(hw.udid), clean(props.name) || 'iPhone', clean(conn.tunnelState), clean(conn.transportType)].join('\t') });
  });
  rows.sort(function (a, b) { return a.rank - b.rank; });
  return rows.map(function (r) { return r.line; }).join('\n');
}
JS
  osascript -l JavaScript "$script" "$json" 2>/dev/null || true
  rm -f "$script"
}

# A setting from Local.xcconfig.
setting() { sed -n -E "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*([^[:space:]]*).*/\\1/p" "$HERE/Local.xcconfig" | tail -1; }

main() {
  say "長期投資 iOS App：建置並安裝到 iPhone"

  # 0. Xcode itself, not only its command-line tools.
  if [ -z "${LONGVIEW_PICK_ONLY:-}" ]; then
    if ! xcodebuild -version >/dev/null 2>&1; then
      stop "找不到 Xcode。請先安裝 Xcode 並打開一次；若已安裝，在終端機執行：sudo xcode-select -s /Applications/Xcode.app"
    fi
  fi

  # 1. The newest copy of the shell, when the folder is on main with nothing changed by hand.
  local repo
  repo="$(cd "$HERE/.." && pwd)"
  if [ -z "${LONGVIEW_PULLED:-}" ] && [ -z "${LONGVIEW_PICK_ONLY:-}" ] && git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    if [ "$(git -C "$repo" rev-parse --abbrev-ref HEAD)" = "main" ] && [ -z "$(git -C "$repo" status --porcelain)" ]; then
      step "取得最新程式（git pull）"
      local before after
      before="$(git -C "$repo" rev-parse HEAD)"
      if git -C "$repo" pull --ff-only --quiet; then
        after="$(git -C "$repo" rev-parse HEAD)"
        if [ "$before" != "$after" ]; then
          say "已更新到最新版，重新開始。"
          LONGVIEW_PULLED=1 exec "$HERE/install.sh"
        fi
        say "已是最新版。"
      else
        say "（無法更新，先用手上的版本繼續。）"
      fi
    fi
  fi

  # 2. The settings that are yours alone.
  if [ -z "${LONGVIEW_PICK_ONLY:-}" ] && [ ! -f "$HERE/Local.xcconfig" ]; then
    step "第一次使用：先寫入簽署設定"
    "$HERE/setup.sh"
  fi

  # 3. The iPhone.
  step "尋找 iPhone"
  local json
  if [ -n "${LONGVIEW_DEVICES_JSON:-}" ]; then
    json="$LONGVIEW_DEVICES_JSON"
  else
    json="$(mktemp -t longview-list)"
    xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1 || true
  fi
  local phones
  phones="$(list_iphones "$json")"
  [ -n "${LONGVIEW_DEVICES_JSON:-}" ] || rm -f "$json"
  if [ -z "$phones" ]; then
    stop "找不到 iPhone。請用傳輸線接上、解鎖手機，手機若問「信任這部電腦？」請按信任，再執行一次。"
  fi
  local first id udid name state transport count
  first="$(printf '%s\n' "$phones" | head -1)"
  count="$(printf '%s\n' "$phones" | wc -l | tr -d ' ')"
  id="$(printf '%s' "$first" | cut -f1)"
  udid="$(printf '%s' "$first" | cut -f2)"
  name="$(printf '%s' "$first" | cut -f3)"
  state="$(printf '%s' "$first" | cut -f4)"
  transport="$(printf '%s' "$first" | cut -f5)"
  if [ "$transport" = "wired" ]; then say "找到：${name}（傳輸線）"; else say "找到：${name}（Wi-Fi）"; fi
  if [ "$count" -gt 1 ]; then say "（共 ${count} 台，用第一台；要換一台請只接那一台。）"; fi
  if [ -n "${LONGVIEW_PICK_ONLY:-}" ]; then
    printf 'picked\t%s\t%s\t%s\t%s\n' "$id" "$udid" "$state" "$transport"
    return 0
  fi

  # 4. Build and sign. Xcode's own account does the signing: the profile is made or renewed here,
  #    and the iPhone registered again when its 7 days are up.
  local destination="generic/platform=iOS"
  [ -n "$udid" ] && destination="platform=iOS,id=$udid"
  mkdir -p "$BUILD"
  local tries=0
  while :; do
    tries=$((tries + 1))
    step "建置並簽署（約 1–3 分鐘；Mac 若要求鑰匙圈密碼，輸入後按「永遠允許」）"
    if xcodebuild -project "$HERE/LongView.xcodeproj" -scheme LongView -configuration Debug \
      -destination "$destination" -derivedDataPath "$BUILD" \
      -allowProvisioningUpdates -allowProvisioningDeviceRegistration build >"$LOG" 2>&1; then
      say "建置完成。"
      break
    fi
    # A profile Xcode remembers but no longer has: start the build folder afresh, once.
    if [ "$tries" -eq 1 ] && grep -q "Build input file cannot be found" "$LOG" && grep -q "mobileprovision" "$LOG"; then
      say "清掉舊的簽署紀錄，再試一次。"
      rm -rf "$BUILD"
      mkdir -p "$BUILD"
      continue
    fi
    if grep -qiE "No Accounts|No Account for Team|not signed in|session has expired|Sign in with your Apple" "$LOG"; then
      stop "Xcode 沒有登入 Apple ID，或登入已過期：打開 Xcode → Settings → Accounts，加入或重新登入你的 Apple ID，再執行一次。"
    elif grep -qiE "Failed to register bundle identifier|cannot be registered to your development team|is not available" "$LOG"; then
      stop "App 識別碼被占用：打開 ios/Local.xcconfig，在 BUNDLE_ID 那一行最後加幾個英文字母，存檔後再執行一次。"
    elif grep -qiE "maximum number of|have reached the limit|App ID limit" "$LOG"; then
      stop "已達免費帳號的上限（每 7 天 10 個 App 識別碼、3 台裝置）：請等幾天，或不要再改 BUNDLE_ID。"
    elif grep -qiE "Developer Mode" "$LOG"; then
      stop "手機尚未開啟開發者模式：設定 → 隱私權與安全性 → 開發者模式，打開並重新開機後再執行一次。"
    elif grep -qiE "is locked|passcode" "$LOG"; then
      stop "手機是鎖定的：解鎖後再執行一次。"
    elif grep -qiE "requires a development team|No signing certificate|DEVELOPMENT_TEAM" "$LOG"; then
      stop "找不到簽署身分：重新執行 ./ios/setup.sh，再執行一次這個指令。"
    fi
    show_errors "$LOG"
    stop "建置失敗。"
  done

  # 5. Install over the app already there: what it keeps (the sign-in) stays.
  step "安裝到 ${name}"
  local out="$BUILD/last-install.log"
  if ! xcrun devicectl device install app --device "$id" "$APP" >"$out" 2>&1; then
    if grep -qiE "locked" "$out"; then stop "手機是鎖定的：解鎖後再執行一次。"; fi
    if grep -qiE "Developer Mode" "$out"; then stop "手機尚未開啟開發者模式：設定 → 隱私權與安全性 → 開發者模式。"; fi
    if grep -qiE "maximum|limit" "$out"; then stop "手機上的自簽 App 已達 3 個：刪掉一個不用的，再執行一次。"; fi
    show_errors "$out"
    stop "安裝失敗。"
  fi
  say "安裝完成。"

  # 6. Open it. The first time, iOS asks for the developer to be trusted before it will.
  local bundle
  bundle="$(setting BUNDLE_ID)"
  if [ -n "$bundle" ]; then
    step "開啟 App"
    if xcrun devicectl device process launch --terminate-existing --device "$id" "$bundle" >"$out" 2>&1; then
      say "已在手機上開啟。"
    elif grep -qiE "trust|not been explicitly trusted|Security" "$out"; then
      say "手機還沒信任你的開發者身分：設定 → 一般 → VPN 與裝置管理 → 點你的 Apple ID → 信任，再從主畫面打開。"
    else
      say "請從手機主畫面打開「長期投資」。"
    fi
  fi

  # 7. When it runs out: the date in the profile the build just signed with.
  local profile="$APP/embedded.mobileprovision" plist expires seconds
  if [ -f "$profile" ]; then
    plist="$(mktemp -t longview-profile)"
    if security cms -D -i "$profile" -o "$plist" 2>/dev/null; then
      expires="$(plutil -extract ExpirationDate raw -o - "$plist" 2>/dev/null || true)"
      seconds="$(TZ=UTC date -j -f '%Y-%m-%dT%H:%M:%SZ' "$expires" '+%s' 2>/dev/null || true)"
      if [ -n "$seconds" ]; then
        printf '\n✓ 完成。這一版可用到 %s，在那之前再執行一次即可。\n' "$(date -r "$seconds" '+%m/%d（%a）%H:%M')"
        rm -f "$plist"
        return 0
      fi
    fi
    rm -f "$plist"
  fi
  printf '\n✓ 完成。7 天內再執行一次即可。\n'
}

main
