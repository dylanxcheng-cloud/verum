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
import collections
import time
import hashlib
import logging
import argparse
import feedparser
import requests
from datetime import datetime, timezone
from groq import Groq

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

try:
    from dotenv import load_dotenv
    # Load local env first (dev), then fall back to default .env.
    load_dotenv('.env.local')
    load_dotenv()
except ImportError:
    # python-dotenv is optional; in CI the vars come from the environment directly.
    pass

# ── ARGS ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument('--dry-run',   action='store_true', help='Fetch + rewrite but do not save or deploy')
parser.add_argument('--validate',  action='store_true', help='Validate stories.json only')
parser.add_argument('--check-feeds', action='store_true', help='Check feed health and exit (no processing)')
parser.add_argument('--synthesize', action='store_true',
                    help='Combine similar articles from multiple credible sources (EXPERIMENTAL, opt-in)')
parser.add_argument('--limit',     type=int, default=6,  help='Max new stories per run (default 6)')
parser.add_argument('--no-deploy', dest='deploy', action='store_false',
                    help='Save stories.json locally but do not deploy to Netlify')
parser.set_defaults(deploy=True)
# parse_known_args (not parse_args) so importing this module under a test
# runner — which injects its own argv — doesn't abort with "unrecognized
# arguments". Unknown args are ignored here; real CLI flags still parse.
ARGS, _UNKNOWN_ARGS = parser.parse_known_args()


# ── LOGGING ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger('verum')

# ── CONFIG ────────────────────────────────────────────────────────────────────

GROQ_API_KEY       = os.environ.get('GROQ_API_KEY')
GEMINI_API_KEY     = os.environ.get('GEMINI_API_KEY')  # free fallback LLM
# Groq model id. llama-3.3-70b-versatile was deprecated by Groq on 2026-06-17.
# openai/gpt-oss-20b is available on Groq's free tier; the larger
# openai/gpt-oss-120b needs a paid tier (it returns HTTP 404 on free keys).
# Override with GROQ_MODEL to switch models without touching code — confirm a
# model is enabled for your key first with:
#   curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
GROQ_MODEL         = os.environ.get('GROQ_MODEL') or 'openai/gpt-oss-20b'
NETLIFY_AUTH_TOKEN = os.environ.get('NETLIFY_AUTH_TOKEN')
NETLIFY_SITE_ID    = os.environ.get('NETLIFY_SITE_ID')
UNSPLASH_API_KEY   = os.environ.get('UNSPLASH_API_KEY')  # Optional
STORIES_FILE       = 'stories.json'
MAX_NEW_STORIES    = ARGS.limit

def _require_runtime_env():
    """Validate env needed for a real publish run.

    Called from main() rather than at import time, so the module can be
    imported (e.g. by the test suite) without NETLIFY/LLM env configured.
    """
    if not ARGS.check_feeds and not ARGS.dry_run:
        if ARGS.deploy and not NETLIFY_SITE_ID:
            log.error("NETLIFY_SITE_ID not set (or use --no-deploy to save locally without deploying)")
            sys.exit(1)
    if not GROQ_API_KEY and not GEMINI_API_KEY:
        log.error("No LLM key set (need GROQ_API_KEY or GEMINI_API_KEY). Falling back to RSS summaries.")

# Retry settings (optimized for efficiency)
MAX_RETRIES    = 2      # Reduced from 3 (fewer wasted attempts)
RETRY_DELAY    = 1      # Reduced from 2 (faster backoff, saves time)
GROQ_TIMEOUT   = 60     # Reduced from 90 (aggressive timeout)

# Long-form article settings (original depth with other efficiencies)
ARTICLE_MAX_TOKENS   = 4096   # ≈2400 words: 14-18 paragraphs, comprehensive depth
ARTICLE_MIN_CHARS    = 1200   # Realistic minimum for substantial body (vs 2000)
WORDS_PER_MINUTE     = 220    # for read-time estimation
IMAGE_SEARCH_LIMIT   = 3      # max Unsplash queries per article (vs 5)

# ── METRICS TRACKING ──────────────────────────────────────────────────────────
class Metrics:
    """Track performance and cost metrics across a run."""
    def __init__(self):
        self.start_time = time.time()
        self.groq_calls = 0
        self.gemini_calls = 0
        self.groq_tokens_estimated = 0
        self.articles_generated = 0
        self.articles_skipped = 0
        self.unsplash_calls = 0
        self.article_lengths = []
    
    def record_article(self, llm, tokens, content_length):
        """Record successful article generation."""
        if llm == 'groq':
            self.groq_calls += 1
            self.groq_tokens_estimated += tokens
        elif llm == 'gemini':
            self.gemini_calls += 1
        self.articles_generated += 1
        self.article_lengths.append(len(content_length.split()))
    
    def skip_article(self):
        self.articles_skipped += 1
    
    def record_unsplash(self):
        self.unsplash_calls += 1
    
    def report(self):
        """Print run summary with cost estimates."""
        elapsed = time.time() - self.start_time
        avg_length = sum(self.article_lengths) / len(self.article_lengths) if self.article_lengths else 0
        
        log.info("\n" + "="*70)
        log.info("RUN SUMMARY")
        log.info("="*70)
        log.info(f"Time elapsed: {elapsed:.1f}s")
        log.info(f"Articles generated: {self.articles_generated}")
        log.info(f"Articles skipped: {self.articles_skipped}")
        if self.article_lengths:
            log.info(f"Avg article length: {avg_length:.0f} words")
        log.info(f"LLM calls: {self.groq_calls} Groq, {self.gemini_calls} Gemini")
        if self.groq_tokens_estimated > 0:
            log.info(f"Groq tokens (est): {self.groq_tokens_estimated:,}")
            # Rough estimate: 1M tokens ≈ $0.02 on Groq
            estimated_cost = (self.groq_tokens_estimated / 1_000_000) * 0.02
            log.info(f"Groq cost (est): ${estimated_cost:.4f}")
        log.info(f"Unsplash API calls: {self.unsplash_calls} (50/hour limit)")
        log.info("="*70 + "\n")

metrics = Metrics()

# ── RSS FEEDS ─────────────────────────────────────────────────────────────────
#
# EXPANDED FEED LIST: High-quality, credible sources prioritizing depth & truth
# - Tier 1: Major news bureaus (Reuters, BBC, AP, Guardian, NPR)
# - Tier 2: Financial & specialized (Investopedia, ProPublica, Ars Technica)
# - Tier 3: Academic & verification (The Conversation, Nature, College journalism)
# - Tier 4: Sports & lifestyle (ESPN, Yahoo Sports, Axios)
#

