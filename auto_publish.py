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
NETLIFY_SITE_ID    = os.environ.get('NETLIFY_SITE_ID')
UNSPLASH_API_KEY   = os.environ.get('UNSPLASH_API_KEY')  # Optional
STORIES_FILE       = 'stories.json'
MAX_NEW_STORIES    = ARGS.limit

# Validate required env vars (skip Netlify/Groq checks in --dry-run)
if not ARGS.dry_run:
    if not NETLIFY_SITE_ID:
        log.error("NETLIFY_SITE_ID not set")
        sys.exit(1)
    if not GROQ_API_KEY:
        log.error("GROQ_API_KEY not set")
        sys.exit(1)

# Retry settings
MAX_RETRIES    = 3
RETRY_DELAY    = 2   # seconds, doubles each retry
GROQ_TIMEOUT   = 30  # seconds

# ── RSS FEEDS ─────────────────────────────────────────────────────────────────
#
# EXPANDED FEED LIST: High-quality, credible sources prioritizing depth & truth
# - Tier 1: Major news bureaus (Reuters, BBC, AP, Guardian, NPR)
# - Tier 2: Financial & specialized (Investopedia, ProPublica, Ars Technica)
# - Tier 3: Academic & verification (The Conversation, Nature, College journalism)
# - Tier 4: Sports & lifestyle (ESPN, Yahoo Sports, Axios)
#

