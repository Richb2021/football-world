#!/usr/bin/env python3
import io
import json
import struct
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "public/assets/models/player_rigged.glb"
OUT_DIR = ROOT / "public/assets/generated/templates"
BASE_OUT = OUT_DIR / "player_kit_uv_base.png"
MASK_OUT = OUT_DIR / "player_kit_uv_mask.png"
GUIDE_OUT = OUT_DIR / "player_kit_uv_guide.png"
TARGET_SIZE = 1024


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    base = extract_first_embedded_image(MODEL).convert("RGB")
    base = base.resize((TARGET_SIZE, TARGET_SIZE), Image.Resampling.LANCZOS)
    mask, guide = build_mask_and_guide(base)
    base.save(BASE_OUT)
    mask.save(MASK_OUT)
    guide.save(GUIDE_OUT)
    print(json.dumps({
        "base": str(BASE_OUT.relative_to(ROOT)),
        "mask": str(MASK_OUT.relative_to(ROOT)),
        "guide": str(GUIDE_OUT.relative_to(ROOT)),
        "size": TARGET_SIZE,
    }, indent=2))


def extract_first_embedded_image(path: Path) -> Image.Image:
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"{path} is not a binary glTF file")

    offset = 12
    json_chunk = None
    bin_chunk = None
    while offset < len(data):
        length = struct.unpack_from("<I", data, offset)[0]
        chunk_type = data[offset + 4:offset + 8]
        offset += 8
        chunk = data[offset:offset + length]
        offset += length
        if chunk_type == b"JSON":
            json_chunk = json.loads(chunk.decode("utf8"))
        elif chunk_type == b"BIN\x00":
            bin_chunk = chunk

    if not json_chunk or not bin_chunk:
        raise ValueError(f"{path} does not contain JSON and BIN chunks")

    image = json_chunk["images"][0]
    view = json_chunk["bufferViews"][image["bufferView"]]
    start = view.get("byteOffset", 0)
    end = start + view["byteLength"]
    return Image.open(io.BytesIO(bin_chunk[start:end]))


def build_mask_and_guide(base: Image.Image):
    w, h = base.size
    white_kit = bytearray(w * h)
    grey_kit = bytearray(w * h)
    pixels = base.load()
    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            maxc = max(r, g, b)
            minc = min(r, g, b)
            light = maxc / 255
            sat = 0 if maxc == 0 else (maxc - minc) / maxc
            i = y * w + x
            if sat < 0.18 and light > 0.62:
                white_kit[i] = 1
            elif sat < 0.22 and 0.3 < light <= 0.62:
                grey_kit[i] = 1
            elif is_brown_shorts_pixel(r, g, b):
                grey_kit[i] = 1

    white_kit = keep_large_components(white_kit, w, h, min_area=90)
    grey_kit = keep_large_components(grey_kit, w, h, min_area=90)

    mask = Image.new("L", (w, h), 0)
    guide = base.copy()
    mask_px = mask.load()
    guide_px = guide.load()
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if white_kit[i] or grey_kit[i]:
                mask_px[x, y] = 255
                r, g, b = guide_px[x, y]
                if grey_kit[i]:
                    overlay = (50, 110, 255)
                else:
                    overlay = (255, 55, 55)
                guide_px[x, y] = tuple(round(c * 0.45 + o * 0.55) for c, o in zip((r, g, b), overlay))
    return mask, guide


def is_brown_shorts_pixel(r: int, g: int, b: int):
    return (
        105 < r < 180
        and 70 < g < 135
        and b < 95
        and b < r * 0.4
        and r - g > 22
        and g - b > 18
    )


def keep_large_components(raw: bytearray, w: int, h: int, min_area: int):
    keep = bytearray(w * h)
    seen = bytearray(w * h)
    for start in range(w * h):
        if seen[start] or not raw[start]:
            continue
        q = deque([start])
        seen[start] = 1
        component = []
        while q:
            i = q.popleft()
            component.append(i)
            x = i % w
            y = i // w
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or nx >= w or ny < 0 or ny >= h:
                    continue
                ni = ny * w + nx
                if not seen[ni] and raw[ni]:
                    seen[ni] = 1
                    q.append(ni)
        if len(component) >= min_area:
            for i in component:
                keep[i] = 1
    return keep


if __name__ == "__main__":
    main()