FEEDS = [
    # ── TIER 1: ESTABLISHED NEWS BUREAUS (direct) ─────────────────────────────
    { 'url': 'https://feeds.bbci.co.uk/news/world/rss.xml',                   'source': 'bbc',           'source_label': 'BBC News',             'category': 'World'     },
    { 'url': 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'source': 'bbc',           'source_label': 'BBC News',             'category': 'Science'   },
    { 'url': 'https://feeds.bbci.co.uk/news/health/rss.xml',                  'source': 'bbc',           'source_label': 'BBC News',             'category': 'Health'    },
    { 'url': 'https://feeds.bbci.co.uk/news/politics/rss.xml',                'source': 'bbc',           'source_label': 'BBC News',             'category': 'Politics'  },
    { 'url': 'https://www.theguardian.com/world/rss',                         'source': 'guardian',      'source_label': 'The Guardian',         'category': 'World'     },
    { 'url': 'https://www.theguardian.com/politics/rss',                      'source': 'guardian',      'source_label': 'The Guardian',         'category': 'Politics'  },
    { 'url': 'https://www.theguardian.com/science/rss',                       'source': 'guardian',      'source_label': 'The Guardian',         'category': 'Science'   },
    { 'url': 'https://www.theguardian.com/society/rss',                       'source': 'guardian',      'source_label': 'The Guardian',         'category': 'Health'    },
    { 'url': 'https://feeds.npr.org/1001/rss.xml',                            'source': 'npr',           'source_label': 'NPR',                  'category': 'News'      },
    { 'url': 'https://feeds.npr.org/1007/rss.xml',                            'source': 'npr',           'source_label': 'NPR',                  'category': 'Science'   },
    { 'url': 'https://news.google.com/rss/search?q=when:24h+source:reuters&hl=en-US&gl=US&ceid=US:en',   'source': 'reuters', 'source_label': 'Reuters', 'category': 'World'    },
    { 'url': 'https://news.google.com/rss/search?q=when:24h+source:apnews&hl=en-US&gl=US&ceid=US:en',    'source': 'ap',      'source_label': 'AP News', 'category': 'News'     },

    # ── TIER 1b: GLOBAL / INTERNATIONAL ───────────────────────────────────────
    { 'url': 'https://www.aljazeera.com/xml/rss/all.xml',                     'source': 'aljazeera',     'source_label': 'Al Jazeera',           'category': 'World'     },
    { 'url': 'https://www.france24.com/en/rss',                               'source': 'france24',      'source_label': 'France 24',            'category': 'World'     },
    { 'url': 'https://www.japantimes.co.jp/feed/',                            'source': 'japantimes',    'source_label': 'The Japan Times',      'category': 'World'     },
    { 'url': 'https://www.bangkokpost.com/rss/data/topstories.xml',          'source': 'bangkokpost',   'source_label': 'Bangkok Post',         'category': 'World'     },
    { 'url': 'https://www.irishtimes.com/cmlink/news-1.1319192',             'source': 'irishtimes',    'source_label': 'The Irish Times',      'category': 'World'     },
    { 'url': 'https://news.google.com/rss/search?q=when:24h+source:channelnewsasia&hl=en-SG&gl=SG&ceid=SG:en', 'source': 'cna',         'source_label': 'CNA (Singapore)',          'category': 'World'  },
    { 'url': 'https://news.google.com/rss/search?q=when:24h+source:straitstimes&hl=en-SG&gl=SG&ceid=SG:en',    'source': 'straitstimes','source_label': 'The Straits Times',        'category': 'World'  },
    { 'url': 'https://news.google.com/rss/search?q=when:24h+source:abc.net.au&hl=en-AU&gl=AU&ceid=AU:en',      'source': 'abcau',       'source_label': 'ABC News (Australia)',     'category': 'World'  },
    { 'url': 'https://news.google.com/rss/search?q=when:24h+source:smh&hl=en-AU&gl=AU&ceid=AU:en',             'source': 'smh',         'source_label': 'Sydney Morning Herald',    'category': 'World'  },

    # ── TIER 2: BROAD TOPIC AGGREGATION ───────────────────────────────────────
    { 'url': 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en', 'source': 'googlenews', 'source_label': 'Google News', 'category': 'Business' },
    { 'url': 'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=en-US&gl=US&ceid=US:en',   'source': 'googlenews', 'source_label': 'Google News', 'category': 'Health'   },
    { 'url': 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en',   'source': 'googlenews', 'source_label': 'Google News', 'category': 'Sports'   },

    # ── TIER 3: ACADEMIC, VERIFICATION, FACT-CHECKING ─────────────────────────
    { 'url': 'https://theconversation.com/us/articles.atom',                  'source': 'conversation',  'source_label': 'The Conversation',     'category': 'Science'   },
    { 'url': 'https://www.nature.com/nature/current_issue/rss',               'source': 'nature',        'source_label': 'Nature',               'category': 'Science'   },
    { 'url': 'https://www.snopes.com/feed/',                                  'source': 'snopes',        'source_label': 'Snopes',               'category': 'News'      },
    { 'url': 'https://fullfact.org/feed/',                                    'source': 'fullfact',      'source_label': 'Full Fact',            'category': 'News'      },

    # ── TIER 1c: LOW-BIAS WIRE SERVICES & PUBLIC BROADCASTERS ─────────────────
    #   Wire services and public/independent broadcasters rate highest for
    #   factual reporting and lowest for partisan bias — added for balance.
    { 'url': 'https://news.google.com/rss/search?q=when:24h+source:Agence+France-Presse&hl=en-US&gl=US&ceid=US:en', 'source': 'afp',       'source_label': 'AFP',                  'category': 'World'     },
    { 'url': 'https://www.pbs.org/newshour/feeds/rss/headlines',              'source': 'pbs',           'source_label': 'PBS NewsHour',         'category': 'News'      },
    { 'url': 'https://rss.csmonitor.com/feeds/all',                           'source': 'csmonitor',     'source_label': 'Christian Science Monitor', 'category': 'World' },
    { 'url': 'https://rss.dw.com/rdf/rss-en-all',                             'source': 'dw',            'source_label': 'Deutsche Welle',       'category': 'World'     },
    { 'url': 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',                   'source': 'marketwatch',   'source_label': 'MarketWatch',          'category': 'Business'  },
    { 'url': 'https://www.economist.com/international/rss.xml',               'source': 'economist',     'source_label': 'The Economist',        'category': 'World'     },
    { 'url': 'https://apnews.com/hub/ap-top-news/rss',                        'source': 'ap',            'source_label': 'AP News',              'category': 'News'      },

    # ── TIER 4: SPORTS, JOURNALISM, INSTITUTIONAL ─────────────────────────────
    { 'url': 'https://www.espn.com/espn/rss/news',                            'source': 'espn',          'source_label': 'ESPN',                 'category': 'Sports'    },
    { 'url': 'https://www.cjr.org/feed',                                      'source': 'cjr',           'source_label': 'Columbia Journalism Review', 'category': 'News' },
    { 'url': 'https://news.berkeley.edu/feed/',                               'source': 'berkeleyuniv',  'source_label': 'UC Berkeley News',     'category': 'Science'   },
    { 'url': 'https://www.nasa.gov/rss/dyn/breaking_news.rss',                'source': 'nasa',          'source_label': 'NASA',                 'category': 'Science'   },
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
def extract_keywords(text, max_keywords=6):
    """Extract image-search keywords, prioritizing named entities."""
    if not text:
        return []

    stop_words = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'must', 'says', 'said', 'say', 'new',
        'as', 'this', 'that', 'these', 'those', 'which', 'who', 'what', 'when',
        'where', 'why', 'how', 'all', 'each', 'every', 'both', 'any', 'some',
        'after', 'before', 'over', 'into', 'amid', 'than', 'then', 'about',
        'his', 'her', 'its', 'their', 'they', 'them', 'first', 'more', 'most',
        'report', 'reports', 'reported', 'plan', 'plans', 'use', 'used',
    }

    raw_words = re.findall(r"[A-Za-z][A-Za-z'-]+", text)
    keywords = []
    phrase = []
    for w in raw_words:
        if w[0].isupper() and w.lower() not in stop_words:
            phrase.append(w)
        else:
            if len(phrase) >= 2:
                keywords.append(' '.join(phrase))
            phrase = []
    if len(phrase) >= 2:
        keywords.append(' '.join(phrase))

    proper = [w for w in raw_words
              if w[0].isupper() and len(w) > 2 and w.lower() not in stop_words]
    for w in proper:
        if w not in ' '.join(keywords) and w.lower() not in [k.lower() for k in keywords]:
            keywords.append(w)

    significant = [w.lower() for w in raw_words
                   if len(w) > 4 and w.lower() not in stop_words and not w[0].isupper()]
    for w in significant:
        if w not in [k.lower() for k in keywords]:
            keywords.append(w)

    return keywords[:max_keywords]

CATEGORY_QUERIES = {
    'science':    ['scientific research', 'laboratory'],
    'politics':   ['government building', 'political rally'],
    'business':   ['stock market', 'financial district'],
    'finance':    ['stock market', 'financial district'],
    'sports':     ['stadium crowd', 'athlete competition'],
    'health':     ['hospital medical', 'healthcare'],
    'world':      ['city skyline', 'international flags'],
    'technology': ['technology computer', 'data center'],
    'news':       ['newsroom journalism', 'city street'],
}

def construct_search_queries(title, summary, category):
    """
    Build Unsplash queries in two tiers:
      - specific: entity phrases -> proper nouns -> thematic keyword
      - fallback: category queries that reliably return strong imagery
    Returned separately so the searcher always tries the reliable fallbacks
    even after the specific budget is spent.
    """
    title_kw = extract_keywords(title, max_keywords=5)
    summary_kw = extract_keywords(summary, max_keywords=4)

    specific = []
    specific += [k for k in title_kw if ' ' in k]
    specific += [k for k in summary_kw if ' ' in k][:1]
    specific += [k for k in title_kw if ' ' not in k and k[:1].isupper()][:2]
    specific += [k for k in summary_kw if ' ' not in k and k[:1].isupper()][:1]
    specific += [k for k in title_kw if ' ' not in k and not k[:1].isupper()][:1]

    fallback = list(CATEGORY_QUERIES.get(category.lower(), CATEGORY_QUERIES['news']))
    for q in CATEGORY_QUERIES['news']:
        if q not in fallback:
            fallback.append(q)

    seen, spec_u = set(), []
    for q in specific:
        ql = q.lower().strip()
        if ql and ql not in seen:
            seen.add(ql); spec_u.append(q.strip())
    fb_u = []
    for q in fallback:
        ql = q.lower().strip()
        if ql and ql not in seen:
            seen.add(ql); fb_u.append(q.strip())

    return spec_u, fb_u
def fetch_image_from_unsplash(search_query, per_page=5):
    """
    Search Unsplash for an image matching the query.
    Uses /search/photos (not /photos/random): returns ranked results and an
    empty list instead of a 404 when nothing matches, so it degrades gracefully.
    """
    if not UNSPLASH_API_KEY or not search_query:
        return None

    try:
        url = 'https://api.unsplash.com/search/photos'
        headers = {
            'Authorization': f'Client-ID {UNSPLASH_API_KEY}',
            'Accept-Version': 'v1',
        }
        params = {
            'query': search_query,
            'orientation': 'landscape',
            'per_page': per_page,
            'content_filter': 'high',
            'order_by': 'relevant',
        }
        res = requests.get(url, headers=headers, params=params, timeout=10)
        metrics.record_unsplash()
        if res.status_code != 200:
            log.debug(f"Unsplash HTTP {res.status_code} for '{search_query}'")
            return None
        results = res.json().get('results', [])
        if not results:
            log.debug(f"Unsplash: no results for '{search_query}'")
            return None
        urls = results[0].get('urls', {})
        return urls.get('regular') or urls.get('full') or urls.get('raw')
    except Exception as e:
        log.debug(f"Unsplash fetch failed for '{search_query}': {e}")
    return None
def generate_placeholder_url(story_id, title):
    """Deterministic, self-contained SVG placeholder image (returned as a data URI).

    Replaces the former external placeholder service: builds a dark, on-theme
    abstract gradient keyed to the story, so every story gets a consistent,
    unique placeholder with no third-party image dependency. Mirrors the
    front-end generatePlaceholderImageUrl (same seed + hashing) so the
    server-side and client-side fallbacks resolve to the SAME image.
    """
    from urllib.parse import quote
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
    return "data:image/svg+xml," + quote(svg, safe='')

_IMAGE_EXT_RE = re.compile(r'\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)', re.I)


def _looks_like_image(url):
    """Heuristic: is this URL a usable article image (not a tracker/spacer)?"""
    if not url or not url.startswith(('http://', 'https://')):
        return False
    low = url.lower()
    if any(bad in low for bad in ('1x1', 'spacer', 'pixel.gif', 'blank.gif', 'doubleclick')):
        return False
    return bool(_IMAGE_EXT_RE.search(url)) or 'image' in low or '/img' in low or '/media/' in low


def extract_feed_image(entry):
    """Pull an image the RSS entry ALREADY carries — no extra network call.

    Checks media:content, media:thumbnail, enclosures, enclosure links, then the
    first <img> in the summary/content HTML. Most mainstream feeds (BBC, Guardian,
    NPR, Al Jazeera, NASA…) ship a real photo in one of these, so this alone gives
    most stories a topic-exact image for free.
    """
    for key in ('media_content', 'media_thumbnail'):
        for m in entry.get(key, []) or []:
            url = m.get('url') or m.get('href')
            if _looks_like_image(url):
                return url
    for enc in entry.get('enclosures', []) or []:
        url = enc.get('href') or enc.get('url')
        if url and ('image' in (enc.get('type') or '') or _looks_like_image(url)):
            return url
    for lnk in entry.get('links', []) or []:
        if lnk.get('rel') == 'enclosure' and 'image' in (lnk.get('type') or '') and lnk.get('href'):
            return lnk['href']
    html = entry.get('summary') or ''
    if not html:
        cont = entry.get('content') or []
        if cont:
            html = cont[0].get('value', '')
    m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html or '', re.I)
    if m and _looks_like_image(m.group(1)):
        return m.group(1)
    return None


def fetch_og_image(url):
    """Best-effort: fetch the article page and read its og:image / twitter:image.

    One network call, fully guarded — returns None if offline or on any error, so
    it degrades to Unsplash/placeholder without breaking the run.
    """
    if not url or not url.startswith(('http://', 'https://')):
        return None
    try:
        res = requests.get(url, headers=FEED_HEADERS, timeout=10)
        if res.status_code != 200:
            return None
        html = res.text[:250000]
    except Exception as e:  # noqa: BLE001 — offline / bad URL is fine
        log.debug(f"og:image fetch failed for {url}: {e}")
        return None
    for prop in ('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'):
        esc = re.escape(prop)
        m = re.search(r'<meta[^>]+(?:property|name)=["\']' + esc + r'["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
        if not m:
            m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + esc + r'["\']', html, re.I)
        if m and m.group(1).startswith('http'):
            return m.group(1)
    return None


# Words that make bad Wikipedia lookups (too generic → wrong/disambiguation page).
_WIKI_SKIP = {
    'news', 'update', 'live', 'video', 'photos', 'opinion', 'analysis', 'report',
    'world', 'business', 'politics', 'health', 'science', 'sports', 'week', 'day',
    'government', 'president', 'minister', 'police', 'court', 'study', 'people',
}


def _wiki_entity_candidates(title, summary):
    """Ordered Wikipedia page-title guesses from a story's named entities.

    Multi-word proper phrases first (e.g. 'European Union', 'Taylor Swift'),
    then standalone capitalized proper nouns. These map most reliably to a real
    Wikipedia article with a lead image.
    """
    kws = extract_keywords(title, max_keywords=6) + extract_keywords(summary, max_keywords=4)
    phrases, singles, seen = [], [], set()
    for k in kws:
        kl = k.lower().strip()
        if not kl or kl in seen or kl in _WIKI_SKIP:
            continue
        seen.add(kl)
        if ' ' in k:
            phrases.append(k.strip())
        elif k[:1].isupper() and len(k) > 3:
            singles.append(k.strip())
    return phrases + singles


def fetch_wikipedia_image(title, summary):
    """Keyless topic image: the lead photo of the story's main entity on Wikipedia.

    Uses the public REST summary endpoint (no API key). Skips disambiguation
    pages and only returns a genuine article image, so it stays topic-relevant.
    Fully guarded — returns None on any error so the chain falls through to the
    placeholder. This is what gives most stories a real image WITHOUT an
    Unsplash key.
    """
    from urllib.parse import quote
    for entity in _wiki_entity_candidates(title, summary)[:4]:
        slug = quote(entity.replace(' ', '_'), safe='')
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"
        try:
            res = requests.get(url, headers=FEED_HEADERS, timeout=10)
            if res.status_code != 200:
                continue
            data = res.json()
        except Exception as e:  # noqa: BLE001 — offline / bad title is fine
            log.debug(f"Wikipedia lookup failed for '{entity}': {e}")
            continue
        # Skip disambiguation / non-article results — they have no real subject.
        if data.get('type') not in (None, 'standard'):
            continue
        img = (data.get('originalimage') or {}).get('source') \
            or (data.get('thumbnail') or {}).get('source')
        if img and _looks_like_image(img):
            return img, entity
    return None, None


def get_image_for_story(item):
    """Find the best REAL image for a story, best quality first:

      1. the image the RSS feed already carries  (topic-exact, no network)
      2. the article page's own og:image          (one network fetch)
      3. the main entity's Wikipedia lead photo    (keyless, topic-relevant)
      4. an Unsplash keyword match                (needs UNSPLASH_API_KEY)
      5. a generated SVG placeholder              (last resort only)
    """
    story_id, title = item['id'], item['title']
    summary = item.get('summary', '')

    feed_img = item.get('feed_image')
    if feed_img and _looks_like_image(feed_img):
        log.info("  → Image: from RSS feed")
        return feed_img

    og = fetch_og_image(item.get('original_url'))
    if og:
        log.info("  → Image: article og:image")
        return og

    wiki_img, entity = fetch_wikipedia_image(title, summary)
    if wiki_img:
        log.info(f"  → Image: Wikipedia ('{entity}')")
        return wiki_img

    specific, fallback = construct_search_queries(title, summary, item.get('category', 'news'))
    for query in specific[:IMAGE_SEARCH_LIMIT] + fallback:
        img_url = fetch_image_from_unsplash(query, per_page=5)
        if img_url:
            log.info(f"  → Image: Unsplash ('{query}')")
            return img_url

    log.warning("  → Image: SVG placeholder (no feed / og:image / Wikipedia / Unsplash result)")
    return generate_placeholder_url(story_id, title)
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
FEED_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
}

def fetch_feed_with_retry(feed_config):
    """Fetch a single RSS feed with a real browser User-Agent, then parse."""
    url = feed_config['url']
    delay = RETRY_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            res = requests.get(url, headers=FEED_HEADERS, timeout=15)
            if res.status_code != 200:
                raise ValueError(f"HTTP {res.status_code}")
            feed = feedparser.parse(res.content)
            if feed.bozo and not feed.entries:
                raise ValueError(f"Malformed feed: {feed.bozo_exception}")
            if not feed.entries:
                raise ValueError("No entries")
            return feed
        except Exception as e:
            if attempt == MAX_RETRIES:
                log.warning(f"Failed to fetch {url} after {MAX_RETRIES} attempts: {e}")
                return None
            log.debug(f"Retry {attempt}/{MAX_RETRIES} for {url}: {e}")
            time.sleep(delay)
            delay *= 2
    return None

def check_feed_health():
    """Check which feeds are accessible and exit with report."""
    log.info("Checking feed health...\n")
    results = []
    
    for feed_config in FEEDS:
        label = feed_config['source_label']
        url = feed_config['url']
        
        try:
            res = requests.get(url, headers=FEED_HEADERS, timeout=10)
            if res.status_code == 200:
                feed = feedparser.parse(res.content)
                if feed.entries:
                    status = f"✅ OK ({len(feed.entries)} entries)"
                else:
                    status = f"⚠️  Empty (HTTP 200 but no entries)"
            else:
                status = f"❌ HTTP {res.status_code}"
        except Exception as e:
            status = f"❌ {str(e)[:40]}"
        
        results.append((label, status))
    
    # Print formatted results
    max_len = max(len(r[0]) for r in results)
    for label, status in sorted(results):
        print(f"  {label:<{max_len}} {status}")
    
    ok = sum(1 for _, s in results if s.startswith('✅'))
    total = len(results)
    print(f"\n{ok}/{total} feeds healthy")
    sys.exit(0)

# ── MAIN PROCESSING ──────────────────────────────────────────────────────────

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
        for entry in feed.entries[:2]:  # Reduced from [:3] to [:2] per feed for efficiency
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
                'feed_image':  extract_feed_image(entry),   # real photo from the feed, if any
            }
            if is_valid_item(item):
                items.append(item)
                stats['items_valid'] += 1

    log.info(f"RSS stats: {stats['feeds_ok']} feeds OK, {stats['feeds_failed']} failed, "
             f"{stats['items_valid']}/{stats['items_raw']} items valid")
    return items