FEEDS = [
    # ── TIER 1: ESTABLISHED NEWS BUREAUS ──────────────────────────────────────
    { 'url': 'https://feeds.bbci.co.uk/news/world/rss.xml',                   'source': 'bbc',           'source_label': 'BBC News',             'category': 'World'     },
    { 'url': 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'source': 'bbc',           'source_label': 'BBC News',             'category': 'Science'   },
    { 'url': 'https://feeds.bbci.co.uk/news/health/rss.xml',                  'source': 'bbc',           'source_label': 'BBC News',             'category': 'Health'    },
    { 'url': 'https://feeds.bbci.co.uk/news/politics/rss.xml',                'source': 'bbc',           'source_label': 'BBC News',             'category': 'Politics'  },
    { 'url': 'https://feeds.reuters.com/reuters/worldNews',                   'source': 'reuters',       'source_label': 'Reuters',              'category': 'World'     },
    { 'url': 'https://feeds.reuters.com/reuters/politicsNews',                'source': 'reuters',       'source_label': 'Reuters',              'category': 'Politics'  },
    { 'url': 'https://feeds.apnews.com/rss/apf-topnews',                      'source': 'ap',            'source_label': 'AP News',              'category': 'News'      },
    { 'url': 'https://feeds.apnews.com/rss/apf-sports',                       'source': 'ap',            'source_label': 'AP News',              'category': 'Sports'    },
    { 'url': 'https://feeds.apnews.com/rss/apf-Health',                       'source': 'ap',            'source_label': 'AP News',              'category': 'Health'    },
    { 'url': 'https://feeds.apnews.com/rss/apf-science',                      'source': 'ap',            'source_label': 'AP News',              'category': 'Science'   },
    { 'url': 'https://www.theguardian.com/world/rss',                         'source': 'guardian',      'source_label': 'The Guardian',         'category': 'World'     },
    { 'url': 'https://www.theguardian.com/politics/rss',                      'source': 'guardian',      'source_label': 'The Guardian',         'category': 'Politics'  },
    { 'url': 'https://www.theguardian.com/science/rss',                       'source': 'guardian',      'source_label': 'The Guardian',         'category': 'Science'   },
    { 'url': 'https://www.theguardian.com/society/rss',                       'source': 'guardian',      'source_label': 'The Guardian',         'category': 'Health'    },
    { 'url': 'https://feeds.npr.org/1001/rss.xml',                            'source': 'npr',           'source_label': 'NPR',                  'category': 'News'      },
    { 'url': 'https://feeds.npr.org/1128/rss.xml',                            'source': 'npr',           'source_label': 'NPR',                  'category': 'Health'    },
    { 'url': 'https://feeds.npr.org/1007/rss.xml',                            'source': 'npr',           'source_label': 'NPR',                  'category': 'Science'   },
    
    # ── TIER 2: FINANCIAL, TECH, INVESTIGATIVE (DEPTH & CITATIONS) ───────────
    { 'url': 'https://www.investopedia.com/feed.xml',                         'source': 'investopedia',  'source_label': 'Investopedia',         'category': 'Business'  },
    { 'url': 'https://feeds.propublica.org/nfl',                              'source': 'propublica',    'source_label': 'ProPublica',           'category': 'News'      },
    { 'url': 'https://arstechnica.com/feed/',                                 'source': 'arstechnica',   'source_label': 'Ars Technica',         'category': 'Science'   },
    { 'url': 'https://www.axios.com/feed/news',                               'source': 'axios',         'source_label': 'Axios',                'category': 'News'      },
    { 'url': 'https://feeds.vox.com/rss/index.xml',                           'source': 'vox',           'source_label': 'Vox',                  'category': 'News'      },
    { 'url': 'https://www.politico.com/rss/politics.xml',                     'source': 'politico',      'source_label': 'Politico',             'category': 'Politics'  },
    { 'url': 'https://www.theatlantic.com/feed/rss/all/',                     'source': 'atlantic',      'source_label': 'The Atlantic',         'category': 'News'      },
    { 'url': 'https://www.wired.com/feed/rss',                                'source': 'wired',         'source_label': 'WIRED',                'category': 'Science'   },
    
    # ── TIER 3: ACADEMIC, VERIFICATION, FACT-CHECKING (TRUTH-FOCUSED) ───────
    { 'url': 'https://theconversation.com/us/articles.atom',                  'source': 'conversation',  'source_label': 'The Conversation',     'category': 'Science'   },
    { 'url': 'https://www.nature.com/nature/current_issue/rss',               'source': 'nature',        'source_label': 'Nature',               'category': 'Science'   },
    { 'url': 'https://feeds.sciencemag.org/science-news',                     'source': 'science',       'source_label': 'Science Magazine',     'category': 'Science'   },
    { 'url': 'https://feeds.aip.org/feeds/latest-physics-news.xml',           'source': 'aip',           'source_label': 'AIP Physics News',     'category': 'Science'   },
    { 'url': 'https://www.snopes.com/feed/',                                  'source': 'snopes',        'source_label': 'Snopes',               'category': 'News'      },
    { 'url': 'https://fullfact.org/feed/',                                    'source': 'fullfact',      'source_label': 'Full Fact',            'category': 'News'      },
    
    # ── TIER 4: SPORTS, COLLEGE JOURNALISM, SPECIALIZED ──────────────────────
    { 'url': 'https://www.espn.com/espn/rss/news',                            'source': 'espn',          'source_label': 'ESPN',                 'category': 'Sports'    },
    { 'url': 'https://sports.yahoo.com/rss/headlines.rss',                    'source': 'yahsports',     'source_label': 'Yahoo Sports',         'category': 'Sports'    },
    { 'url': 'https://www.cjr.org/feed',                                      'source': 'cjr',           'source_label': 'Columbia Journalism Review', 'category': 'News' },
    { 'url': 'https://news.columbia.edu/feed/',                               'source': 'columbiauniv',  'source_label': 'Columbia University News', 'category': 'News' },
    { 'url': 'https://news.yale.edu/feed.xml',                                'source': 'yaleuniv',      'source_label': 'Yale University News',  'category': 'News'      },
    { 'url': 'https://news.mit.edu/feed.xml',                                 'source': 'mituniv',       'source_label': 'MIT News',             'category': 'Science'   },
    { 'url': 'https://news.stanford.edu/feed/',                               'source': 'stanforduniv',  'source_label': 'Stanford News',        'category': 'Science'   },
    { 'url': 'https://news.berkeley.edu/feed/',                               'source': 'berkeleyuniv',  'source_label': 'UC Berkeley News',     'category': 'Science'   },
    { 'url': 'https://www.nasa.gov/rss/dyn/breaking_news.rss',                'source': 'nasa',          'source_label': 'NASA',                 'category': 'Science'   },
    { 'url': 'https://www.bls.gov/feed/news.xml',                             'source': 'bls',           'source_label': 'U.S. Bureau of Labor Statistics', 'category': 'Business' },
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

# ── IMAGE FETCHING ───────────────────────────────────────────────────────────

def extract_keywords(text, max_keywords=5):
    """
    Extract meaningful keywords from text, prioritizing proper nouns and key terms.
    Returns keywords ranked by relevance for image search.
    """
    if not text:
        return []
    
    stop_words = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'must', 'says', 'said', 'say', 'new',
        'as', 'this', 'that', 'these', 'those', 'which', 'who', 'what', 'when',
        'where', 'why', 'how', 'all', 'each', 'every', 'both', 'any', 'some',
    }
    
    words = text.split()
    keywords = []
    
    # Priority 1: Proper nouns (capitalized, > 3 chars)
    proper_nouns = [
        w for w in words 
        if len(w) > 2 and w[0].isupper() and w.lower() not in stop_words
    ]
    keywords.extend(proper_nouns[:2])
    
    # Priority 2: Compound terms (consecutive significant words)
    significant_words = [
        w.lower() for w in words 
        if len(w) > 3 and w.lower() not in stop_words
    ]
    for i in range(len(significant_words) - 1):
        if i < 3:  # Look in first 3 pairs
            pair = f"{significant_words[i]} {significant_words[i+1]}"
            if pair not in keywords:
                keywords.append(pair)
    
    # Priority 3: Individual significant words
    for w in significant_words:
        if w not in keywords and len(keywords) < max_keywords:
            keywords.append(w)
    
    return keywords[:max_keywords]

