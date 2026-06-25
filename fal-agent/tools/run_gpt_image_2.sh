#!/usr/bin/env bash
# Stream openai/gpt-image-2 result to a file, then decode the data URI to PNG.
# Args: <output-png-path> <payload-json>
set -e

OUT_PNG="$1"
PAYLOAD="$2"

KEY=$(grep '^FAL_KEY' /sessions/happy-vigilant-davinci/mnt/newrichbsite/fal-agent/.env | cut -d= -f2- | tr -d '"' | tr -d "'")
RAW="${OUT_PNG}.sse"

mkdir -p "$(dirname "$OUT_PNG")"
echo "POST start $(date -u +%H:%M:%S)" > "${OUT_PNG}.log"

curl -s --no-buffer --max-time 600 \
  -H "Authorization: Key $KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d "$PAYLOAD" \
  "https://fal.run/openai/gpt-image-2/stream" -o "$RAW"

echo "POST done $(date -u +%H:%M:%S) size=$(wc -c < "$RAW")" >> "${OUT_PNG}.log"

python3 - "$RAW" "$OUT_PNG" <<'PYEOF'
import base64, json, re, sys
raw = open(sys.argv[1], "rb").read().decode("utf-8", errors="replace")
events = re.findall(r"^data:\s*(\{.*\})\s*$", raw, flags=re.MULTILINE)
final = None
for ev in reversed(events):
    try:
        d = json.loads(ev)
    except json.JSONDecodeError:
        continue
    if isinstance(d, dict) and d.get("images"):
        final = d
        break
if not final:
    print(json.dumps({"error": "no images event found", "events": len(events)}))
    sys.exit(1)
url = final["images"][0]["url"]
if url.startswith("data:"):
    b64 = url.split(",", 1)[1]
    data = base64.b64decode(b64)
    open(sys.argv[2], "wb").write(data)
    print(json.dumps({"saved": sys.argv[2], "bytes": len(data)}))
else:
    import urllib.request
    urllib.request.urlretrieve(url, sys.argv[2])
    print(json.dumps({"saved": sys.argv[2], "url": url}))
PYEOF

echo "DONE $(date -u +%H:%M:%S)" >> "${OUT_PNG}.log"
