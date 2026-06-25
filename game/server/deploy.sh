#!/usr/bin/env bash
# Deploy the Grayson realtime/matchmaking/TURN changes to the shared Lightsail box.
# Backward-compatible (the basketball client is unaffected) — backs up the live
# files first and verifies after. Run from the game/ directory:
#
#   bash server/deploy.sh
#
set -euo pipefail

KEY="${KEY:-../LightsailDefaultKey-eu-west-2 (1).pem}"
HOST="${HOST:-ubuntu@13.135.42.82}"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$HOST")

echo "==> backing up live files to /opt/grayson-api/.bak-rt/"
"${SSH[@]}" 'cd /opt/grayson-api && mkdir -p .bak-rt && for f in matchmaking.mjs realtime.mjs api.mjs; do cp -v "$f" ".bak-rt/$f.$(date +%s)"; done'

echo "==> uploading updated files"
for f in matchmaking.mjs realtime.mjs api.mjs turn.mjs; do
  scp -i "$KEY" -o BatchMode=yes "server/$f" "$HOST:/opt/grayson-api/$f"
  echo "    pushed $f"
done

echo "==> restarting services"
"${SSH[@]}" 'sudo systemctl restart grayson-rt grayson-api && sleep 1 && systemctl is-active grayson-rt grayson-api'

echo "==> health + TURN endpoint"
curl -s -m 10 https://api.graysongames.com/health; echo
curl -s -m 10 https://api.graysongames.com/api/turn | head -c 400; echo

echo "==> live matchmaking check (soccer pairing + cross-game isolation + legacy)"
node server/livecheck.mjs all

echo "==> DONE. Rollback if needed: cp /opt/grayson-api/.bak-rt/<file>.<ts> back and restart."