# ── LLM REWRITE WITH FALLBACK ─────────────────────────────────────────────────

def _single_source_prompt(item):
    """Build the (detailed) single-source rewrite prompt.

    Shared by the Groq and Gemini paths so both stay in sync. The prompt gives
    the model a clear structure, a strict sourcing/anti-fabrication contract,
    and formatting rules — designed to produce depth without inventing facts.
    """
    return f"""You are a senior staff writer for Verum, a serious news publication whose mission is "The truth for all": accurate, thorough, well-sourced journalism with no sensationalism and no filler.

TASK
Turn the single news item at the bottom into a complete, in-depth news article a well-informed reader would trust.

SOURCING & ACCURACY (this is the most important section)
  - Every concrete claim — a fact, figure, date, name, event, or attributed statement — must be supported by the source material below. Put the footnote marker [1] immediately after each such claim.
  - NEVER invent facts. Do not fabricate statistics, quotations, dates, names, locations, or events that are not in the source. If an important detail is not provided, say so plainly (e.g. "the available reporting does not specify…") instead of guessing.
  - You MAY add widely-known, uncontroversial background to orient the reader — how an institution or process works, what a technical term means, well-established prior history. Frame it clearly as general context and do NOT attach [1] to it (it is not from the source).
  - Do not fabricate direct quotes. Paraphrase what the source reports rather than inventing wording in quotation marks.

STRUCTURE (use only the parts the source can actually support)
  1. Lede — one paragraph on the single most important development, in plain language.
  2. Nut graf — one paragraph on why it matters and to whom.
  3. What happened — 2–4 paragraphs of verifiable specifics: who, what, when, where, and any figures.
  4. Background & context — 2–4 paragraphs of history and mechanism: how we got here, how the system/institution works.
  5. Stakeholders & impact — 2–3 paragraphs on who is affected and how, and any competing interests.
  6. Implications — 1–2 paragraphs of reasonable, source-grounded analysis, clearly framed as analysis rather than fact.
  7. What to watch next — one paragraph on concrete upcoming steps, deadlines, or open questions.

DEPTH & STYLE
  - Aim for a thorough article of roughly 12–18 paragraphs WHERE THE MATERIAL SUPPORTS IT. If the source is thin, write a shorter, honest piece rather than padding it with invented detail.
  - One clear idea per paragraph, developed with specifics. Prefer concrete nouns and active voice.
  - Measured, neutral tone. No hype, no clichés ("in a stunning turn of events"), no editorializing, no second person ("you").

FORMATTING
  - Plain prose only, paragraphs separated by a single blank line.
  - Use the [1] marker inline as described. Do NOT name the source in prose. Do NOT add a headline, a byline, or a References/Sources list — those are added automatically.

OUTPUT: the article body only.

Source headline: {item['title']}
Source summary: {item['summary']}"""


