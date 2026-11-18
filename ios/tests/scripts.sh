#!/bin/bash
# Checks ios/setup.sh and ios/install.sh with the bash a Mac has (3.2), on GitHub Actions'
# macOS runners (.github/workflows/ios.yml). No Apple ID, no iPhone: what can be checked without them.
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "bash: $BASH_VERSION"
for file in setup.sh install.sh 重新安裝.command tests/scripts.sh; do bash -n "$file" || fail "$file does not parse"; done

# A name followed straight by a Chinese character: the bash on a Mac reads both as one name.
if perl -ne 'print "$ARGV:$.: $_" if /\$[A-Za-z_]\w*[^\x00-\x7f]/' setup.sh install.sh 重新安裝.command | grep .; then
  fail "a variable name runs into Chinese text: write it as \${name}"
fi

# setup.sh writes Local.xcconfig from what is typed (a host given as a full address is trimmed).
rm -f Local.xcconfig
printf 'https://example.vercel.app/\nABCDE12345\n' | ./setup.sh >/tmp/setup.out 2>&1 || { cat /tmp/setup.out; fail "setup.sh stopped"; }
grep -qx 'SITE_HOST = example.vercel.app' Local.xcconfig || { cat Local.xcconfig; fail "the host"; }
grep -qE '^DEVELOPMENT_TEAM = [A-Z0-9]{10}$' Local.xcconfig || { cat Local.xcconfig; fail "the team"; }
grep -qE '^BUNDLE_ID = app\.longview\.[a-z0-9]{10}$' Local.xcconfig || { cat Local.xcconfig; fail "the identifier"; }

# install.sh picks the paired, physical iPhone that is connected by cable over the rest.
picked="$(LONGVIEW_PICK_ONLY=1 LONGVIEW_DEVICES_JSON="$PWD/tests/devices.json" ./install.sh | grep '^picked')" || fail "no iPhone picked from the sample"
[ "$picked" = "$(printf 'picked\tAAAAAAAA-BBBB-CCCC-DDDD-000000000002\t00008150-0000000000000003\tconnected\twired')" ] || fail "picked the wrong one: $picked"

# With nothing connected (this runner), it says so and stops, after asking devicectl itself.
if out="$(LONGVIEW_PICK_ONLY=1 ./install.sh 2>&1)"; then fail "went on with no iPhone: $out"; fi
echo "$out" | grep -q "找不到 iPhone" || fail "no plain answer with no iPhone: $out"

rm -f Local.xcconfig
echo "scripts: all checks passed"