def construct_search_queries(title, summary, category):
    """
    Construct multiple search queries in priority order.
    Returns list of queries to try: compound terms first, then individual keywords.
    """
    queries = []
    
    # Extract keywords from title (most important)
    title_keywords = extract_keywords(title, max_keywords=4)
    
    # Extract keywords from summary (supporting context)
    summary_keywords = extract_keywords(summary, max_keywords=3)
    
    # Strategy 1: Compound terms from title (highest specificity)
    compound_from_title = [k for k in title_keywords if ' ' in k]
    queries.extend(compound_from_title[:2])
    
    # Strategy 2: Compound terms from summary
    compound_from_summary = [k for k in summary_keywords if ' ' in k]
    queries.extend(compound_from_summary[:1])
    
    # Strategy 3: Individual keywords from title
    individual_from_title = [k for k in title_keywords if ' ' not in k]
    queries.extend(individual_from_title[:2])
    
    # Strategy 4: Category-based fallback (general relevance)
    category_queries = {
        'science': 'science research laboratory',
        'politics': 'politics government',
        'business': 'business finance',
        'sports': 'sports athlete competition',
        'health': 'health medicine',
        'world': 'world globe travel',
        'technology': 'technology innovation',
        'news': 'news reporting journalism',
    }
    category_query = category_queries.get(category.lower(), 'news')
    queries.append(category_query)
    
    # Strategy 5: First individual keyword from summary
    individual_from_summary = [k for k in summary_keywords if ' ' not in k]
    queries.extend(individual_from_summary[:1])
    
    # Remove duplicates while preserving order
    seen = set()
    unique_queries = []
    for q in queries:
        if q and q not in seen:
            seen.add(q)
            unique_queries.append(q)
    
    return unique_queries or ['news']  # Fallback if empty