def rewrite_with_gemini(item):
    """
    Rewrite an RSS item as a long-form Verum article using Google Gemini.
    Fallback when Groq is unavailable or times out.
    Returns (content, sources) where sources is a list of {n, label, url} dicts.
    """
    if not GEMINI_API_KEY or not GEMINI_AVAILABLE:
        return None, []
    
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel('gemini-2.0-flash')
    except Exception as e:
        log.debug(f"Gemini initialization failed: {e}")
        return None, []

    sources = [{
        'n': 1,
        'label': item['source_label'],
        'url': item.get('original_url', ''),
    }]

    prompt = _single_source_prompt(item)

    delay = RETRY_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=ARTICLE_MAX_TOKENS,
                    temperature=0.3,
                )
            )
            content = sanitize_text(response.text)
            if len(content) < ARTICLE_MIN_CHARS:
                raise ValueError(f"Response too short ({len(content)} chars)")
            log.info(f"  → Rewritten with Gemini (fallback)")
            return content, sources
        except Exception as e:
            if attempt == MAX_RETRIES:
                log.debug(f"Gemini failed after {MAX_RETRIES} attempts: {e}")
                return None, []
            log.debug(f"Gemini retry {attempt}/{MAX_RETRIES}: {e}")
            time.sleep(delay)
            delay *= 2
    return None, []

