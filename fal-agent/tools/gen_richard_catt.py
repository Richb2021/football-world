#!/usr/bin/env python3
"""
Generate Richard Catt guru-morph avatar candidates using gpt-image-2 via fal.ai.
Python 3.9-compatible (no X | Y union syntax).

Mode: image-edit via openai/gpt-image-2/edit endpoint.
Fallback: text-to-image via openai/gpt-image-2 if upload fails.
"""

import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------

def load_dotenv():
    """Load FAL_KEY from fal-agent/.env"""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.is_file():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                    value = value[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = value
    return os.environ.get("FAL_KEY", "")


# ---------------------------------------------------------------------------
# Minimal fal.ai HTTP client (stdlib only)
# ---------------------------------------------------------------------------

class FalClient:
    QUEUE_BASE = "https://queue.fal.run"
    RUN_BASE   = "https://fal.run"

    def __init__(self, api_key):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Key {api_key}",
            "Content-Type": "application/json",
        }

    def _request(self, url, data=None, method="GET", extra_headers=None):
        body = json.dumps(data).encode() if data else None
        headers = dict(self.headers)
        if body is None:
            headers.pop("Content-Type", None)
        if extra_headers:
            headers.update(extra_headers)
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ""
            try:
                detail = json.loads(error_body).get("detail", error_body)
            except Exception:
                detail = error_body
            raise RuntimeError(f"HTTP {e.code}: {detail}") from e

    def subscribe(self, endpoint, payload, timeout=600.0, on_update=None):
        """Submit to queue and poll until complete."""
        url = f"{self.QUEUE_BASE}/{endpoint}"
        submission = self._request(url, data=payload, method="POST")
        request_id = submission["request_id"]
        status_url  = submission["status_url"]
        response_url = submission["response_url"]

        if on_update:
            on_update({"status": "SUBMITTED", "request_id": request_id})

        start = time.time()
        while True:
            if time.time() - start > timeout:
                raise TimeoutError(f"Timed out after {timeout}s")
            status = self._request(status_url)
            s = status.get("status", "UNKNOWN")
            if on_update:
                on_update(status)
            if s == "COMPLETED":
                return self._request(response_url)
            if s in ("FAILED", "CANCELLED"):
                raise RuntimeError(f"Generation failed: {status.get('error', 'unknown')}")
            elapsed = time.time() - start
            poll = 3 if elapsed < 15 else (5 if elapsed < 60 else 10)
            time.sleep(poll)


# ---------------------------------------------------------------------------
# Upload image using fal_client library
# ---------------------------------------------------------------------------

def upload_image_to_fal(api_key, image_path):
    """Upload a local image file using the fal_client library."""
    os.environ["FAL_KEY"] = api_key
    import fal_client
    url = fal_client.upload_file(image_path)
    return url


# ---------------------------------------------------------------------------
# SSE streaming call for text-to-image (faster for gpt-image-2)
# ---------------------------------------------------------------------------

