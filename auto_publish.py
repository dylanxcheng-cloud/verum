"""
Verum News — Auto Publisher v2
Fetches RSS feeds, rewrites with Groq AI, updates stories.json, deploys to Netlify.

Usage:
  python auto_publish.py              # normal run
  python auto_publish.py --dry-run    # fetch + rewrite but don't save or deploy
  python auto_publish.py --validate   # validate stories.json only, no fetching
"""

import os
import re
import sys
import json
import time
import hashlib
import logging
import argparse
import feedparser
import requests
from datetime import datetime, timezone
from groq import Groq

# ── ARGS ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument('--dry-run',  action='store_true', help='Fetch + rewrite but do not save or deploy')
parser.add_argument('--validate', action='store_true', help='Validate stories.json only')
parser.add_argument('--limit',    type=int, default=6,  help='Max new stories per run (default 6)')
ARGS = parser.parse_args()

# ── LOGGING ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger('verum')

# ── CONFIG ────────────────────────────────────────────────────────────────────

GROQ_API_KEY       = os.environ.get('GROQ_API_KEY')
NETLIFY_AUTH_TOKEN = os.environ.get('NETLIFY_AUTH_TOKEN')
NETLIFY_SITE_ID    = os.environ.get('NETLIFY_SITE_ID', 'b6e1ba3f-9f5e-46c1-984a-10c3b5fa89de')
STORIES_FILE       = 'stories.json'
MAX_NEW_STORIES    = ARGS.limit

# Retry settings
MAX_RETRIES    = 3
RETRY_DELAY    = 2   # seconds, doubles each retry
GROQ_TIMEOUT   = 30  # seconds

# ── RSS FEEDS ─────────────────────────────────────────────────────────────────

FEEDS = [
    { 'url': 'https://feeds.bbci.co.uk/news/world/rss.xml',                   'source': 'bbc',       'source_label': 'BBC News',     'category': 'World'    },
    { 'url': 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'source': 'bbc',       'source_label': 'BBC News',     'category': 'Science'  },
    { 'url': 'https://feeds.bbci.co.uk/news/health/rss.xml',                  'source': 'bbc',       'source_label': 'BBC News',     'category': 'Health'   },
    { 'url': 'https://feeds.bbci.co.uk/news/politics/rss.xml',                'source': 'bbc',       'source_label': 'BBC News',     'category': 'Politics' },
    { 'url': 'https://feeds.reuters.com/reuters/worldNews',                   'source': 'reuters',   'source_label': 'Reuters',      'category': 'World'    },
    { 'url': 'https://feeds.reuters.com/reuters/politicsNews',                'source': 'reuters',   'source_label': 'Reuters',      'category': 'Politics' },
    { 'url': 'https://feeds.apnews.com/rss/apf-topnews',                      'source': 'ap',        'source_label': 'AP News',      'category': 'News'     },
    { 'url': 'https://feeds.apnews.com/rss/apf-sports',                       'source': 'ap',        'source_label': 'AP News',      'category': 'Sports'   },
    { 'url': 'https://feeds.apnews.com/rss/apf-Health',                       'source': 'ap',        'source_label': 'AP News',      'category': 'Health'   },
    { 'url': 'https://feeds.apnews.com/rss/apf-science',                      'source': 'ap',        'source_label': 'AP News',      'category': 'Science'  },
    { 'url': 'https://www.espn.com/espn/rss/news',                            'source': 'espn',      'source_label': 'ESPN',         'category': 'Sports'   },
    { 'url': 'https://feeds.npr.org/1001/rss.xml',                            'source': 'npr',       'source_label': 'NPR',          'category': 'News'     },
    { 'url': 'https://feeds.npr.org/1128/rss.xml',                            'source': 'npr',       'source_label': 'NPR',          'category': 'Health'   },
    { 'url': 'https://feeds.npr.org/1007/rss.xml',                            'source': 'npr',       'source_label': 'NPR',          'category': 'Science'  },
    { 'url': 'https://www.theguardian.com/world/rss',                         'source': 'guardian',  'source_label': 'The Guardian', 'category': 'World'    },
    { 'url': 'https://www.theguardian.com/politics/rss',                      'source': 'guardian',  'source_label': 'The Guardian', 'category': 'Politics' },
    { 'url': 'https://www.theguardian.com/science/rss',                       'source': 'guardian',  'source_label': 'The Guardian', 'category': 'Science'  },
    { 'url': 'https://www.theguardian.com/society/rss',                       'source': 'guardian',  'source_label': 'The Guardian', 'category': 'Health'   },
    { 'url': 'https://www.nasa.gov/rss/dyn/breaking_news.rss',                'source': 'nasa',      'source_label': 'NASA',         'category': 'Science'  },
]

