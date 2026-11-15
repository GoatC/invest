#!/bin/bash
# Runs the iOS shell in an iPhone 17 Pro simulator against ios/tests/look/index.html, a stand-in for
# the site that talks to the shell as the site does, and screenshots each step: opening on the
# dashboard, tapping tabs, scrolling, the More list. The screenshots are what only a phone showed
# before (the native bars). On GitHub Actions' macOS runners (.github/workflows/ios.yml), which have
# Xcode; each shot is also printed small, as base64 between markers, so it can be read from the log.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${LOOK_OUT:-${RUNNER_TEMP:-/tmp}/look}"
BUILD="${RUNNER_TEMP:-/tmp}/look-build"
PORT=8123
mkdir -p "$OUT"
rm -f "$OUT"/*

python3 ios/tests/look/serve.py "$PORT" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT

# The simulator: an iPhone 17 Pro on the newest iOS this Xcode has.
RUNTIME="$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS" and x["isAvailable"]]; print(sorted(r, key=lambda x: [int(p) for p in x["version"].split(".")])[-1]["identifier"])')"
TYPE="$(xcrun simctl list devicetypes -j | python3 -c 'import json,sys; t=[x["identifier"] for x in json.load(sys.stdin)["devicetypes"] if x["name"]=="iPhone 17 Pro"]; print(t[0] if t else "")')"
[ -n "$TYPE" ] || TYPE="$(xcrun simctl list devicetypes -j | python3 -c 'import json,sys; t=[x["identifier"] for x in json.load(sys.stdin)["devicetypes"] if x["name"].startswith("iPhone") and "Pro" in x["name"]]; print(t[-1])')"
echo "runtime $RUNTIME, device $TYPE"
UDID="$(xcrun simctl create look "$TYPE" "$RUNTIME")"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl status_bar "$UDID" override --time 14:12 --batteryState charged --batteryLevel 100 --cellularBars 4 >/dev/null 2>&1 || true

xcodebuild -project ios/LongView.xcodeproj -scheme LongView -configuration Debug -sdk iphonesimulator \
  -destination "id=$UDID" -derivedDataPath "$BUILD" CODE_SIGNING_ALLOWED=NO SITE_HOST="127.0.0.1:$PORT" build >"$OUT/build.log" 2>&1 \
  || { tail -40 "$OUT/build.log"; exit 1; }
APP="$BUILD/Build/Products/Debug-iphonesimulator/LongView.app"
codesign --force --sign - --timestamp=none "$APP" >/dev/null 2>&1 || true
BUNDLE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"
xcrun simctl install "$UDID" "$APP"
# What the app does by itself, seconds after it opens (ShellViewController.runLookScript, debug
# builds only): taps on tabs as a finger gives them, and lines run in the page.
SCRIPT="8 tap /holdings; 14 tap /performance; 20 tap /holdings; 26 js scrollTo(0,500); 31 js scrollTo(0,0); 36 tap more; 42 tap /allocation; 48 tap /; 54 js window.longview.open('/performance'); 60 tap /holdings; 66 js window.longview.segment(2)"
SIMCTL_CHILD_LOOK_SCRIPT="$SCRIPT" xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
START=$(date +%s)

# A screenshot `$2` seconds after the app opened, printed small as base64 between markers.
shot() {
  local wait=$(( $2 - ($(date +%s) - START) ))
  [ "$wait" -gt 0 ] && sleep "$wait"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$1.png" >/dev/null 2>&1
  sips -Z 640 -s format jpeg -s formatOptions 50 "$OUT/$1.png" --out "$OUT/$1.jpg" >/dev/null
  echo "==LOOK $1 BEGIN=="
  base64 -i "$OUT/$1.jpg" | fold -w 120
  echo "==LOOK $1 END=="
}

shot 01-dashboard 6
shot 02-holdings 12
shot 03-performance 18
shot 04-holdings-again 24
shot 05-holdings-scrolled 29
shot 06-holdings-top-again 34
shot 07-more 40
shot 08-allocation 46
shot 09-dashboard-again 52
shot 10-performance-by-link 58
shot 11-holdings-third 64
shot 12-holdings-segment 70
