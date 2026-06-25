#!/usr/bin/env python3
import argparse
from pathlib import Path

from PIL import Image, ImageFilter


BACKGROUND_SIZE = (1672, 941)
CHARACTER_SIZE = (280, 380)
LOGO_SIZE = (640, 640)


def crop_to_aspect(img: Image.Image, aspect: float) -> Image.Image:
    width, height = img.size
    current = width / height
    if abs(current - aspect) < 0.001:
        return img
    if current > aspect:
        new_width = round(height * aspect)
        left = (width - new_width) // 2
        return img.crop((left, 0, left + new_width, height))
    new_height = round(width / aspect)
    top = (height - new_height) // 2
    return img.crop((0, top, width, top + new_height))


def process_background(src: Path, dest: Path) -> None:
    img = Image.open(src).convert("RGB")
    img = crop_to_aspect(img, BACKGROUND_SIZE[0] / BACKGROUND_SIZE[1])
    img = img.resize(BACKGROUND_SIZE, Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest)


def chroma_key_green(img: Image.Image) -> Image.Image:
    """Soft-remove a flat #00ff00 background that GPT may have antialiased."""
    img = img.convert("RGBA")
    px = img.load()
    width, height = img.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = px[x, y]
            green_distance = abs(r - 0) + abs(g - 255) + abs(b - 0)
            green_dominance = g - max(r, b)
            if green_distance < 90 or green_dominance > 75:
                alpha = 0
            elif green_dominance > 35:
                alpha = max(0, min(255, int((green_dominance - 35) * 6)))
                alpha = 255 - alpha
            else:
                alpha = a
            # despill: pull any green-tinted edge pixel down to a neutral value so
            # no bright green/white halo is left around the cutout (the subject is
            # prompted to never wear #00ff00, so this only touches key spill).
            if g > r and g > b:
                g = max(r, b)
            px[x, y] = (r, g, b, alpha)
    return img


def shave_fringe(img: Image.Image) -> Image.Image:
    """Erode the alpha by ~1px to drop the outermost semi-transparent ring — the
    last sliver of background blend that otherwise reads as a thin light outline."""
    a = img.getchannel("A").filter(ImageFilter.MinFilter(3))
    img.putalpha(a)
    return img


def process_logo(src: Path, dest: Path) -> None:
    img = chroma_key_green(Image.open(src))
    bounds = img.getchannel("A").getbbox()
    if bounds:
        img = img.crop(bounds)
    size = LOGO_SIZE
    scale = min((size[0] * 0.9) / img.width, (size[1] * 0.9) / img.height)
    fitted = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest)


def process_character(src: Path, dest: Path) -> None:
    img = shave_fringe(chroma_key_green(Image.open(src)))

    alpha = img.getchannel("A")
    bounds = alpha.getbbox()
    if bounds:
        img = img.crop(bounds)

    target_w, target_h = CHARACTER_SIZE
    scale = min((target_w * 0.88) / img.width, (target_h * 0.96) / img.height)
    fitted = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CHARACTER_SIZE, (0, 0, 0, 0))
    x = (target_w - fitted.width) // 2
    y = target_h - fitted.height - 2
    canvas.alpha_composite(fitted, (x, y))
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["background", "character", "logo"], required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    src = Path(args.input)
    dest = Path(args.output)
    if args.kind == "background":
        process_background(src, dest)
    elif args.kind == "logo":
        process_logo(src, dest)
    else:
        process_character(src, dest)


if __name__ == "__main__":
    main()