# ── STABLE ID GENERATION ──────────────────────────────────────────────────────

def make_stable_id(entry, source_slug):
    """
    Generate a stable ID from feed GUID + source slug.
    Falls back to title hash if no GUID present.
    Format: {source_slug}_{8-char-hash}
    """
    guid = entry.get('id') or entry.get('guid') or entry.get('link') or ''
    if guid:
        raw = f"{source_slug}:{guid}"
    else:
        raw = f"{source_slug}:{entry.get('title', '')}"
    return f"{source_slug}_{hashlib.sha256(raw.encode()).hexdigest()[:8]}"

# ── SANITIZATION ──────────────────────────────────────────────────────────────

def sanitize_text(text):
    """Strip HTML tags, normalize whitespace, remove control characters."""
    if not text:
        return ''
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Remove HTML entities
    text = re.sub(r'&[a-zA-Z]+;', ' ', text)
    text = re.sub(r'&#\d+;', ' ', text)
    # Remove control characters except newlines
    text = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', text)
    # Normalize whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def is_valid_item(item):
    """Check that a feed item has enough usable content."""
    if not item.get('title') or len(item['title']) < 10:
        return False
    if not item.get('summary') or len(item['summary']) < 80:
        return False
    return True

# ── RSS FETCHING WITH RETRY ───────────────────────────────────────────────────

def fetch_feed_with_retry(feed_config):
    """Fetch a single RSS feed with exponential backoff retry."""
    url = feed_config['url']
    delay = RETRY_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            feed = feedparser.parse(url)
            if feed.bozo and not feed.entries:
                raise ValueError(f"Malformed feed: {feed.bozo_exception}")
            return feed
        except Exception as e:
            if attempt == MAX_RETRIES:
                log.warning(f"Failed to fetch {url} after {MAX_RETRIES} attempts: {e}")
                return None
            log.debug(f"Retry {attempt}/{MAX_RETRIES} for {url}: {e}")
            time.sleep(delay)
            delay *= 2
    return None

def fetch_all_rss():
    """Fetch all feeds and return sanitized, validated items."""
    items = []
    stats = {'feeds_ok': 0, 'feeds_failed': 0, 'items_raw': 0, 'items_valid': 0}

    for feed_config in FEEDS:
        log.info(f"Fetching {feed_config['source_label']} ({feed_config['category']})...")
        feed = fetch_feed_with_retry(feed_config)

        if not feed:
            stats['feeds_failed'] += 1
            continue

        stats['feeds_ok'] += 1
        for entry in feed.entries[:3]:
            stats['items_raw'] += 1
            title   = sanitize_text(entry.get('title', ''))
            summary = sanitize_text(
                entry.get('summary') or
                entry.get('description') or
                entry.get('content', [{}])[0].get('value', '')
            )
            item = {
                'id':          make_stable_id(entry, feed_config['source']),
                'title':       title,
                'summary':     summary[:1200],
                'source':      feed_config['source'],
                'source_label':feed_config['source_label'],
                'category':    feed_config['category'],
                'original_url':entry.get('link', ''),
                'guid':        entry.get('id', ''),
            }
            if is_valid_item(item):
                items.append(item)
                stats['items_valid'] += 1

    log.info(f"RSS stats: {stats['feeds_ok']} feeds OK, {stats['feeds_failed']} failed, "
             f"{stats['items_valid']}/{stats['items_raw']} items valid")
    return items

# ── GROQ REWRITE WITH RETRY ───────────────────────────────────────────────────

