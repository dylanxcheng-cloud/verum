#!/usr/bin/env python3
"""
Backfill real images for stories that currently show a generated placeholder.

The publishing pipeline now pulls a real photo from each RSS feed (and the
article's og:image) going forward, but stories already written before that hold
an SVG-placeholder data URI. This one-off script walks stories.json and, for
every story whose image is a placeholder (or missing), fetches the article's
own og:image / twitter:image from its `original_url` and swaps it in.

Run it where outbound internet is available (your machine, or a CI job) — NOT
inside a restricted sandbox:

    python3 scripts/backfill_images.py                # updates stories.json
    python3 scripts/backfill_images.py --dry-run      # report only, no write
    python3 scripts/backfill_images.py --limit 50     # only fix the first 50

It is safe to re-run: stories that already have a real image are skipped, and
any story whose page can't be reached simply keeps its placeholder.
"""
import argparse
import json
import re
import sys
import time

try:
    import requests
except ImportError:
    print("This script needs the 'requests' package:  pip install requests")
    sys.exit(1)

STORIES_FILE = "stories.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
}
_OG_PROPS = ("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src")


def is_placeholder(image):
    """True if the story has no real image (placeholder data URI, empty, or a
    local path we can't serve as a photo)."""
    if not image or not isinstance(image, str):
        return True
    low = image.lower()
    return low.startswith("data:") or "dicebear" in low or not low.startswith("http")


def fetch_og_image(url):
    """Return the article's og:image / twitter:image, or None on any failure."""
    if not url or not url.startswith(("http://", "https://")):
        return None
    try:
        res = requests.get(url, headers=HEADERS, timeout=12)
        if res.status_code != 200:
            return None
        html = res.text[:250000]
    except Exception:
        return None
    for prop in _OG_PROPS:
        esc = re.escape(prop)
        m = re.search(r'<meta[^>]+(?:property|name)=["\']' + esc + r'["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
        if not m:
            m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + esc + r'["\']', html, re.I)
        if m and m.group(1).startswith("http"):
            return m.group(1)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="report only, don't write")
    parser.add_argument("--limit", type=int, default=0, help="max stories to fix (0 = all)")
    parser.add_argument("--delay", type=float, default=0.4, help="seconds between requests")
    args = parser.parse_args()

    with open(STORIES_FILE) as f:
        data = json.load(f)
    stories = data.get("stories", {})

    todo = [(sid, s) for sid, s in stories.items()
            if isinstance(s, dict) and is_placeholder(s.get("image")) and s.get("original_url")]
    if args.limit:
        todo = todo[:args.limit]

    print(f"{len(todo)} stories on placeholders with a source URL to try "
          f"(of {len(stories)} total).")
    fixed = failed = 0
    for i, (sid, s) in enumerate(todo, 1):
        img = fetch_og_image(s["original_url"])
        if img:
            fixed += 1
            if not args.dry_run:
                s["image"] = img
            tag = "would set" if args.dry_run else "set"
            print(f"  [{i}/{len(todo)}] {tag}: {s.get('title','')[:50]} → {img[:70]}")
        else:
            failed += 1
        time.sleep(args.delay)

    print(f"\nDone. {fixed} images found, {failed} unavailable (kept placeholder).")
    if fixed and not args.dry_run:
        with open(STORIES_FILE, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"✓ {STORIES_FILE} updated. Commit and push to publish.")
    elif args.dry_run:
        print("(dry run — nothing written)")


if __name__ == "__main__":
    main()
