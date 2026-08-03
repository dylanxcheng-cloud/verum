#!/usr/bin/env python3
"""
Replace any DiceBear placeholder image URLs in a Verum data file with the
self-contained SVG placeholder used across the site.

Idempotent and dependency-free — safe to re-run. Used as a one-off cleanup when
merging the DiceBear-free pipeline into a branch whose stories.json still holds
old DiceBear URLs (e.g. resolving a merge against main). The pipeline itself
never emits DiceBear URLs anymore, so new stories stay clean.

Usage:
    python3 scripts/strip_dicebear_images.py                 # stories.json
    python3 scripts/strip_dicebear_images.py stories.json recordationem.json
"""
import json
import sys
from urllib.parse import quote


def placeholder(story_id, title):
    """Deterministic inline-SVG placeholder — mirrors auto_publish.generate_placeholder_url."""
    seed = f"verum-{story_id}-{title}"
    h = 0
    for ch in seed:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    hue = h % 360
    hue2 = (hue + 40) % 360
    cx = 120 + (h % 560)
    cy = 80 + ((h >> 3) % 290)
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'>"
        "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>"
        "<stop offset='0' stop-color='#1a1a1a'/>"
        f"<stop offset='1' stop-color='hsl({hue},45%,16%)'/></linearGradient></defs>"
        "<rect width='800' height='450' fill='url(#g)'/>"
        f"<circle cx='{cx}' cy='{cy}' r='140' fill='hsl({hue2},55%,45%)' opacity='0.18'/>"
        "</svg>"
    )
    return "data:image/svg+xml," + quote(svg, safe="")


def strip(path):
    with open(path) as f:
        data = json.load(f)
    count = 0

    def sweep(obj):
        nonlocal count
        if isinstance(obj, dict):
            for k, v in list(obj.items()):
                if k == "image" and isinstance(v, str) and "dicebear" in v.lower():
                    obj[k] = placeholder(obj.get("id", ""), obj.get("title", ""))
                    count += 1
                else:
                    sweep(v)
        elif isinstance(obj, list):
            for v in obj:
                sweep(v)

    sweep(data)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return count


if __name__ == "__main__":
    files = sys.argv[1:] or ["stories.json"]
    total = 0
    for p in files:
        n = strip(p)
        total += n
        print(f"{p}: replaced {n} DiceBear image URLs")
    print(f"done — {total} total")