def probe_groq_model():
    """
    Startup diagnostic: log which Groq model is selected and whether a real
    call to it succeeds. Purely informational — never raises, never aborts the
    run. A 404 here means GROQ_MODEL is not enabled for this key, so the
    pipeline will fall back to Gemini/RSS summaries; the log says so plainly.
    """
    if not GROQ_API_KEY:
        log.warning(f"Groq: no GROQ_API_KEY set — skipping LLM, using Gemini/RSS fallback. "
                    f"(would have used model '{GROQ_MODEL}')")
        return
    log.info(f"Groq: selected model '{GROQ_MODEL}' (override with GROQ_MODEL env/repo var)")
    try:
        client = Groq(api_key=GROQ_API_KEY)
        client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{'role': 'user', 'content': 'ping'}],
            max_tokens=1,
            timeout=30,
        )
        log.info(f"Groq: model '{GROQ_MODEL}' is reachable and working ✓")
    except Exception as e:
        msg = str(e)
        if '404' in msg or 'not found' in msg.lower() or 'does not exist' in msg.lower():
            log.error(f"Groq: model '{GROQ_MODEL}' is NOT available for this key (404). "
                      f"Set the GROQ_MODEL repo variable to a model your key allows "
                      f"(list them: curl https://api.groq.com/openai/v1/models "
                      f"-H \"Authorization: Bearer $GROQ_API_KEY\"). "
                      f"Continuing with Gemini/RSS fallback.")
        elif 'invalid_api_key' in msg or '401' in msg:
            log.error(f"Groq: API key rejected (invalid_api_key). Check the GROQ_API_KEY "
                      f"secret. Continuing with Gemini/RSS fallback.")
        else:
            log.error(f"Groq: probe call failed ({msg[:200]}). "
                      f"Continuing; per-article retries still apply.")


