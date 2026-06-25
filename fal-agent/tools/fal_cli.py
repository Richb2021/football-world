#!/usr/bin/env python3
"""
fal.ai Media Generation CLI

A unified CLI for generating images, videos, audio, music, and speech
using fal.ai's API. Supports 1000+ models through a single interface.

Environment:
    FAL_KEY: Your fal.ai API key (required)

Usage:
    python fal_generate.py generate-image --prompt "a cat in space"
    python fal_generate.py generate-video --prompt "ocean waves" --model kling
    python fal_generate.py generate-audio --text "Hello world" --model elevenlabs-v3
    python fal_generate.py generate-music --prompt "upbeat jazz"
    python fal_generate.py transcribe --audio-url "https://..."
    python fal_generate.py list-models --category image
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from datetime import datetime


# ---------------------------------------------------------------------------
# .env file loader (zero dependencies)
# ---------------------------------------------------------------------------

def load_dotenv(env_path: str | None = None):
    """Load variables from a .env file into os.environ.

    Search order:
      1. Explicit path if provided
      2. .env in the agent root (one level up from tools/)
      3. .env in the current working directory

    Existing environment variables are NOT overwritten.
    """
    candidates = []
    if env_path:
        candidates.append(Path(env_path))

    # Agent root = parent of the tools/ directory this script lives in
    agent_root = Path(__file__).resolve().parent.parent
    candidates.append(agent_root / ".env")
    candidates.append(Path.cwd() / ".env")

    for candidate in candidates:
        if candidate.is_file():
            with open(candidate) as f:
                for line in f:
                    line = line.strip()
                    # Skip comments and blank lines
                    if not line or line.startswith("#"):
                        continue
                    if "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip()
                    # Remove surrounding quotes if present
                    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                        value = value[1:-1]
                    # Don't overwrite existing env vars
                    if key and key not in os.environ:
                        os.environ[key] = value
            return  # Stop after first .env file found


# Auto-load .env on import
load_dotenv()

# ---------------------------------------------------------------------------
# Model Registry
# ---------------------------------------------------------------------------

MODEL_REGISTRY = {
    # --- Image Generation ---
    "flux-schnell": {
        "endpoint": "fal-ai/flux/schnell",
        "category": "image",
        "description": "Ultra-fast image generation (1-4 steps)",
        "default_params": {"image_size": "landscape_16_9", "num_images": 1},
    },
    "flux-dev": {
        "endpoint": "fal-ai/flux/dev",
        "category": "image",
        "description": "High-quality image generation (development model)",
        "default_params": {"image_size": "landscape_16_9", "num_images": 1},
    },
    "flux-pro": {
        "endpoint": "fal-ai/flux-pro/v1.1-ultra",
        "category": "image",
        "description": "Professional-grade images up to 2K resolution",
        "default_params": {"image_size": "landscape_16_9", "num_images": 1},
    },
    "flux-lora": {
        "endpoint": "fal-ai/flux-lora",
        "category": "image",
        "description": "FLUX with LoRA fine-tuning support",
        "default_params": {"image_size": "landscape_16_9", "num_images": 1},
    },
    "recraft-v3": {
        "endpoint": "fal-ai/recraft/v3",
        "category": "image",
        "description": "SOTA with vector art and typography support",
        "default_params": {"image_size": {"width": 1024, "height": 1024}},
    },
    "ideogram-v3": {
        "endpoint": "fal-ai/ideogram/v3",
        "category": "image",
        "description": "Exceptional text rendering and typography",
        "default_params": {},
    },
    "imagen4": {
        "endpoint": "fal-ai/imagen4/preview",
        "category": "image",
        "description": "Google's highest quality image model",
        "default_params": {},
    },
    "gpt-image-2.0": {
        "endpoint": "openai/gpt-image-2",
        "category": "image",
        "description": "OpenAI GPT Image 2 — detailed images with strong prompt adherence and fine typography",
        "default_params": {},
    },

    # --- Video Generation ---
    "kling": {
        "endpoint": "fal-ai/kling/v2.1/pro/text-to-video",
        "category": "video",
        "description": "Kling 2.1 Pro — cinematic video with camera controls",
        "default_params": {"duration": "5s", "aspect_ratio": "16:9"},
    },
    "kling-img2vid": {
        "endpoint": "fal-ai/kling/v2.1/pro/image-to-video",
        "category": "video",
        "description": "Kling 2.1 Pro — image to video generation",
        "default_params": {"duration": "5s"},
    },
    "veo3": {
        "endpoint": "fal-ai/veo3",
        "category": "video",
        "description": "Google Veo 3 — highest quality video with audio",
        "default_params": {"aspect_ratio": "16:9"},
    },
    "veo3-fast": {
        "endpoint": "fal-ai/veo3/fast",
        "category": "video",
        "description": "Veo 3 Fast — speed-optimized variant",
        "default_params": {"aspect_ratio": "16:9"},
    },
    "minimax-video": {
        "endpoint": "minimax/video-01-live/text-to-video",
        "category": "video",
        "description": "MiniMax Video — text to video generation",
        "default_params": {},
    },
    "minimax-img2vid": {
        "endpoint": "minimax/hailuo-02/standard/image-to-video",
        "category": "video",
        "description": "MiniMax Hailuo — image to video at 768p",
        "default_params": {},
    },
    "wan": {
        "endpoint": "fal-ai/wan/v2.7/text-to-video",
        "category": "video",
        "description": "Wan 2.7 — latest gen, smooth motion and high fidelity",
        "default_params": {},
    },
    "wan-img2vid": {
        "endpoint": "fal-ai/wan/v2.2-a14b/image-to-video",
        "category": "video",
        "description": "Wan 2.2 A14B — image to video generation",
        "default_params": {},
    },
    "ltx-video": {
        "endpoint": "fal-ai/ltx-video",
        "category": "video",
        "description": "LTX Video — fast, open video generation",
        "default_params": {},
    },
    "happy-horse": {
        "endpoint": "alibaba/happy-horse/text-to-video",
        "category": "video",
        "description": "Alibaba Happy Horse 1.0 — #1-ranked text-to-video, 1080p, native audio",
        "default_params": {"duration": "5", "aspect_ratio": "16:9", "resolution": "1080p"},
    },
    "happy-horse-img2vid": {
        "endpoint": "alibaba/happy-horse/image-to-video",
        "category": "video",
        "description": "Alibaba Happy Horse 1.0 — image-to-video",
        "default_params": {"duration": "5", "resolution": "1080p"},
    },
    "seedance-2": {
        "endpoint": "bytedance/seedance-2.0/text-to-video",
        "category": "video",
        "description": "ByteDance Seedance 2.0 — cinematic text-to-video with native audio",
        "default_params": {},
    },
    "seedance-2-img2vid": {
        "endpoint": "bytedance/seedance-2.0/image-to-video",
        "category": "video",
        "description": "ByteDance Seedance 2.0 — image-to-video",
        "default_params": {},
    },

    # --- Audio / Speech ---
    "elevenlabs-v3": {
        "endpoint": "fal-ai/elevenlabs/tts/eleven-v3",
        "category": "audio",
        "description": "ElevenLabs Eleven v3 — most expressive TTS",
        "default_params": {"model_id": "eleven_v3"},
    },
    "elevenlabs-turbo": {
        "endpoint": "fal-ai/elevenlabs/tts/turbo-v2.5",
        "category": "audio",
        "description": "ElevenLabs Turbo v2.5 — low latency TTS",
        "default_params": {},
    },
    "elevenlabs-multilingual": {
        "endpoint": "fal-ai/elevenlabs/tts/multilingual-v2",
        "category": "audio",
        "description": "ElevenLabs Multilingual v2 — 29 languages",
        "default_params": {},
    },

    # --- Music ---
    "minimax-music": {
        "endpoint": "fal-ai/minimax-music/v2",
        "category": "music",
        "description": "MiniMax Music 2.0 — text to music generation",
        "default_params": {},
    },

    # --- Transcription ---
    "whisper": {
        "endpoint": "fal-ai/whisper",
        "category": "transcription",
        "description": "OpenAI Whisper — speech to text",
        "default_params": {},
    },
}


# ---------------------------------------------------------------------------
# API Client (pure stdlib — no external dependencies required)
# ---------------------------------------------------------------------------

class FalClient:
    """Minimal fal.ai API client using only Python stdlib."""

    QUEUE_BASE = "https://queue.fal.run"
    RUN_BASE = "https://fal.run"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Key {api_key}",
            "Content-Type": "application/json",
        }

    def _request(self, url: str, data: dict | None = None, method: str = "GET") -> dict:
        """Make an HTTP request and return parsed JSON."""
        body = json.dumps(data).encode() if data else None
        # Only send Content-Type on requests with a body; some servers
        # reject GET requests that carry Content-Type: application/json.
        headers = dict(self.headers)
        if body is None:
            headers.pop("Content-Type", None)
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ""
            try:
                error_json = json.loads(error_body)
                detail = error_json.get("detail", error_body)
            except json.JSONDecodeError:
                detail = error_body
            raise RuntimeError(f"HTTP {e.code}: {detail}") from e

    def run_sync(self, endpoint: str, payload: dict) -> dict:
        """Synchronous call — blocks until result. Best for fast models."""
        url = f"{self.RUN_BASE}/{endpoint}"
        return self._request(url, data=payload, method="POST")

    def submit(self, endpoint: str, payload: dict) -> dict:
        """Submit to queue — returns request_id immediately."""
        url = f"{self.QUEUE_BASE}/{endpoint}"
        return self._request(url, data=payload, method="POST")

    def get_status(self, status_url: str) -> dict:
        """Check queue status using the URL returned by submit."""
        return self._request(status_url)

    def get_result(self, response_url: str) -> dict:
        """Retrieve completed result using the URL returned by submit."""
        return self._request(response_url)

    def subscribe(self, endpoint: str, payload: dict, poll_interval: float = 2.0,
                  timeout: float = 600.0, on_update=None) -> dict:
        """Submit and poll until complete. This is the recommended pattern.

        Uses the status_url and response_url returned by the submit response
        rather than constructing URLs from the endpoint ID, because fal may
        return canonical URLs that differ from the submission endpoint path.
        """
        submission = self.submit(endpoint, payload)
        request_id = submission["request_id"]
        status_url = submission["status_url"]
        response_url = submission["response_url"]

        if on_update:
            on_update({"status": "SUBMITTED", "request_id": request_id})

        start = time.time()
        while True:
            if time.time() - start > timeout:
                raise TimeoutError(f"Generation timed out after {timeout}s")

            status = self.get_status(status_url)
            current_status = status.get("status", "UNKNOWN")

            if on_update:
                on_update(status)

            if current_status == "COMPLETED":
                return self.get_result(response_url)

            if current_status in ("FAILED", "CANCELLED"):
                error = status.get("error", "Unknown error")
                raise RuntimeError(f"Generation failed: {error}")

            # Adaptive polling: faster for short tasks, slower for long ones
            elapsed = time.time() - start
            if elapsed < 10:
                time.sleep(poll_interval)
            elif elapsed < 60:
                time.sleep(min(poll_interval * 2, 5))
            else:
                time.sleep(min(poll_interval * 3, 10))


# ---------------------------------------------------------------------------
# File Download
# ---------------------------------------------------------------------------

def download_file(url: str, output_dir: str, filename: str | None = None) -> str:
    """Download a file from URL to output_dir. Returns local path."""
    os.makedirs(output_dir, exist_ok=True)

    if not filename:
        # Extract filename from URL path
        parsed = urllib.parse.urlparse(url)
        url_filename = os.path.basename(parsed.path)
        if url_filename and "." in url_filename:
            filename = url_filename
        else:
            # Guess extension from content type
            req = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(req, timeout=30) as resp:
                ct = resp.headers.get("Content-Type", "")
                ext_map = {
                    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
                    "video/mp4": ".mp4", "audio/mpeg": ".mp3", "audio/wav": ".wav",
                    "audio/ogg": ".ogg",
                }
                ext = ext_map.get(ct.split(";")[0].strip(), ".bin")
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"fal_output_{timestamp}{ext}"

    filepath = os.path.join(output_dir, filename)
    urllib.request.urlretrieve(url, filepath)
    return filepath


# ---------------------------------------------------------------------------
# Progress Display
# ---------------------------------------------------------------------------

def progress_callback(status: dict):
    """Print queue status updates to stderr."""
    s = status.get("status", "UNKNOWN")
    if s == "SUBMITTED":
        print(f"  [queue] Submitted (request_id: {status.get('request_id', '?')})", file=sys.stderr)
    elif s == "IN_QUEUE":
        pos = status.get("queue_position", "?")
        print(f"  [queue] Waiting in queue (position: {pos})", file=sys.stderr)
    elif s == "IN_PROGRESS":
        logs = status.get("logs", [])
        if logs:
            latest = logs[-1].get("message", "")
            print(f"  [running] {latest}", file=sys.stderr)
        else:
            print("  [running] Processing...", file=sys.stderr)
    elif s == "COMPLETED":
        metrics = status.get("metrics", {})
        inf_time = metrics.get("inference_time", "?")
        print(f"  [done] Completed (inference: {inf_time}s)", file=sys.stderr)


# ---------------------------------------------------------------------------
# Command Handlers
# ---------------------------------------------------------------------------

def cmd_generate_image(client: FalClient, args) -> dict:
    """Generate an image from a text prompt."""
    model_key = args.model or "flux-schnell"
    model = MODEL_REGISTRY.get(model_key)
    if not model or model["category"] != "image":
        return {"error": f"Unknown image model: {model_key}. Use 'list-models --category image' to see options."}

    payload = {**model["default_params"], "prompt": args.prompt}

    if args.width and args.height:
        payload["image_size"] = {"width": args.width, "height": args.height}
    elif args.size:
        payload["image_size"] = args.size

    if args.num_images:
        payload["num_images"] = args.num_images

    if args.negative_prompt:
        payload["negative_prompt"] = args.negative_prompt

    # Allow arbitrary extra params via --param key=value
    for p in (args.param or []):
        k, v = p.split("=", 1)
        # Try to parse as JSON for complex values
        try:
            payload[k] = json.loads(v)
        except json.JSONDecodeError:
            payload[k] = v

    print(f"Generating image with {model_key} ({model['endpoint']})...", file=sys.stderr)
    result = client.subscribe(model["endpoint"], payload, on_update=progress_callback)

    # Extract image URLs
    images = result.get("images", [])
    if not images:
        # Some models return differently
        image_url = result.get("image", {}).get("url") or result.get("url")
        if image_url:
            images = [{"url": image_url}]

    output = {
        "model": model_key,
        "endpoint": model["endpoint"],
        "images": [],
    }

    for i, img in enumerate(images):
        url = img.get("url", "")
        entry = {"url": url, "index": i}

        if args.download and url:
            ext = ".png"
            if ".jpg" in url or ".jpeg" in url:
                ext = ".jpg"
            elif ".webp" in url:
                ext = ".webp"
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            fname = f"image_{model_key}_{timestamp}_{i}{ext}"
            local_path = download_file(url, args.output_dir, fname)
            entry["local_path"] = local_path

        output["images"].append(entry)

    return output


def cmd_generate_video(client: FalClient, args) -> dict:
    """Generate a video from text or image."""
    model_key = args.model or "kling"

    # Auto-select image-to-video variant if image_url provided
    if args.image_url:
        img2vid_key = model_key + "-img2vid"
        if img2vid_key in MODEL_REGISTRY:
            model_key = img2vid_key
        elif model_key not in MODEL_REGISTRY:
            return {"error": f"Unknown video model: {model_key}"}

    model = MODEL_REGISTRY.get(model_key)
    if not model or model["category"] != "video":
        return {"error": f"Unknown video model: {model_key}. Use 'list-models --category video' to see options."}

    payload = {**model["default_params"]}

    if args.prompt:
        payload["prompt"] = args.prompt
    if args.image_url:
        payload["image_url"] = args.image_url
    if args.duration:
        payload["duration"] = args.duration
    if args.aspect_ratio:
        payload["aspect_ratio"] = args.aspect_ratio

    for p in (args.param or []):
        k, v = p.split("=", 1)
        try:
            payload[k] = json.loads(v)
        except json.JSONDecodeError:
            payload[k] = v

    print(f"Generating video with {model_key} ({model['endpoint']})...", file=sys.stderr)
    print("  Note: Video generation can take 1-5 minutes.", file=sys.stderr)
    result = client.subscribe(model["endpoint"], payload, timeout=600, on_update=progress_callback)

    # Extract video URL (varies by model)
    video_url = (
        result.get("video", {}).get("url")
        or result.get("video_url")
        or result.get("url")
    )

    # Some models return a list
    if not video_url:
        videos = result.get("videos", [])
        if videos:
            video_url = videos[0].get("url", "")

    output = {
        "model": model_key,
        "endpoint": model["endpoint"],
        "video_url": video_url,
    }

    if args.download and video_url:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        fname = f"video_{model_key}_{timestamp}.mp4"
        local_path = download_file(video_url, args.output_dir, fname)
        output["local_path"] = local_path

    return output


def cmd_generate_audio(client: FalClient, args) -> dict:
    """Generate speech audio from text (TTS)."""
    model_key = args.model or "elevenlabs-v3"
    model = MODEL_REGISTRY.get(model_key)
    if not model or model["category"] != "audio":
        return {"error": f"Unknown audio model: {model_key}. Use 'list-models --category audio' to see options."}

    payload = {**model["default_params"], "text": args.text}

    if args.voice_id:
        payload["voice_id"] = args.voice_id
    if args.language:
        payload["language_code"] = args.language

    for p in (args.param or []):
        k, v = p.split("=", 1)
        try:
            payload[k] = json.loads(v)
        except json.JSONDecodeError:
            payload[k] = v

    print(f"Generating audio with {model_key} ({model['endpoint']})...", file=sys.stderr)
    result = client.subscribe(model["endpoint"], payload, on_update=progress_callback)

    audio_url = (
        result.get("audio", {}).get("url")
        or result.get("audio_url")
        or result.get("url")
    )

    output = {
        "model": model_key,
        "endpoint": model["endpoint"],
        "audio_url": audio_url,
    }

    if args.download and audio_url:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        fname = f"audio_{model_key}_{timestamp}.mp3"
        local_path = download_file(audio_url, args.output_dir, fname)
        output["local_path"] = local_path

    return output


def cmd_generate_music(client: FalClient, args) -> dict:
    """Generate music from a text description."""
    model_key = args.model or "minimax-music"
    model = MODEL_REGISTRY.get(model_key)
    if not model or model["category"] != "music":
        return {"error": f"Unknown music model: {model_key}. Use 'list-models --category music' to see options."}

    payload = {**model["default_params"], "prompt": args.prompt}

    if args.duration:
        payload["duration"] = args.duration

    # Allow lyrics for music models
    if args.lyrics:
        payload["lyrics"] = args.lyrics

    for p in (args.param or []):
        k, v = p.split("=", 1)
        try:
            payload[k] = json.loads(v)
        except json.JSONDecodeError:
            payload[k] = v

    print(f"Generating music with {model_key} ({model['endpoint']})...", file=sys.stderr)
    result = client.subscribe(model["endpoint"], payload, timeout=300, on_update=progress_callback)

    audio_url = (
        result.get("audio", {}).get("url")
        or result.get("audio_url")
        or result.get("url")
    )

    # Some music models return a list of audio files
    if not audio_url:
        audios = result.get("audios", result.get("audio_files", []))
        if audios:
            audio_url = audios[0].get("url", "")

    output = {
        "model": model_key,
        "endpoint": model["endpoint"],
        "audio_url": audio_url,
    }

    if args.download and audio_url:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        fname = f"music_{model_key}_{timestamp}.mp3"
        local_path = download_file(audio_url, args.output_dir, fname)
        output["local_path"] = local_path

    return output


def cmd_transcribe(client: FalClient, args) -> dict:
    """Transcribe audio to text."""
    model_key = args.model or "whisper"
    model = MODEL_REGISTRY.get(model_key)
    if not model or model["category"] != "transcription":
        return {"error": f"Unknown transcription model: {model_key}"}

    payload = {**model["default_params"], "audio_url": args.audio_url}

    if args.language:
        payload["language"] = args.language

    for p in (args.param or []):
        k, v = p.split("=", 1)
        try:
            payload[k] = json.loads(v)
        except json.JSONDecodeError:
            payload[k] = v

    print(f"Transcribing with {model_key} ({model['endpoint']})...", file=sys.stderr)
    result = client.subscribe(model["endpoint"], payload, on_update=progress_callback)

    text = result.get("text", "")
    chunks = result.get("chunks", [])

    output = {
        "model": model_key,
        "endpoint": model["endpoint"],
        "text": text,
        "chunks": chunks,
    }

    return output


def cmd_list_models(args) -> dict:
    """List available models, optionally filtered by category."""
    category = args.category
    models = {}
    for key, info in MODEL_REGISTRY.items():
        if category and info["category"] != category:
            continue
        models[key] = {
            "endpoint": info["endpoint"],
            "category": info["category"],
            "description": info["description"],
        }
    return {"models": models, "count": len(models)}


def cmd_search_models(client: FalClient, args) -> dict:
    """Search fal.ai's live model catalog via their API.

    This queries https://api.fal.ai/v1/models with optional filters
    for category, free-text query, and status.
    """
    FAL_MODELS_API = "https://api.fal.ai/v1/models"

    params = {}
    if args.query:
        params["q"] = args.query
    if args.category:
        params["category"] = args.category
    if args.status:
        params["status"] = args.status
    params["limit"] = str(args.limit)

    query_string = urllib.parse.urlencode(params)
    url = f"{FAL_MODELS_API}?{query_string}" if query_string else FAL_MODELS_API

    result = client._request(url)

    models_raw = result.get("models", [])
    models = []
    for m in models_raw:
        endpoint_id = m.get("endpoint_id", "")
        meta = m.get("metadata", {})
        entry = {
            "endpoint_id": endpoint_id,
            "name": meta.get("display_name", ""),
            "category": meta.get("category", ""),
            "description": meta.get("description", ""),
            "status": meta.get("status", ""),
        }
        # Only include non-empty fields
        models.append({k: v for k, v in entry.items() if v})

    output = {
        "models": models,
        "count": len(models),
        "has_more": result.get("has_more", False),
    }

    return output


def cmd_raw(client: FalClient, args) -> dict:
    """Call any fal endpoint directly by ID with a JSON payload."""
    endpoint = args.endpoint

    try:
        payload = json.loads(args.payload) if args.payload else {}
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON payload: {e}"}

    print(f"Calling endpoint: {endpoint}...", file=sys.stderr)

    if args.sync:
        result = client.run_sync(endpoint, payload)
    else:
        result = client.subscribe(endpoint, payload, on_update=progress_callback)

    return result


# ---------------------------------------------------------------------------
# CLI Setup
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fal_generate",
        description="fal.ai Media Generation CLI — generate images, videos, audio, music, and more",
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # --- generate-image ---
    img = subparsers.add_parser("generate-image", help="Generate image from text prompt")
    img.add_argument("--prompt", required=True, help="Text prompt for generation")
    img.add_argument("--model", default=None, help="Model alias (default: flux-schnell)")
    img.add_argument("--width", type=int, help="Image width in pixels")
    img.add_argument("--height", type=int, help="Image height in pixels")
    img.add_argument("--size", help="Image size preset (e.g., landscape_16_9, square)")
    img.add_argument("--num-images", type=int, default=1, help="Number of images to generate")
    img.add_argument("--negative-prompt", help="Negative prompt (things to avoid)")
    img.add_argument("--download", action="store_true", default=True, help="Download result (default: true)")
    img.add_argument("--no-download", dest="download", action="store_false", help="Don't download result")
    img.add_argument("--output-dir", default=".", help="Directory for downloads")
    img.add_argument("--param", action="append", help="Extra param as key=value (repeatable)")

    # --- generate-video ---
    vid = subparsers.add_parser("generate-video", help="Generate video from text or image")
    vid.add_argument("--prompt", help="Text prompt for generation")
    vid.add_argument("--image-url", help="Source image URL (for image-to-video)")
    vid.add_argument("--model", default=None, help="Model alias (default: kling)")
    vid.add_argument("--duration", help="Video duration (e.g., '5s', '10s')")
    vid.add_argument("--aspect-ratio", help="Aspect ratio (e.g., '16:9', '9:16')")
    vid.add_argument("--download", action="store_true", default=True, help="Download result")
    vid.add_argument("--no-download", dest="download", action="store_false")
    vid.add_argument("--output-dir", default=".", help="Directory for downloads")
    vid.add_argument("--param", action="append", help="Extra param as key=value")

    # --- generate-audio ---
    aud = subparsers.add_parser("generate-audio", help="Generate speech from text (TTS)")
    aud.add_argument("--text", required=True, help="Text to speak")
    aud.add_argument("--model", default=None, help="Model alias (default: elevenlabs-v3)")
    aud.add_argument("--voice-id", help="Voice ID for TTS")
    aud.add_argument("--language", help="Language code (e.g., 'en', 'es', 'fr')")
    aud.add_argument("--download", action="store_true", default=True)
    aud.add_argument("--no-download", dest="download", action="store_false")
    aud.add_argument("--output-dir", default=".", help="Directory for downloads")
    aud.add_argument("--param", action="append", help="Extra param as key=value")

    # --- generate-music ---
    mus = subparsers.add_parser("generate-music", help="Generate music from description")
    mus.add_argument("--prompt", required=True, help="Music description prompt")
    mus.add_argument("--model", default=None, help="Model alias (default: minimax-music)")
    mus.add_argument("--duration", help="Music duration")
    mus.add_argument("--lyrics", help="Optional lyrics for the music")
    mus.add_argument("--download", action="store_true", default=True)
    mus.add_argument("--no-download", dest="download", action="store_false")
    mus.add_argument("--output-dir", default=".", help="Directory for downloads")
    mus.add_argument("--param", action="append", help="Extra param as key=value")

    # --- transcribe ---
    trans = subparsers.add_parser("transcribe", help="Transcribe audio to text")
    trans.add_argument("--audio-url", required=True, help="URL of audio to transcribe")
    trans.add_argument("--model", default=None, help="Model alias (default: whisper)")
    trans.add_argument("--language", help="Language hint for transcription")
    trans.add_argument("--param", action="append", help="Extra param as key=value")

    # --- list-models ---
    ls = subparsers.add_parser("list-models", help="List built-in model aliases")
    ls.add_argument("--category", choices=["image", "video", "audio", "music", "transcription"],
                    help="Filter by category")

    # --- search-models ---
    sm = subparsers.add_parser("search-models", help="Search fal.ai's LIVE model catalog (1000+ models)")
    sm.add_argument("--query", "-q", help="Free-text search (e.g., 'flux', 'video generation', 'music')")
    sm.add_argument("--category", help="Filter by category (e.g., 'text-to-image', 'text-to-video', 'image-to-video', 'text-to-audio', 'text-to-music')")
    sm.add_argument("--status", choices=["active", "deprecated"], default="active", help="Model status (default: active)")
    sm.add_argument("--limit", type=int, default=20, help="Max results to return (default: 20)")

    # --- raw ---
    raw = subparsers.add_parser("raw", help="Call any fal endpoint directly")
    raw.add_argument("--endpoint", required=True, help="fal endpoint ID (e.g., fal-ai/flux/schnell)")
    raw.add_argument("--payload", help="JSON payload string")
    raw.add_argument("--sync", action="store_true", help="Use synchronous call (no queue)")

    return parser


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # list-models doesn't need auth
    if args.command == "list-models":
        result = cmd_list_models(args)
        print(json.dumps(result, indent=2))
        return

    # All other commands need FAL_KEY
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        env_path = Path(__file__).resolve().parent.parent / ".env"
        print(json.dumps({
            "error": "FAL_KEY is not set.",
            "help": (
                f"Add your API key to the .env file at: {env_path}\n"
                "  → Open the file and paste your key after FAL_KEY=\n"
                "  → Get a key at https://fal.ai/dashboard/keys\n"
                "Or export it directly: export FAL_KEY=your_key_here"
            )
        }, indent=2))
        sys.exit(3)

    client = FalClient(api_key)

    try:
        if args.command == "generate-image":
            result = cmd_generate_image(client, args)
        elif args.command == "generate-video":
            result = cmd_generate_video(client, args)
        elif args.command == "generate-audio":
            result = cmd_generate_audio(client, args)
        elif args.command == "generate-music":
            result = cmd_generate_music(client, args)
        elif args.command == "transcribe":
            result = cmd_transcribe(client, args)
        elif args.command == "search-models":
            result = cmd_search_models(client, args)
        elif args.command == "raw":
            result = cmd_raw(client, args)
        else:
            parser.print_help()
            sys.exit(1)

        print(json.dumps(result, indent=2))
        if isinstance(result, dict) and "error" in result:
            err_msg = str(result.get("error", ""))
            if "FAL_KEY" in err_msg or "401" in err_msg:
                sys.exit(3)
            sys.exit(2)

    except TimeoutError as e:
        print(json.dumps({"error": str(e), "hint": "Try a faster model variant or shorter content"}, indent=2))
        sys.exit(2)
    except RuntimeError as e:
        error_msg = str(e)
        print(json.dumps({"error": error_msg}, indent=2))
        if "FAL_KEY" in error_msg or "401" in error_msg:
            sys.exit(3)
        sys.exit(2)
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
