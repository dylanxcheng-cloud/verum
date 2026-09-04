#!/usr/bin/env python3
"""
Backfill real images for stories that currently show a generated placeholder.

The publishing pipeline now pulls a real photo from each RSS feed (and the
article's og:image) going forward, but stories already written before that hold
an SVG-placeholder data URI. This one-off script walks stories.json and, for
every story whose image is a placeholder (or missing), tries two keyless
sources in order and swaps in the first real photo it finds:

    1. the article's own og:image / twitter:image (from `original_url`)
    2. the story's main entity's lead photo on Wikipedia (from the title) —
       no API key, and it works even for stories with no source URL.

Run it where outbound internet is available (your machine, or a CI job) — NOT
inside a restricted sandbox:

    python3 scripts/backfill_images.py                # updates stories.json
    python3 scripts/backfill_images.py --dry-run      # report only, no write
    python3 scripts/backfill_images.py --limit 50     # only fix the first 50
    python3 scripts/backfill_images.py --no-wiki      # og:image only, skip Wikipedia

It is safe to re-run: stories that already have a real image are skipped, and
any story whose page can't be reached simply keeps its placeholder.
"""
import argparse
import json
import re
import sys
import time
from urllib.parse import quote

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


_STOP = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
    "with", "by", "from", "is", "are", "was", "were", "be", "as", "after",
    "before", "over", "amid", "says", "said", "new", "news", "update", "live",
    "video", "photos", "opinion", "analysis", "report", "world", "business",
    "politics", "health", "science", "sports", "government", "president",
    "minister", "police", "court", "study", "people", "this", "that",
}


def _entity_candidates(title):
    """Ordered Wikipedia page-title guesses: capitalized proper phrases first,
    then standalone proper nouns."""
    words = re.findall(r"[A-Za-z][A-Za-z'\-]+", title or "")
    phrases, phrase = [], []
    for w in words:
        if w[0].isupper() and w.lower() not in _STOP:
            phrase.append(w)
        else:
            if len(phrase) >= 2:
                phrases.append(" ".join(phrase))
            phrase = []
    if len(phrase) >= 2:
        phrases.append(" ".join(phrase))
    singles = [w for w in words
               if w[0].isupper() and len(w) > 3 and w.lower() not in _STOP]
    out, seen = [], set()
    for c in phrases + singles:
        cl = c.lower()
        if cl not in seen:
            seen.add(cl)
            out.append(c)
    return out


def fetch_wikipedia_image(title):
    """Return the lead photo of the story's main entity on Wikipedia, or None.

    Keyless (public REST summary API); skips disambiguation pages so the image
    stays topic-relevant."""
    for entity in _entity_candidates(title)[:4]:
        slug = quote(entity.replace(" ", "_"), safe="")
        try:
            res = requests.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}",
                headers=HEADERS, timeout=12)
            if res.status_code != 200:
                continue
            data = res.json()
        except Exception:
            continue
        if data.get("type") not in (None, "standard"):
            continue
        img = (data.get("originalimage") or {}).get("source") \
            or (data.get("thumbnail") or {}).get("source")
        if img and img.startswith("http"):
            return img
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="report only, don't write")
    parser.add_argument("--limit", type=int, default=0, help="max stories to fix (0 = all)")
    parser.add_argument("--delay", type=float, default=0.4, help="seconds between requests")
    parser.add_argument("--no-wiki", dest="wiki", action="store_false",
                        help="only try og:image, skip the Wikipedia fallback")
    args = parser.parse_args()

    with open(STORIES_FILE) as f:
        data = json.load(f)
    stories = data.get("stories", {})

    # A story is fixable if it has a source URL (og:image) OR a title (Wikipedia).
    todo = [(sid, s) for sid, s in stories.items()
            if isinstance(s, dict) and is_placeholder(s.get("image"))
            and (s.get("original_url") or (args.wiki and s.get("title")))]
    if args.limit:
        todo = todo[:args.limit]

    print(f"{len(todo)} stories on placeholders to try (of {len(stories)} total).")
    fixed = failed = 0
    via = {"og:image": 0, "wikipedia": 0}
    for i, (sid, s) in enumerate(todo, 1):
        img = fetch_og_image(s.get("original_url")) if s.get("original_url") else None
        source = "og:image"
        if not img and args.wiki:
            img = fetch_wikipedia_image(s.get("title"))
            source = "wikipedia"
        if img:
            fixed += 1
            via[source] += 1
            if not args.dry_run:
                s["image"] = img
            tag = "would set" if args.dry_run else "set"
            print(f"  [{i}/{len(todo)}] {tag} ({source}): {s.get('title','')[:46]} → {img[:64]}")
        else:
            failed += 1
        time.sleep(args.delay)

    print(f"\nDone. {fixed} images found "
          f"({via['og:image']} og:image, {via['wikipedia']} Wikipedia), "
          f"{failed} unavailable (kept placeholder).")
    if fixed and not args.dry_run:
        with open(STORIES_FILE, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"✓ {STORIES_FILE} updated. Commit and push to publish.")
    elif args.dry_run:
        print("(dry run — nothing written)")


if __name__ == "__main__":
    main()