def generate_via_stream(api_key, endpoint, payload):
    """
    Call gpt-image-2 via the streaming endpoint and extract the final image.
    Returns the image URL or data URI from the last SSE event.
    """
    import re
    url = f"https://fal.run/{endpoint}/stream"
    body = json.dumps(payload).encode()
    headers = {
        "Authorization": f"Key {api_key}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    chunks = []
    with urllib.request.urlopen(req, timeout=600) as resp:
        while True:
            line = resp.readline()
            if not line:
                break
            chunks.append(line.decode("utf-8", errors="replace"))

    raw = "".join(chunks)
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
        raise RuntimeError(f"No images event in stream response. Got {len(events)} events.")

    return final["images"][0]["url"]


# ---------------------------------------------------------------------------
# Download a file from URL
# ---------------------------------------------------------------------------

def download_file(url, dest_path):
    urllib.request.urlretrieve(url, dest_path)
    print(f"  Saved: {dest_path}", flush=True)


def save_from_url_or_b64(img_url, dest_path):
    """Save image — handles CDN URL or data URI."""
    if img_url.startswith("data:"):
        _, b64data = img_url.split(",", 1)
        with open(dest_path, "wb") as f:
            f.write(base64.b64decode(b64data))
        print(f"  Saved (base64): {dest_path}", flush=True)
    else:
        download_file(img_url, dest_path)


# ---------------------------------------------------------------------------
# Progress callback
# ---------------------------------------------------------------------------

def on_update(status):
    s = status.get("status", "?")
    if s == "SUBMITTED":
        print(f"  [queue] Submitted — request_id: {status.get('request_id', '?')}", flush=True)
    elif s == "IN_QUEUE":
        print(f"  [queue] Position {status.get('queue_position', '?')}", flush=True)
    elif s == "IN_PROGRESS":
        logs = status.get("logs") or []
        msg = logs[-1]["message"] if logs else "processing..."
        print(f"  [run]   {msg}", flush=True)
    elif s == "COMPLETED":
        t = (status.get("metrics") or {}).get("inference_time", "?")
        print(f"  [done]  Inference time: {t}s", flush=True)


# ---------------------------------------------------------------------------
# Extract image URL from gpt-image-2 result dict
# ---------------------------------------------------------------------------

def extract_image_url(result):
    """Try various result shapes returned by gpt-image-2."""
    if "images" in result and result["images"]:
        item = result["images"][0]
        return item.get("url") or item.get("b64_json")
    if "image" in result:
        img = result["image"]
        if isinstance(img, dict):
            return img.get("url") or img.get("b64_json")
        return img
    if "data" in result and result["data"]:
        item = result["data"][0]
        return item.get("url") or item.get("b64_json")
    if "url" in result:
        return result["url"]
    return None


# ---------------------------------------------------------------------------
# Creative brief
# ---------------------------------------------------------------------------

BASE_PROMPT = (
    "Glossy, hyper-saturated crypto/AI-millionaire 'guru' influencer portrait of this specific man. "
    "Same face, identity, and likeness preserved. "
    "Garish shiny open-collar suit (no tie), oversized gold watch and gold chain, "
    "smug overconfident smirk, arms crossed. "
    "Influencer-thumbnail energy, over-retouched skin, dramatic golden-hour lighting, faintly absurd."
)

LIKENESS_DESC = (
    "The subject is a late-20s/early-30s white British man, "
    "dark brown hair (short, side-swept), full round face, clean-shaven, "
    "wearing a light grey checked blazer in the original photo. "
)

CANDIDATES = [
    {
        "name": "cand-1",
        "scene": (
            "Background: a matte-black supercar (Lamborghini or similar) parked "
            "on a private driveway, slightly out of focus behind him. "
            "Dramatic sunlight glinting on chrome and bodywork."
        ),
        "size": "1024x1024",
    },
    {
        "name": "cand-2",
        "scene": (
            "Background: the airstairs of a sleek white private jet on a sunny tarmac. "
            "Jet fuselage and open door visible behind him. "
            "Luggage handlers blurred in background."
        ),
        "size": "1024x1024",
    },
    {
        "name": "cand-3",
        "scene": (
            "Background: an infinity pool at a luxury hillside mansion at golden sunset. "
            "City skyline or ocean glowing in the distance below. "
            "Warm amber and orange tones."
        ),
        "size": "1024x1024",
    },
    {
        "name": "og-wide",
        "scene": (
            "Background: infinity pool at a luxury hillside mansion at golden sunset, "
            "city skyline glowing in the distance. "
            "Subject positioned off-centre to the LEFT of frame, "
            "large open space on the RIGHT side for text overlay. "
            "Wide landscape panoramic composition for a social media share card."
        ),
        "size": "1536x1024",
    },
]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    api_key = load_dotenv()
    if not api_key:
        print("ERROR: FAL_KEY not found in .env", file=sys.stderr)
        sys.exit(1)

    print(f"FAL key loaded: {api_key[:8]}...", flush=True)

    client = FalClient(api_key)

    # 1. Try to upload source image for image-edit mode
    source_path = "/Users/richardbatt/Projects/newrichbsite/wire-method-brand/site/assets/richard.png"
    print(f"\nUploading source image: {source_path}", flush=True)

    image_url = None
    using_edit_mode = False
    try:
        image_url = upload_image_to_fal(api_key, source_path)
        print(f"  Uploaded to fal CDN: {image_url}", flush=True)
        using_edit_mode = True
    except Exception as e:
        print(f"  Upload failed ({e}). Will use text-to-image with detailed likeness description.", flush=True)

    output_dir = Path("/Users/richardbatt/Projects/newrichbsite/fal-agent/outputs/richard-catt")
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    failures = []

    for cand in CANDIDATES:
        name = cand["name"]
        scene = cand["scene"]
        size = cand.get("size", "1024x1024")

        print(f"\n{'='*60}", flush=True)
        print(f"Generating {name} ({size})...", flush=True)

        dest_path = str(output_dir / f"{name}.png")

        if using_edit_mode and image_url:
            # Image-edit mode: pass source image as image_url
            endpoint = "openai/gpt-image-2/edit"
            full_prompt = f"{BASE_PROMPT} {scene}"
            payload = {
                "prompt": full_prompt,
                "image_urls": [image_url],
                "size": size,
                "n": 1,
            }
            print(f"  Mode: image-edit", flush=True)
        else:
            # Text-to-image fallback with detailed likeness
            endpoint = "openai/gpt-image-2"
            full_prompt = f"{LIKENESS_DESC}{BASE_PROMPT} {scene}"
            payload = {
                "prompt": full_prompt,
                "size": size,
                "n": 1,
                "quality": "high",
            }
            print(f"  Mode: text-to-image (fallback)", flush=True)

        print(f"  Endpoint: {endpoint}", flush=True)
        print(f"  Prompt: {full_prompt[:140]}...", flush=True)

        # Try queue method first, fall back to streaming
        img_url = None
        method_used = None

        # Attempt 1: queue/subscribe
        try:
            print(f"  Attempt 1: queue method...", flush=True)
            result = client.subscribe(endpoint, payload, timeout=300, on_update=on_update)
            print(f"  Result keys: {list(result.keys())}", flush=True)
            img_url = extract_image_url(result)
            if img_url:
                method_used = "queue"
            else:
                print(f"  No image in queue result, trying stream...", flush=True)
        except Exception as e:
            print(f"  Queue attempt failed: {e}", flush=True)

        # Attempt 2: streaming endpoint
        if not img_url:
            try:
                print(f"  Attempt 2: streaming method...", flush=True)
                img_url = generate_via_stream(api_key, endpoint, payload)
                method_used = "stream"
            except Exception as e:
                print(f"  Stream attempt failed: {e}", flush=True)

        if not img_url:
            failures.append({
                "candidate": name,
                "error": "Both queue and stream methods failed",
            })
            continue

        try:
            save_from_url_or_b64(img_url, dest_path)
            results.append({
                "candidate": name,
                "path": dest_path,
                "mode": "image-edit" if using_edit_mode else "text-to-image",
                "method": method_used,
            })
        except Exception as e:
            failures.append({"candidate": name, "error": f"Download failed: {e}"})

    # Summary
    print(f"\n{'='*60}", flush=True)
    print("GENERATION COMPLETE", flush=True)
    print(f"  Mode: {'image-edit' if using_edit_mode else 'text-to-image'}", flush=True)
    print(f"  Successes: {len(results)}", flush=True)
    print(f"  Failures:  {len(failures)}", flush=True)
    for r in results:
        print(f"  OK  {r['candidate']}: {r['path']}", flush=True)
    for f in failures:
        print(f"  ERR {f['candidate']}: {f['error']}", flush=True)

    manifest = {
        "mode": "image-edit" if using_edit_mode else "text-to-image",
        "source_image": source_path,
        "fal_image_url": image_url,
        "results": results,
        "failures": failures,
    }
    manifest_path = output_dir / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nManifest: {manifest_path}", flush=True)

    if not results:
        sys.exit(1)


if __name__ == "__main__":
    main()