def rewrite_with_groq(item):
    """
    Rewrite an RSS item as a long-form Verum article with retry/backoff.
    Returns (content, sources) where sources is a list of {n, label, url} dicts
    referenced by [n] footnote markers in the body.
    """
    if not GROQ_API_KEY:
        log.error("GROQ_API_KEY not set")
        return None, []

    client = Groq(api_key=GROQ_API_KEY)

    # This single-source article still uses footnotes so the body format is
    # identical to synthesized pieces (one reference: the originating source).
    sources = [{
        'n': 1,
        'label': item['source_label'],
        'url': item.get('original_url', ''),
    }]

    prompt = _single_source_prompt(item)

    delay = RETRY_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{'role': 'user', 'content': prompt}],
                max_tokens=ARTICLE_MAX_TOKENS,
                temperature=0.3,  # Reduced from 0.4 for faster, more consistent responses
                timeout=GROQ_TIMEOUT,
            )
            content = sanitize_text(response.choices[0].message.content)
            if len(content) < ARTICLE_MIN_CHARS:
                raise ValueError(f"Response too short ({len(content)} chars)")
            log.info(f"  → Rewritten with Groq")
            return content, sources
        except Exception as e:
            if attempt == MAX_RETRIES:
                log.debug(f"Groq failed for '{item['title'][:50]}' after {MAX_RETRIES} attempts: {e}")
                return None, []
            log.debug(f"Groq retry {attempt}/{MAX_RETRIES}: {e}")
            time.sleep(delay)
            delay *= 2
    return None, []

def rewrite_article(item):
    """
    Rewrite an article with intelligent LLM fallback chain:
    1. Try Groq (primary, efficient)
    2. Fall back to Gemini (free tier, reliable)
    3. Return None if both fail
    """
    if GROQ_API_KEY:
        content, sources = rewrite_with_groq(item)
        if content:
            return content, sources
        log.debug(f"Groq unavailable, trying Gemini...")
    
    if GEMINI_API_KEY and GEMINI_AVAILABLE:
        content, sources = rewrite_with_gemini(item)
        if content:
            return content, sources
    
    log.warning(f"No LLM available for '{item['title'][:50]}'; using RSS summary")
    return None, []

# ── ARTICLE SYNTHESIS FROM MULTIPLE SOURCES ──────────────────────────────────

def similarity_score(title1, title2):
    """
    Simple similarity check: count matching words.
    Returns 0-1 score (higher = more similar).
    """
    words1 = set(w.lower() for w in title1.split() if len(w) > 3)
    words2 = set(w.lower() for w in title2.split() if len(w) > 3)
    if not words1 or not words2:
        return 0
    intersection = len(words1 & words2)
    union = len(words1 | words2)
    return intersection / union if union > 0 else 0

def find_similar_articles(items, threshold=0.4):
    """
    Group articles by topic similarity.
    Returns list of groups, where each group contains 1-3 related articles.
    Groups are sorted by source credibility (Tier 1 > Tier 2 > Tier 3 > Tier 4).
    """
    source_tiers = {
    	'bbc': 1, 'reuters': 1, 'ap': 1, 'guardian': 1, 'npr': 1,
        'aljazeera': 1, 'france24': 1, 'japantimes': 1, 'bangkokpost': 1, 'irishtimes': 1,
        'cna': 1, 'straitstimes': 1, 'abcau': 1, 'smh': 1,
        'investopedia': 2, 'propublica': 2, 'arstechnica': 2, 'axios': 2, 'vox': 2, 'politico': 2, 'atlantic': 2, 'wired': 2, 'googlenews': 2,
        'conversation': 3, 'nature': 3, 'science': 3, 'aip': 3, 'snopes': 3, 'fullfact': 3,
        'espn': 4, 'yahsports': 4, 'cjr': 4, 'columbiauniv': 4, 'yaleuniv': 4, 'mituniv': 4, 'stanforduniv': 4, 'berkeleyuniv': 4, 'nasa': 4, 'bls': 4,
    }    
    grouped = []
    used = set()
    
    for i, item1 in enumerate(items):
        if i in used:
            continue
        
        group = [item1]
        used.add(i)
        
        # Find similar items from higher credibility sources
        for j, item2 in enumerate(items[i+1:], start=i+1):
            if j in used:
                continue
            
            score = similarity_score(item1['title'], item2['title'])
            if score >= threshold:
                tier1 = source_tiers.get(item1['source'], 5)
                tier2 = source_tiers.get(item2['source'], 5)
                
                # Only add if equal or better credibility
                if tier2 <= tier1:
                    group.append(item2)
                    used.add(j)
                    if len(group) >= 3:  # Max 3 sources per synthesis
                        break
        
        grouped.append(group)
    
    return grouped

