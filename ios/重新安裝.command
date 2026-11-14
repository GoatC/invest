#!/bin/bash
# Double-click in Finder: Terminal opens and runs ios/install.sh, the weekly reinstall
# (docs/ios-app.md, step 8). It can also sit in the Dock.
"$(dirname "$0")/install.sh"
status=$?
echo
read -r -n 1 -p "按任意鍵關閉這個視窗…"
exit $status