def fetch_image_from_unsplash(search_query):
    """Fetch a random image from Unsplash based on search query."""
    if not UNSPLASH_API_KEY or not search_query:
        return None
    
    try:
        url = 'https://api.unsplash.com/photos/random'
        params = {
            'query': search_query,
            'client_id': UNSPLASH_API_KEY,
            'w': 800,
            'h': 450,
            'fit': 'crop',
        }
        res = requests.get(url, params=params, timeout=10)
        if res.status_code == 200:
            data = res.json()
            img_url = data.get('urls', {}).get('raw')
            if img_url:
                return img_url
    except Exception as e:
        log.debug(f"Unsplash fetch failed for '{search_query}': {e}")
    return None

def generate_dicebear_url(story_id, title):
    """Generate a DiceBear procedural placeholder image URL."""
    seed = f"verum-{story_id}-{title}".replace(' ', '-')[:50]
    return f"https://api.dicebear.com/7.x/shapes/svg?seed={seed}&backgroundColor=1a1a1a&scale=80"

def get_image_for_story(story_id, title, summary, category='news'):
    """
    Get image URL with intelligent search strategy.
    Tries multiple search queries in order of specificity: compound terms → 
    individual keywords → category fallback → DiceBear placeholder.
    """
    # Build search queries in priority order
    search_queries = construct_search_queries(title, summary, category)
    
    # Try each search query strategy
    for query in search_queries:
        if query:
            img_url = fetch_image_from_unsplash(query)
            if img_url:
                log.info(f"  → Image: Unsplash ('{query}')")
                return img_url
    
    # Fall back to DiceBear procedural placeholder
    img_url = generate_dicebear_url(story_id, title)
    log.info(f"  → Image: DiceBear placeholder")
    return img_url

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
    prompt = f"""You are a senior journalist for Verum, a prestigious news publication dedicated to factual accuracy and depth.
Verum's mission: "The truth for all" - comprehensive, well-sourced reporting that leaves no doubt about what occurred.

REWRITE THE FOLLOWING NEWS ITEM AS A VERUM ARTICLE with these priorities:

✓ ACCURACY & DEPTH
  - Include specific facts, numbers, dates, names
  - Provide context and background (why this matters)
  - Explain the full scope of what occurred
  - No generalizations without supporting details

✓ CITATIONS & SOURCES
  - Attribute claims to their original sources
  - Identify who said what, when, and under what circumstances
  - Include direct quotes when available
  - Reference studies, reports, or official statements by name

✓ COMPLETE CLARITY
  - Write so readers have NO DOUBT what occurred
  - Explain cause and effect relationships
  - Address the "so what?" for each claim
  - Avoid ambiguity or incomplete information

✓ LENGTH & SUBSTANCE
  - Write 4-6 substantial paragraphs (400-600 words target)
  - Each paragraph develops a key idea with supporting details
  - Use specific examples over generic statements
  - Maintain journalistic tone (factual, never sensational)

✓ STRUCTURE
  - Opening paragraph: What happened (the facts, with key details)
  - Middle paragraphs: Context, background, broader implications
  - Closing paragraph: Why this matters and what comes next
  - Separate paragraphs with blank lines

OUTPUT ONLY THE ARTICLE BODY (no headline, no byline, no metadata).
The article source is {item['source_label']}. Attribution is implied in the database.

Source headline: {item['title']}
Source summary: {item['summary']}"""

    delay = RETRY_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model='llama-3.3-70b-versatile',
                messages=[{'role': 'user', 'content': prompt}],
                max_tokens=1000,  # Increased from 600 for longer articles
                temperature=0.3,   # Slightly lower for more factual consistency
                timeout=GROQ_TIMEOUT,
            )
            content = sanitize_text(response.choices[0].message.content)
            if len(content) < 200:  # Increased minimum from 100
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
    """Build a normalized story object with auto-fetched image."""
    # Get image with intelligent search strategy based on article category
    image_url = get_image_for_story(item['id'], item['title'], item['summary'], item['category'])
    
    return {
        'id':          item['id'],
        'title':       item['title'],
        'category':    item['category'],
        'author':      item['source_label'],
        'source':      item['source'],
        'time':        datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
        'read':        '3 min read',
        'image':       image_url,
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
    """Inject new stories into the flat structure and update all sections."""
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

    # Update featured sections with new categories
    featured = update_featured_stack(cat_index, data, new_stories)
    
    # Update breaking news
    data['breaking'] = select_breaking_news(stories, new_stories)
    
    # Update events
    existing_events = data.get('events', [])
    new_events = generate_events(stories, new_stories)
    data['events'] = new_events + existing_events[:2]  # Keep 2 oldest
    
    # Update most-read
    data['mostRead'] = update_most_read(data, new_stories)

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

# ── BREAKING NEWS & EVENTS ────────────────────────────────────────────────────

def select_breaking_news(stories_dict, new_stories):
    """Select most critical story for breaking news."""
    if not new_stories:
        return None
    
    # Prefer Politics or high-priority categories
    priority_cats = {'Politics', 'Breaking', 'Emergency', 'World'}
    
    for story in new_stories:
        if story['category'] in priority_cats:
            log.info(f"⚠️  Breaking: {story['title'][:60]}")
            return story['title'][:100]
    
    # Fall back to first story
    return new_stories[0]['title'][:100]

def generate_events(stories_dict, new_stories):
    """Generate events from notable stories."""
    events = []
    
    # Extract stories that mention dates, upcoming events, conferences
    event_keywords = {'conference', 'summit', 'event', 'meeting', 'announces', 'opens', 'launches', 'starts'}
    
    for story in new_stories[:3]:  # Check first 3 new stories
        title_lower = story['title'].lower()
        if any(kw in title_lower for kw in event_keywords):
            events.append({
                'title': story['title'][:80],
                'date': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
                'source': story.get('author', 'Verum News'),
            })
    
    log.info(f"📅 Generated {len(events)} events")
    return events

def update_most_read(stories_dict, new_stories):
    """Track most-read articles (updated by viewing)."""
    # Combine new stories with existing most-read, dedupe, take top 4
    most_read_titles = set()
    for story in new_stories[:2]:  # New stories get priority
        most_read_titles.add(story['title'][:80])
    
    # Keep some existing popular stories
    existing_most_read = stories_dict.get('mostRead', [])
    for title in existing_most_read[:2]:
        most_read_titles.add(title)
    
    result = list(most_read_titles)[:4]
    log.info(f"🔥 Updated most-read: {len(result)} stories tracked")
    return result

def update_featured_stack(cat_index, stories_dict, new_stories):
    """Intelligently update featured stack sections."""
    featured = stories_dict.get('featured', {})
    
    # Categorize new stories
    new_by_cat = {}
    for story in new_stories:
        cat = story['category']
        if cat not in new_by_cat:
            new_by_cat[cat] = []
        new_by_cat[cat].append(story['id'])
    
    # Populate world section if it has world stories
    if 'World' in new_by_cat and new_by_cat['World']:
        featured['world'] = new_by_cat['World'][:4] + featured.get('world', [])
        featured['world'] = featured['world'][:4]
        log.info(f"🌍 Updated world section: {len(featured['world'])} stories")
    
    return featured

# ── VALIDATION ────────────────────────────────────────────────────────────────

REQUIRED_STORY_FIELDS = ['id', 'title', 'time', 'image', 'content']

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

    required = ['id', 'title', 'time', 'image', 'content']
    invalid_count = 0
    for sid, story in stories.items():
         for field in required:
            if field not in story or not story[field]:
                issues.append(f"Story '{sid}' missing required field: '{field}'")
                invalid_count += 1
                break
         if not story.get('category') and not story.get('region'):
             issues.append(f"Story '{sid}' missing both 'category' and 'region'")
         if not story.get('author') and not story.get('source'):
             issues.append(f"Story '{sid}' missing both 'author' and 'source'")
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