def rewrite_with_groq(item):
    """Rewrite an RSS item as a Verum article with retry/backoff."""
    if not GROQ_API_KEY:
        log.error("GROQ_API_KEY not set")
        return None

    client = Groq(api_key=GROQ_API_KEY)
    prompt = f"""You are a journalist for Verum, a no-nonsense news site with the tagline "The truth for all."
Verum reports facts clearly and concisely — no sensationalism, no opinion, no fluff.

Rewrite the following news item as a short Verum article with 3–4 paragraphs.
- Write in plain, clear language
- Stick strictly to the facts given
- Do not add opinions, speculation, or editorializing
- Do not mention the original source by name in the article body
- Keep it under 250 words
- Separate paragraphs with a single blank line

Source headline: {item['title']}
Source summary: {item['summary']}

Return ONLY the article body. No headline, no byline, no labels."""

    delay = RETRY_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model='llama-3.3-70b-versatile',
                messages=[{'role': 'user', 'content': prompt}],
                max_tokens=600,
                temperature=0.4,
                timeout=GROQ_TIMEOUT,
            )
            content = sanitize_text(response.choices[0].message.content)
            if len(content) < 100:
                raise ValueError(f"Response too short ({len(content)} chars)")
            return content
        except Exception as e:
            if attempt == MAX_RETRIES:
                log.warning(f"Groq failed for '{item['title'][:50]}' after {MAX_RETRIES} attempts: {e}")
                return None
            log.debug(f"Groq retry {attempt}/{MAX_RETRIES}: {e}")
            time.sleep(delay)
            delay *= 2
    return None

# ── NEW STORIES.JSON STRUCTURE ────────────────────────────────────────────────
#
# {
#   "stories": { "id": { ...story }, ... },      # flat lookup by ID
#   "featured": {
#     "hero": "story_id",
#     "stack": ["id1", "id2", "id3"],
#     "latest": ["id1", ..., "id6"],
#     "world": ["id1", ..., "id4"]
#   },
#   "categoryIndex": {
#     "News": ["id1", "id2", ...],
#     "Sports": [...],
#     ...
#   },
#   "breaking": "...",
#   "events": [...],
#   "mostRead": [...]
# }

def build_story_object(item, content):
    """Build a normalized story object."""
    return {
        'id':          item['id'],
        'title':       item['title'],
        'category':    item['category'],
        'author':      item['source_label'],
        'source':      item['source'],
        'time':        datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
        'read':        '3 min read',
        'image':       f"images/{item['id']}.jpg",
        'content':     content,
        'original_url':item.get('original_url', ''),
        'guid':        item.get('guid', ''),
    }

def migrate_legacy_structure(data):
    """
    Convert old stories.json format to new flat structure.
    Safe to call on already-migrated data.
    """
    if 'stories' in data and 'featured' in data:
        return data  # already migrated

    log.info("Migrating stories.json to new flat structure...")
    stories    = {}
    featured   = { 'hero': None, 'stack': [], 'latest': [], 'world': [] }
    cat_index  = { c: [] for c in ['News', 'World', 'Politics', 'Sports', 'Health', 'Science'] }

    def add(story, slot=None, index=None):
        sid = story.get('id')
        if not sid:
            return
        # Normalize world stories (they use 'source' not 'author')
        if 'source' in story and 'author' not in story:
            story['author'] = story['source']
        stories[sid] = story
        if slot == 'hero':
            featured['hero'] = sid
        elif slot in ('stack', 'latest', 'world'):
            featured[slot].append(sid)

    # Migrate homepage slots
    if 'hero' in data:
        add(data['hero'], 'hero')
    for s in data.get('stack',  []): add(s, 'stack')
    for s in data.get('latest', []): add(s, 'latest')
    for s in data.get('world',  []): add(s, 'world')

    # Migrate category banks
    for cat, cat_stories in data.get('categories', {}).items():
        for s in cat_stories:
            sid = s.get('id')
            if sid:
                stories[sid] = s
                if sid not in cat_index.get(cat, []):
                    cat_index.setdefault(cat, []).append(sid)

    return {
        'stories':       stories,
        'featured':      featured,
        'categoryIndex': cat_index,
        'breaking':      data.get('breaking', ''),
        'events':        data.get('events', []),
        'mostRead':      data.get('mostRead', []),
    }