def rewrite_synthesized_articles(items):
    """
    Synthesize 2-3 articles from different credible sources into one long-form
    article with footnote-style attribution.
    Returns (content, sources) where sources is a list of {n, label, url} dicts.
    """
    if not GROQ_API_KEY or not items or len(items) < 2:
        return None, []

    client = Groq(api_key=GROQ_API_KEY)

    group = items[:3]
    sources = [{
        'n': i + 1,
        'label': it['source_label'],
        'url': it.get('original_url', ''),
    } for i, it in enumerate(group)]

    # Each source is numbered so the model can cite it as [1], [2], [3].
    sources_text = '\n'.join([
        f"  [{i+1}] {it['source_label']}\n      Title: {it['title']}\n      Summary: {it['summary'][:400]}"
        for i, it in enumerate(group)
    ])

    prompt = f"""You are a senior investigative writer for Verum, synthesizing reporting from {len(group)} independent, credible sources into ONE authoritative article. Verum's mission is "The truth for all": accurate, thorough, non-sensational journalism.

SOURCING, CORROBORATION & ACCURACY (the most important section)
  - Cite every concrete claim with the numbered marker(s) of the source(s) that support it: [1], [2], [3]. When several sources confirm the same point, cite them together, e.g. [1][2].
  - Cross-check the sources. When they AGREE, state the fact once and cite all of them — corroborated facts are your backbone. When they DISAGREE (different figures, timelines, or accounts), present each version, attribute it with its marker, and explicitly note the discrepancy; do not silently pick one.
  - NEVER invent facts, figures, quotes, or events beyond what the sources provide. If the sources leave something unknown, say so rather than filling the gap.
  - You MAY add widely-known, uncontroversial background (uncited) to orient the reader; frame it clearly as context, not as new reporting. Do not fabricate direct quotes.

STRUCTURE (use only what the sources support)
  1. Lede — the single most important, best-corroborated development.
  2. Nut graf — why it matters and to whom.
  3. What happened — verifiable specifics drawn across the sources: who, what, when, where, figures.
  4. Background & context — history and mechanism.
  5. Stakeholders & impact — who is affected and how; competing interests.
  6. Where the sources diverge — surface any conflicts or open questions between them.
  7. Implications & what to watch next — reasonable, source-grounded analysis and concrete next steps.

DEPTH & STYLE
  - Aim for a thorough piece of roughly 12–18 paragraphs where the combined material supports it; do not pad beyond what the sources justify.
  - One clear idea per paragraph, developed with specifics. Concrete nouns, active voice, measured neutral tone, no clichés, no editorializing, no second person.

FORMATTING
  - Plain prose, paragraphs separated by a single blank line.
  - Use the [n] markers inline as described. Do NOT name sources in prose (no "Reuters reports"), do NOT add a headline or byline, and do NOT append a References/Sources list — it is added automatically.

OUTPUT: the article body only.

SOURCES (cite by these numbers):
{sources_text}"""

    delay = RETRY_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{'role': 'user', 'content': prompt}],
                max_tokens=ARTICLE_MAX_TOKENS,
                temperature=0.3,
                timeout=GROQ_TIMEOUT,
            )
            content = sanitize_text(response.choices[0].message.content)
            if len(content) < ARTICLE_MIN_CHARS:
                raise ValueError(f"Synthesized response too short ({len(content)} chars)")
            log.info(f"  → Synthesized {len(group)} sources with Groq")
            return content, sources
        except Exception as e:
            if attempt == MAX_RETRIES:
                log.debug(f"Synthesis failed after {MAX_RETRIES} attempts: {e}")
                return None, []
            log.debug(f"Synthesis retry {attempt}/{MAX_RETRIES}: {e}")
            time.sleep(delay)
            delay *= 2
    return None, []

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

def choose_article_mode(story, source_count=1):
    """Pick article depth from how much source material is available.

    Returns 'long' when the input is rich enough to sustain an in-depth piece
    (a detailed title/summary, or multiple corroborating sources), otherwise
    'compact'. Keeps thin wire items from being padded into long articles.
    """
    title = (story.get('title') or '').strip()
    summary = (story.get('summary') or '').strip()
    detail_chars = len(title) + len(summary)
    detail_words = len(f"{title} {summary}".split())
    if source_count >= 2 or detail_chars >= 300 or detail_words >= 45:
        return 'long'
    return 'compact'


def deduplicate_paragraphs(text):
    """Drop repeated paragraphs from generated copy, preserving first-seen order.

    LLM output (especially synthesized multi-source pieces) occasionally repeats
    a paragraph verbatim; this collapses those to a single occurrence while
    keeping the surrounding narrative order intact.
    """
    if not text:
        return text
    seen, out = set(), []
    for para in re.split(r'\n{2,}', text):
        stripped = para.strip()
        key = ' '.join(stripped.split()).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(stripped)
    return '\n\n'.join(out)


def estimate_read_time(content):
    """Estimate read time in minutes from word count."""
    words = len(content.split())
    minutes = max(1, round(words / WORDS_PER_MINUTE))
    return f"{minutes} min read"

