#!/usr/bin/env bash
# Deploy game/dist → richardbatt.com/international-cup via a single lftp session.
# Reads the FTP password from the FTP_PASS env var (never hardcode it). Usage:
#
#   cd game && npm run build && FTP_PASS='…' bash scripts/deploy-lftp.sh
#
# Why lftp (not scripts/deploy.mjs): the per-file curl deploy logs in once per
# file and trips stackcp's 530 rate-limit. A single lftp session avoids that.
# Why the force-put: `mirror --ignore-time` compares by SIZE only, and the rebuilt
# index.html is often the same byte size (only the hashed bundle names change), so
# the mirror SKIPS it and the live page keeps pointing at the old bundles. We
# force-`put` the small root entry files unconditionally after the mirror.
set -euo pipefail

FTP_USER="${FTP_USER:-richardbatt.com}"
FTP_HOST="${FTP_HOST:-ftp.gb.stackcp.com}"
FTP_DIR="${FTP_DIR:-/public_html/international-cup}"
DIST="$(cd "$(dirname "$0")/.." && pwd)/dist"

if [ -z "${FTP_PASS:-}" ]; then
  echo "ERROR: FTP_PASS is not set. Run: FTP_PASS='…' bash scripts/deploy-lftp.sh" >&2
  exit 1
fi
[ -f "$DIST/index.html" ] || { echo "ERROR: $DIST/index.html missing — run npm run build first." >&2; exit 1; }

# Root entry files to force-put (small; overwrite unconditionally).
ROOT_FILES=(index.html manifest.webmanifest sw.js .htaccess)
PUT_CMDS=""
for f in "${ROOT_FILES[@]}"; do
  [ -f "$DIST/$f" ] && PUT_CMDS+=$'\n'"put -O \"$FTP_DIR\" \"$DIST/$f\""
done
# workbox-*.js have hashed names — put whatever exists
for wb in "$DIST"/workbox-*.js; do
  [ -f "$wb" ] && PUT_CMDS+=$'\n'"put -O \"$FTP_DIR\" \"$wb\""
done

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT   # the script file holds the password — always delete it
cat > "$TMP" <<EOF
# Plain FTP (no TLS). The server advertises FTPS, but this account's login is
# rejected with a 530 over TLS — it only authenticates over PLAIN FTP, the same
# transport the proven scripts/upload-ftp.py uses successfully. Forcing FTPS just
# produced "530 Login failed". ssl-allow false keeps lftp on plain FTP so the
# deploy actually logs in. (The password therefore travels in clear text, exactly
# as upload-ftp.py already does — if stackcp later fixes FTPS auth, flip this back.)
set ftp:ssl-allow false
set net:max-retries 2
set net:timeout 20
open -u $FTP_USER,$FTP_PASS $FTP_HOST
mirror -R --ignore-time --parallel=3 --exclude '\.DS_Store$' "$DIST" "$FTP_DIR"$PUT_CMDS
bye
EOF

echo "==> lftp mirror + force-put → $FTP_HOST:$FTP_DIR"
lftp -f "$TMP"
rm -f "$TMP"; trap - EXIT

LIVE_BASE="${LIVE_BASE:-https://richardbatt.com/international-cup}"

urlencode_path() {
  python3 - "$1" <<'PY'
import sys
import urllib.parse

print(urllib.parse.quote(sys.argv[1], safe='/'))
PY
}

verify_app_shell_headers() {
  local headers
  headers="$(curl -sSI -m 25 "$LIVE_BASE/index.html?cb=$RANDOM" || true)"
  if ! printf '%s\n' "$headers" | tr -d '\r' | grep -iq '^cache-control: .*no-cache'; then
    echo "❌ live index.html is not returning no-cache headers — .htaccess may not be active." >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
}

echo "==> verify live hash"
BUILT=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "$DIST/index.html" | head -1)
sleep 2
LIVE=$(curl -s -m 15 "$LIVE_BASE/?cb=$RANDOM" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
echo "built: $BUILT"
echo "live:  $LIVE"
[ "$BUILT" = "$LIVE" ] || { echo "⚠️  live index.html does not match the build — re-run the deploy"; exit 1; }
verify_app_shell_headers

# Verify EVERY file in dist is actually reachable on the server, then re-upload
# anything missing. The mirror runs in parallel over a flaky plain-FTP link and
# can silently drop individual files; the old hash-only check passed even when
# the match-engine chunk (a dynamic import) had failed to upload — leaving the
# live game hanging the instant a match started, because `import('./matchRunner')`
# 404s. A dropped texture/model would likewise blank the pitch. So check every
# built file with a 1-byte range GET (cheap even for large models) and re-put any
# that are missing, over a few repair rounds.
echo "==> verify full deploy (every file in dist) + auto-repair"
ALL_FILES=()
while IFS= read -r f; do
  ALL_FILES+=("$f")
done < <(cd "$DIST" && find . -type f ! -name '.DS_Store' ! -name '.htaccess' | sed 's#^\./##')

repair_put() {
  # $@ = paths relative to $DIST; re-upload each, preserving its subdirectory.
  local rt; rt="$(mktemp)"
  {
    echo "set ftp:ssl-allow false"
    echo "set net:max-retries 3"
    echo "set net:timeout 25"
    echo "open -u $FTP_USER,$FTP_PASS $FTP_HOST"
    local f
    for f in "$@"; do
      echo "put -O \"$FTP_DIR/$(dirname "$f")\" \"$DIST/$f\""
    done
    echo "bye"
  } > "$rt"
  lftp -f "$rt" || true
  rm -f "$rt"
}

for round in 1 2 3; do
  MISSING=()
  for f in "${ALL_FILES[@]}"; do
    # 1-byte range GET: a present file returns 206 (or 200); a missing one 404.
    encoded_f=$(urlencode_path "$f")
    code=$(curl -s -r 0-0 -o /dev/null -w '%{http_code}' -m 25 "$LIVE_BASE/$encoded_f?cb=$RANDOM" || echo 000)
    case "$code" in 200|206) ;; *) MISSING+=("$f");; esac
  done
  if [ ${#MISSING[@]} -eq 0 ]; then
    echo "✅ all ${#ALL_FILES[@]} files verified live — deploy complete"
    break
  fi
  echo "⚠️  round $round: ${#MISSING[@]} file(s) missing on the server:"
  printf '   - %s\n' "${MISSING[@]}"
  if [ "$round" = "3" ]; then
    echo "❌ deploy still incomplete after 3 repair rounds — the live game WILL break. Re-run the deploy." >&2
    exit 1
  fi
  echo "==> re-uploading the missing files…"
  repair_put "${MISSING[@]}"
  sleep 2
done