def inject_new_stories(data, new_stories):
    """Inject new stories into the flat structure."""
    stories    = data['stories']
    featured   = data['featured']
    cat_index  = data['categoryIndex']

    for i, story in enumerate(new_stories):
        sid = story['id']
        cat = story['category']

        # Always store in flat stories dict
        stories[sid] = story

        if i == 0:
            # Demote current hero to latest
            old_hero = featured.get('hero')
            if old_hero:
                featured['latest'].insert(0, old_hero)
                if len(featured['latest']) > 6:
                    demoted = featured['latest'].pop()
                    _add_to_category(cat_index, stories, demoted)
            featured['hero'] = sid
            log.info(f"→ Hero: {story['title'][:60]}")

        elif i <= 3:
            featured['latest'].insert(0, sid)
            if len(featured['latest']) > 6:
                demoted = featured['latest'].pop()
                _add_to_category(cat_index, stories, demoted)
            log.info(f"→ Latest: {story['title'][:60]}")

        else:
            _add_to_category(cat_index, stories, sid)
            log.info(f"→ {cat} bank: {story['title'][:60]}")

    data['stories']       = stories
    data['featured']      = featured
    data['categoryIndex'] = cat_index
    return data

def _add_to_category(cat_index, stories, sid):
    """Add a story ID to its category index, capped at 10."""
    story = stories.get(sid, {})
    cat   = story.get('category', 'News')
    if cat not in cat_index:
        cat_index[cat] = []
    if sid not in cat_index[cat]:
        cat_index[cat].insert(0, sid)
    if len(cat_index[cat]) > 10:
        cat_index[cat].pop()

# ── VALIDATION ────────────────────────────────────────────────────────────────

REQUIRED_STORY_FIELDS = ['id', 'title', 'author', 'time', 'image', 'content']

def validate_stories(data):
    """Validate stories.json structure. Returns (is_valid, report)."""
    issues  = []
    warnings = []

    # Check top-level keys
    for key in ['stories', 'featured', 'categoryIndex', 'breaking', 'events']:
        if key not in data:
            issues.append(f"Missing top-level key: '{key}'")

    if issues:
        return False, {'errors': issues, 'warnings': warnings}

    stories   = data['stories']
    featured  = data['featured']
    cat_index = data['categoryIndex']

    # Validate featured references
    hero_id = featured.get('hero')
    if hero_id and hero_id not in stories:
        issues.append(f"Featured hero '{hero_id}' not found in stories")

    for slot in ['stack', 'latest', 'world']:
        for sid in featured.get(slot, []):
            if sid not in stories:
                issues.append(f"Featured {slot} '{sid}' not found in stories")

    # Validate category index references
    for cat, ids in cat_index.items():
        for sid in ids:
            if sid not in stories:
                warnings.append(f"Category '{cat}' references missing story '{sid}'")
        if len(ids) > 10:
            warnings.append(f"Category '{cat}' has {len(ids)} stories (max 10)")

    # Validate individual stories
    invalid_count = 0
    for sid, story in stories.items():
         for field in REQUIRED_STORY_FIELDS:
             if field not in story or not story[field]:
                 issues.append(f"Story '{sid}' missing required field: '{field}'")
                 invalid_count += 1
                 break
        # World stories use 'region' instead of 'category' — either is valid
         if not story.get('category') and not story.get('region'):
             issues.append(f"Story '{sid}' missing both 'category' and 'region'")
    is_valid = len(issues) == 0
    report = {
        'total_stories': len(stories),
        'errors':        issues,
        'warnings':      warnings,
        'valid':         is_valid,
    }
    return is_valid, report

# ── NETLIFY DEPLOY ────────────────────────────────────────────────────────────

