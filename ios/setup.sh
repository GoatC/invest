#!/bin/bash
# Writes ios/Local.xcconfig: the site's host, your Apple team and the app's identifier, the three
# things the project needs that must stay out of git (docs/ios-app.md, step 4). Run it on the Mac,
# once, after adding your Apple ID in Xcode:  ./ios/setup.sh
set -euo pipefail
cd "$(dirname "$0")"
OUT=Local.xcconfig
# A name next to Chinese text is always written ${so}: the bash on a Mac (3.2) otherwise reads the
# first bytes of the next character as part of the name.

echo "長期投資 iOS App：寫入簽署設定（${OUT}，不會進 git）"
echo

# 1. The site.
read -r -p "網站網址（Vercel 上的網址，例如 my-app.vercel.app）： " host
host="${host#http://}"; host="${host#https://}"; host="${host%%/*}"
if [ -z "$host" ]; then echo "沒有輸入網址，已停止。"; exit 1; fi

# 2. The team: Xcode keeps the teams of the Apple IDs added under Settings > Accounts.
team="$(defaults read com.apple.dt.Xcode IDEProvisioningTeams 2>/dev/null | grep -m1 'teamID' | sed -E 's/[^A-Z0-9]*teamID[^A-Z0-9]*([A-Z0-9]{10}).*/\1/' || true)"
# Or the signing certificate Xcode made, whose "organizational unit" is the team.
if ! [[ "$team" =~ ^[A-Z0-9]{10}$ ]]; then
  team="$(security find-certificate -c 'Apple Development' -p 2>/dev/null | openssl x509 -noout -subject -nameopt multiline 2>/dev/null | awk -F'= ' '/organizationalUnitName/ {print $2; exit}' || true)"
fi
# Or the team chosen by hand in Xcode's Signing & Capabilities, which Xcode wrote into the project
# file: taken from there, and the project file put back as git has it.
if ! [[ "$team" =~ ^[A-Z0-9]{10}$ ]]; then
  team="$(grep -m1 -E 'DEVELOPMENT_TEAM = [A-Z0-9]{10};' LongView.xcodeproj/project.pbxproj | sed -E 's/.*= ([A-Z0-9]{10});.*/\1/' || true)"
  if [[ "$team" =~ ^[A-Z0-9]{10}$ ]]; then git checkout -- LongView.xcodeproj/project.pbxproj 2>/dev/null || true; fi
fi
if [[ "$team" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "找到 Apple 團隊代號（Team ID）：${team}"
else
  echo "Xcode 還沒有記下你的團隊代號（加入 Apple ID 後，要選過一次 Team 才會有）。請這樣做："
  echo "  1. 用 Xcode 打開 ios/LongView.xcodeproj。"
  echo "  2. 點左側最上方藍色圖示的 LongView，再點中間 TARGETS 底下的 LongView。"
  echo "  3. 點上方的 Signing & Capabilities，在 Team 選單選你的名字（Personal Team）。"
  echo "     下方出現紅色錯誤訊息沒關係。"
  echo "  4. 回到這裡，再執行一次 ./ios/setup.sh。"
  echo
  read -r -p "已經知道 10 碼的 Team ID 可以直接輸入；否則按 Enter 結束： " team
  if [ -z "$team" ]; then exit 1; fi
  if ! [[ "$team" =~ ^[A-Z0-9]{10}$ ]]; then echo "Team ID 應為 10 碼英數字，已停止。"; exit 1; fi
fi

# 3. The identifier: the same every week, so each install lands on the app already there.
bundle="app.longview.$(echo "$team" | tr 'A-Z' 'a-z')"

cat > "$OUT" <<CONFIG
// Written by ios/setup.sh. Yours alone: git ignores this file.
SITE_HOST = $host
DEVELOPMENT_TEAM = $team
BUNDLE_ID = $bundle
CONFIG

echo
echo "已寫入 ios/${OUT}："
cat "$OUT"
echo
echo "下一步：用 Xcode 打開 ios/LongView.xcodeproj，接上 iPhone，按 ▶（docs/ios-app.md 第 5 步）。"
