#!/usr/bin/env python3
"""Generate a single blog cover image via openai/gpt-image-2 on fal.ai.

Usage:
    python3 gen_blog_image.py <output_png_path> <prompt>

Reads FAL_KEY from /Users/richardbatt/Projects/newrichbsite/fal-agent/.env or env.
"""
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path


def load_env():
    env_path = Path("/Users/richardbatt/Projects/newrichbsite/fal-agent/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)


def main():
    if len(sys.argv) < 3:
        print("usage: gen_blog_image.py <output_path> <prompt>", file=sys.stderr)
        sys.exit(2)

    output_path = sys.argv[1]
    prompt = sys.argv[2]

    load_env()
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        print("FAL_KEY not set", file=sys.stderr)
        sys.exit(3)

    payload = {
        "prompt": prompt,
        "quality": "high",
        "image_size": "landscape_16_9",
        "sync_mode": True,
    }

    url = "https://fal.run/openai/gpt-image-2/stream"
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": "Key " + api_key,
            "Content-Type": "application/json",
        },
    )

    events = []
    with urllib.request.urlopen(req, timeout=600) as resp:
        buf = b""
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            buf += chunk
            while b"\n\n" in buf:
                event, buf = buf.split(b"\n\n", 1)
                for line in event.split(b"\n"):
                    if line.startswith(b"data:"):
                        events.append(line[5:].strip().decode("utf-8", errors="replace"))

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
        last = events[-3:] if events else []
        print(json.dumps({"error": "no images event", "last_events": last}))
        sys.exit(1)

    img = final["images"][0]
    img_url = img.get("url", "")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    if img_url.startswith("data:"):
        b64 = img_url.split(",", 1)[1]
        raw = base64.b64decode(b64)
        with open(output_path, "wb") as f:
            f.write(raw)
        print(json.dumps({"saved": output_path, "bytes": len(raw)}))
    else:
        urllib.request.urlretrieve(img_url, output_path)
        print(json.dumps({"saved": output_path, "url": img_url}))


if __name__ == "__main__":
    main()