def deploy_to_netlify(data):
    """Trigger Netlify redeploy by pushing updated stories.json."""
    if not NETLIFY_AUTH_TOKEN:
        log.error("NETLIFY_AUTH_TOKEN not set — skipping deploy")
        return False

    log.info("Deploying to Netlify...")
    headers = { 'Authorization': f'Bearer {NETLIFY_AUTH_TOKEN}' }

    # Try file upload API first
    upload_url = f'https://api.netlify.com/api/v1/sites/{NETLIFY_SITE_ID}/files/stories.json'
    payload    = json.dumps(data, indent=2).encode('utf-8')

    delay = RETRY_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            res = requests.put(
                upload_url,
                headers={**headers, 'Content-Type': 'application/octet-stream'},
                data=payload,
                timeout=30,
            )
            if res.status_code in (200, 201):
                log.info("✅ stories.json deployed to Netlify")
                return True
            elif res.status_code == 404:
                # Site may require full deploy trigger
                log.warning("File API 404 — triggering full redeploy")
                deploy_res = requests.post(
                    f'https://api.netlify.com/api/v1/sites/{NETLIFY_SITE_ID}/deploys',
                    headers=headers,
                    timeout=30,
                )
                log.info(f"Redeploy trigger: {deploy_res.status_code}")
                return deploy_res.status_code in (200, 201)
            else:
                raise Exception(f"HTTP {res.status_code}: {res.text[:200]}")
        except Exception as e:
            if attempt == MAX_RETRIES:
                log.error(f"Netlify deploy failed after {MAX_RETRIES} attempts: {e}")
                return False
            log.debug(f"Deploy retry {attempt}/{MAX_RETRIES}: {e}")
            time.sleep(delay)
            delay *= 2

    return False

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 60)
    log.info("VERUM AUTO PUBLISHER v2")
    log.info(f"Mode: {'DRY RUN' if ARGS.dry_run else 'LIVE'}")
    log.info("=" * 60)

    # Load stories.json
    log.info(f"Loading {STORIES_FILE}...")
    try:
        with open(STORIES_FILE) as f:
            raw = json.load(f)
    except FileNotFoundError:
        log.error(f"{STORIES_FILE} not found")
        sys.exit(1)
    except json.JSONDecodeError as e:
        log.error(f"Invalid JSON in {STORIES_FILE}: {e}")
        sys.exit(1)

    # Migrate to new structure if needed
    data = migrate_legacy_structure(raw)

    # Validate mode — just check and exit
    if ARGS.validate:
        is_valid, report = validate_stories(data)
        log.info(f"Validation report: {json.dumps(report, indent=2)}")
        sys.exit(0 if is_valid else 1)

    # Get seen IDs to avoid duplicates
    seen_ids = set(data['stories'].keys())
    log.info(f"Existing stories: {len(seen_ids)}")

    # Fetch RSS
    log.info("Fetching RSS feeds...")
    rss_items = fetch_all_rss()

    # Filter unseen
    new_items = [item for item in rss_items if item['id'] not in seen_ids]
    import random
    random.shuffle(new_items)
    new_items = new_items[:MAX_NEW_STORIES]
    log.info(f"New items to process: {len(new_items)}")

    if not new_items:
        log.info("No new stories found — site is up to date")
        return

    # Rewrite with Groq
    log.info("Rewriting with Groq AI...")
    new_stories = []
    for item in new_items:
        log.info(f"Processing: {item['title'][:60]}...")
        content = rewrite_with_groq(item)
        if content:
            new_stories.append(build_story_object(item, content))
            log.info("✓ Written")
        else:
            log.warning(f"✗ Skipped: {item['title'][:50]}")

    log.info(f"Successfully written: {len(new_stories)}/{len(new_items)} stories")

    if not new_stories:
        log.error("No stories written — aborting")
        sys.exit(1)

    # Inject into data structure
    log.info("Updating stories structure...")
    data = inject_new_stories(data, new_stories)

    # Validate before saving
    is_valid, report = validate_stories(data)
    if report['warnings']:
        for w in report['warnings']:
            log.warning(f"Validation warning: {w}")
    if not is_valid:
        for e in report['errors']:
            log.error(f"Validation error: {e}")
        log.error("Validation failed — aborting save")
        sys.exit(1)

    log.info(f"Validation passed: {report['total_stories']} stories total")

    if ARGS.dry_run:
        log.info("DRY RUN — skipping save and deploy")
        log.info(f"Would have published {len(new_stories)} stories")
        return

    # Save locally
    with open(STORIES_FILE, 'w') as f:
        json.dump(data, f, indent=2)
    log.info(f"✓ {STORIES_FILE} saved")

    # Deploy
    deploy_to_netlify(data)

    log.info("=" * 60)
    log.info(f"DONE — {len(new_stories)} new stories published")
    log.info("=" * 60)

if __name__ == '__main__':
    main()