def build_story_object(item, content, sources=None):
    """Build a normalized story object with auto-fetched image.

    Note: no 'author' field — Verum articles are attributed via the `sources`
    footnote list and inline [n] markers, not a byline.
    """
    # Collapse any accidental duplicate paragraphs from the model output.
    content = deduplicate_paragraphs(content)

    # Get image with intelligent search strategy based on article category
    image_url = get_image_for_story(item)

    return {
        'id':          item['id'],
        'title':       item['title'],
        'category':    item['category'],
        'source':      item['source'],
        'time':        datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
        'read':        estimate_read_time(content),
        'mode':        choose_article_mode(item, source_count=len(sources) if sources else 1),
        'image':       image_url,
        'content':     content,
        'sources':     sources or [],
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

    # Freshen the hero stack: surface the newest stories (plus the just-demoted
    # hero and other recent items) beside the hero, so the three slots next to
    # the big article actually rotate every run instead of going stale.
    hero_id = featured.get('hero')
    fresh = [s['id'] for s in new_stories if s['id'] != hero_id]
    pool = fresh + list(featured.get('latest', [])) + list(featured.get('stack', []))
    merged, seen = [], set()
    for sid in pool:
        if sid and sid != hero_id and sid not in seen:
            merged.append(sid)
            seen.add(sid)
    if merged:
        featured['stack'] = merged[:3]
        log.info(f"🗞️  Updated hero stack: {len(featured['stack'])} stories")

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
         if not story.get('source') and not story.get('author'):
             issues.append(f"Story '{sid}' missing 'source'")
    is_valid = len(issues) == 0
    report = {
        'total_stories': len(stories),
        'errors':        issues,
        'warnings':      warnings,
        'valid':         is_valid,
    }
    return is_valid, report

# ── NETLIFY DEPLOY ────────────────────────────────────────────────────────────

def deploy_to_netlify(data, remote_name='stories.json'):
    """Trigger Netlify redeploy by pushing an updated JSON file.

    `remote_name` is the path served from the site root (e.g. 'stories.json' or
    'recordationem.json'), so the Recordationem payload reaches production the
    same way the main story feed does.
    """
    if not NETLIFY_AUTH_TOKEN:
        log.error("NETLIFY_AUTH_TOKEN not set — skipping deploy")
        return False

    log.info(f"Deploying {remote_name} to Netlify...")
    headers = { 'Authorization': f'Bearer {NETLIFY_AUTH_TOKEN}' }

    # Try file upload API first
    upload_url = f'https://api.netlify.com/api/v1/sites/{NETLIFY_SITE_ID}/files/{remote_name}'
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
                log.info(f"✅ {remote_name} deployed to Netlify")
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

def _classify_image(url):
    """Bucket a story image URL by where it came from, for the run summary."""
    u = (url or '').lower()
    if not u or u.startswith('data:'):
        return 'placeholder'
    if 'wikipedia.org' in u or 'wikimedia.org' in u:
        return 'wikipedia'
    if 'unsplash.' in u:
        return 'unsplash'
    if u.startswith('http'):
        return 'feed/og'
    return 'placeholder'


def log_run_summary(new_stories, recordationem_payload):
    """One glance-able health report at the end of a run.

    Surfaces the three things that have silently degraded before — the LLM,
    images, and Recordationem — so a bad run is obvious in the log instead of
    hiding behind a green checkmark.
    """
    n = len(new_stories)
    img = collections.Counter(_classify_image(s.get('image')) for s in new_stories)
    real = img['feed/og'] + img['wikipedia'] + img['unsplash']
    rec_n = len(recordationem_payload.get('stories', [])) if recordationem_payload else 0

    log.info("─" * 60)
    log.info("RUN SUMMARY")
    log.info(f"  Stories added : {n}")
    log.info(f"  LLM articles  : {metrics.articles_generated} written "
             f"({metrics.groq_calls} Groq, {metrics.gemini_calls} Gemini), "
             f"{metrics.articles_skipped} skipped")
    if n:
        log.info(f"  Images        : {real}/{n} real "
                 f"(feed/og {img['feed/og']}, Wikipedia {img['wikipedia']}, "
                 f"Unsplash {img['unsplash']}) · {img['placeholder']} placeholder")
        if img['placeholder'] > n / 2:
            log.warning("  ⚠ Over half of new stories fell back to a placeholder "
                        "image — check feed/og reachability or set UNSPLASH_API_KEY.")
    log.info(f"  Recordationem : {rec_n} topics surfaced")
    if not GROQ_API_KEY and not GEMINI_API_KEY:
        log.warning("  ⚠ No LLM key configured — articles are RSS summaries, not rewrites.")
    log.info("─" * 60)


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    # Validate runtime env here (not at import) so tests can import the module.
    _require_runtime_env()

    # Check feed health if requested
    if ARGS.check_feeds:
        check_feed_health()
    
    log.info("=" * 60)
    log.info("VERUM AUTO PUBLISHER v2")
    log.info(f"Mode: {'DRY RUN' if ARGS.dry_run else 'LIVE'}")
    log.info("=" * 60)

    # Diagnostic: confirm the selected Groq model actually works for this key.
    probe_groq_model()

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

    # Rewrite with Groq (single articles or synthesized multi-source)
    log.info("Rewriting with Groq AI...")
    new_stories = []
    
    items_to_process = new_items
    
    # Optionally group and synthesize articles from multiple sources
    if ARGS.synthesize:
        log.info("Grouping similar articles for synthesis...")
        grouped = find_similar_articles(new_items, threshold=0.4)
        log.info(f"Found {len(grouped)} article groups ({len([g for g in grouped if len(g) > 1])} with multiple sources)")
        
        items_to_process = []
        for group in grouped:
            if len(group) >= 2:
                # Synthesize multiple sources
                log.info(f"Synthesizing {len(group)} sources: {group[0]['title'][:50]}...")
                content, sources = rewrite_synthesized_articles(group)
                if content:
                    # Use first item as base, mark as synthesized
                    base_item = group[0]
                    base_item['title'] = group[0]['title']  # Keep original title
                    base_item['is_synthesized'] = True
                    base_item['source_count'] = len(group)
                    new_stories.append(build_story_object(base_item, content, sources))
                    metrics.record_article('groq', ARTICLE_MAX_TOKENS, content)
                    log.info(f"✓ Synthesized from {len(group)} sources")
                else:
                    log.warning(f"✗ Synthesis failed, using single source")
                    items_to_process.append(group[0])
            else:
                # Single article - add to processing queue
                items_to_process.append(group[0])
    
    # Process remaining single articles
    for item in items_to_process:
        log.info(f"Processing: {item['title'][:60]}...")
        content, sources = rewrite_article(item)
        if content:
            new_stories.append(build_story_object(item, content, sources))
            metrics.record_article('groq', ARTICLE_MAX_TOKENS, content)
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

    # Rebuild the Recordationem section from the refreshed corpus. The discovery
    # engine is dynamic — it re-scans every story each run, so faded-but-still-
    # relevant topics surface automatically without any manual curation.
    recordationem_payload = None
    try:
        import recordationem
        recordationem_payload = recordationem.run(data)
    except Exception as e:  # noqa: BLE001 — never let Recordationem block a publish
        log.warning(f"Recordationem discovery skipped: {e}")

    # Deploy

    log.info("=" * 60)
    log.info(f"DONE — {len(new_stories)} new stories published")
    log.info("=" * 60)
    log_run_summary(new_stories, recordationem_payload)
    metrics.report()
 # Deploy (unless --no-deploy)
    if ARGS.deploy:
        deploy_to_netlify(data)
        if recordationem_payload is not None:
            deploy_to_netlify(recordationem_payload, remote_name='recordationem.json')
    else:
        log.info("--no-deploy: skipping Netlify. Preview locally with `npm run dev`")

    log.info("=" * 60)
    log.info(f"DONE — {len(new_stories)} new stories "
             f"{'published' if ARGS.deploy else 'saved locally'}")
    log.info("=" * 60)
if __name__ == '__main__':
    main()
