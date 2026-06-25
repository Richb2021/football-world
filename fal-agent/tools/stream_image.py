#!/usr/bin/env python3
"""Stream an image from openai/gpt-image-2 (or similar) and save as PNG.

Usage:
    python3 stream_image.py <endpoint> <output_path> <payload_json>

The payload should include {"sync_mode": true} so the result comes back as a
data URI in the SSE stream rather than via the request-history endpoint.
"""
import base64
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fal_cli import load_dotenv  # type: ignore

load_dotenv()

if len(sys.argv) < 4:
    print("usage: stream_image.py <endpoint> <output_path> <payload_json>", file=sys.stderr)
    sys.exit(2)

endpoint = sys.argv[1]
output_path = sys.argv[2]
payload = json.loads(sys.argv[3])
payload.setdefault("sync_mode", True)

api_key = os.environ.get("FAL_KEY")
if not api_key:
    print("FAL_KEY not set", file=sys.stderr)
    sys.exit(3)

url = f"https://fal.run/{endpoint}/stream"
body = json.dumps(payload).encode()
req = urllib.request.Request(
    url,
    data=body,
    method="POST",
    headers={
        "Authorization": f"Key {api_key}",
        "Content-Type": "application/json",
    },
)

print(f"POST {url}", file=sys.stderr)

# Read the SSE stream and capture every "data:" event payload.
events = []
with urllib.request.urlopen(req, timeout=600) as resp:
    buf = b""
    while True:
        chunk = resp.read(65536)
        if not chunk:
            break
        buf += chunk
        # Try to split on double newline (SSE event boundary).
        while b"\n\n" in buf:
            event, buf = buf.split(b"\n\n", 1)
            for line in event.split(b"\n"):
                if line.startswith(b"data:"):
                    payload_str = line[5:].strip().decode("utf-8", errors="replace")
                    events.append(payload_str)

# The last data event holds the final result.
final = None
for ev in reversed(events):
    try:
        d = json.loads(ev)
        if isinstance(d, dict) and d.get("images"):
            final = d
            break
    except json.JSONDecodeError:
        continue

if not final:
    print("No image found in stream. Last events:", file=sys.stderr)
    for ev in events[-3:]:
        print("  -", ev[:200], file=sys.stderr)
    sys.exit(1)

img = final["images"][0]
img_url = img.get("url", "")

if img_url.startswith("data:"):
    # data:image/png;base64,XXXX
    header, _, b64 = img_url.partition(",")
    raw = base64.b64decode(b64)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(raw)
    print(json.dumps({
        "saved": output_path,
        "bytes": len(raw),
        "width": img.get("width"),
        "height": img.get("height"),
        "content_type": img.get("content_type"),
    }, indent=2))
else:
    # Fallback: download from URL
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(img_url, output_path)
    print(json.dumps({
        "saved": output_path,
        "url": img_url,
        "width": img.get("width"),
        "height": img.get("height"),
    }, indent=2))
