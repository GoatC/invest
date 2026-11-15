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
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null

shot() {
  sleep "$2"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$1.png" >/dev/null 2>&1
  sips -Z 640 -s format jpeg -s formatOptions 50 "$OUT/$1.png" --out "$OUT/$1.jpg" >/dev/null
  echo "==LOOK $1 BEGIN=="
  base64 -i "$OUT/$1.jpg" | fold -w 120
  echo "==LOOK $1 END=="
}
tap() { xcrun simctl openurl "$UDID" "longview://tap?key=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1")"; }
page() { xcrun simctl openurl "$UDID" "longview://open?path=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1")"; }

shot 01-dashboard 8
tap /holdings;    shot 02-holdings 3
tap /performance; shot 03-performance 3
tap /holdings;    shot 04-holdings-again 3
page /__scroll/500; shot 05-holdings-scrolled 2
page /__scroll/0;   shot 06-holdings-top-again 2
tap more;         shot 07-more 3
tap /allocation;  shot 08-allocation 3
tap /;            shot 09-dashboard-again 3
page /performance; shot 10-performance-by-link 3
tap /holdings;    shot 11-holdings-third 3
