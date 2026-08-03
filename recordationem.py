"""
Verum News — Recordationem Discovery Engine
============================================

"Recordationem" (Latin: the act of remembering and bringing back into record).

Recordationem is a dedicated section of Verum that recovers stories which have
faded from mainstream coverage but continue to shape the world. This module is
the automated discovery engine that powers it.

Core principle — DYNAMIC DISCOVERY:
  The section is NOT a manually curated static list. Instead, this engine
  continuously scans the available story corpus (stories.json, the same data
  the live site is built from) plus any configured Recordationem sources, and
  surfaces topics that are:
    1. High historical attention  (once heavily covered)
    2. Declining current coverage (rarely covered now)
    3. Continuing relevance       (still active / consequential)

It computes, per discovered topic:

    interface StoryAttentionMetrics {
      peakCoverageScore: number;
      currentCoverageScore: number;
      attentionDecayRate: number;
      relevanceScore: number;
      significanceScore: number;
    }

and the discovery formula:

    recordationemScore =
      (peakCoverageScore * significanceScore * relevanceScore)
      / Math.max(currentCoverageScore, 1);

Topics exceeding a configurable threshold become Recordationem candidates.

Outputs `recordationem.json`, consumed by the React front-end exactly the way
`stories.json` is. Designed to be invoked standalone:

    python recordationem.py                 # rebuild recordationem.json
    python recordationem.py --threshold 30  # custom score threshold
    python recordationem.py --dry-run       # compute but don't write

…or imported and called from auto_publish.py after each publish run:

    import recordationem
    recordationem.run(stories_data)

Editorial overrides (approve / adjust importance / merge / override summaries /
add notes / archive) live in `recordationem_editorial.json` and are layered on
top of every run, so editors retain control without touching code.

Sources are fully configurable in `recordationem_sources.json` — administrators
can add RSS / API / scraper sources without modifying this file.

No heavy ML dependencies are required: semantic matching is done with entity
recognition + token-overlap topic clustering + historical event linkage, so the
engine runs anywhere the existing pipeline runs (stdlib + the deps already in
requirements.txt). When an LLM key is available it is used to write the
editorial narrative sections; otherwise an extractive fallback is used.
"""

from __future__ import annotations

import os
import re
import sys
import json
import math
import logging
import argparse
from collections import defaultdict
from datetime import datetime, timezone, timedelta

log = logging.getLogger("verum.recordationem")
if not log.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

# ── FILES ──────────────────────────────────────────────────────────────────────

STORIES_FILE      = "stories.json"
OUTPUT_FILE       = "recordationem.json"
SOURCES_FILE      = "recordationem_sources.json"      # admin-editable source list
EDITORIAL_FILE    = "recordationem_editorial.json"    # editor overrides
HISTORY_FILE      = "recordationem_history.json"       # rolling coverage history

# ── MISSION STATEMENT (shown prominently on every Recordationem surface) ─────────

MISSION_STATEMENT = (
    "Recordationem exists to recover stories that have fallen from public "
    "attention while retaining real-world significance. Many of the world's "
    "most consequential events do not end when news coverage declines. This "
    "section follows those forgotten stories, tracks their ongoing impact, and "
    "provides readers with meaningful updates long after the headlines disappear."
)

MISSION_SUBTITLE = "Recovering stories that still matter."

# ── TUNABLES ─────────────────────────────────────────────────────────────────────

DEFAULT_THRESHOLD   = float(os.environ.get("RECORDATIONEM_THRESHOLD", "5"))
MAX_STORIES         = int(os.environ.get("RECORDATIONEM_MAX", "60"))
COVERAGE_WINDOW_DAYS = 14          # size of one coverage "window"
PEAK_LOOKBACK_WINDOWS = 26         # ~1 year of history considered for peak
MIN_CLUSTER_SIZE    = 2            # a topic needs at least this many articles
ENTITY_SIGNATURE_LEN = 4           # entities used to fingerprint a topic

# ── SOURCE FRAMEWORK ─────────────────────────────────────────────────────────────
#
# interface RecordationemSource {
#   name: string; url: string; type: "rss" | "api" | "scraper";
#   enabled: boolean; trustScore: number; updateFrequency: string;
# }
#
# Administrators add sources by editing recordationem_sources.json — no code
# changes required. These defaults are written on first run if the file is
# missing. trustScore weights a source's contribution to coverage scoring.

DEFAULT_SOURCES = [
    # ── Tier 1: global wire services & major bureaus ──────────────────────────
    {"name": "BBC News",           "url": "https://feeds.bbci.co.uk/news/world/rss.xml",                    "type": "rss", "enabled": True, "trustScore": 0.95, "updateFrequency": "15m", "region": "Global",  "beat": "World"},
    {"name": "Reuters World",      "url": "https://news.google.com/rss/search?q=when:24h+source:reuters",    "type": "rss", "enabled": True, "trustScore": 0.97, "updateFrequency": "15m", "region": "Global",  "beat": "World"},
    {"name": "Associated Press",   "url": "https://news.google.com/rss/search?q=when:24h+source:apnews",     "type": "rss", "enabled": True, "trustScore": 0.96, "updateFrequency": "15m", "region": "Global",  "beat": "News"},
    {"name": "The Guardian",       "url": "https://www.theguardian.com/world/rss",                          "type": "rss", "enabled": True, "trustScore": 0.92, "updateFrequency": "15m", "region": "UK",      "beat": "World"},
    {"name": "NPR",                "url": "https://feeds.npr.org/1001/rss.xml",                             "type": "rss", "enabled": True, "trustScore": 0.90, "updateFrequency": "30m", "region": "US",      "beat": "News"},
    {"name": "Al Jazeera",         "url": "https://www.aljazeera.com/xml/rss/all.xml",                      "type": "rss", "enabled": True, "trustScore": 0.88, "updateFrequency": "15m", "region": "Qatar",   "beat": "World"},

    # ── Tier 1b: international / regional desks (branch out geographically) ────
    {"name": "France 24",          "url": "https://www.france24.com/en/rss",                                "type": "rss", "enabled": True, "trustScore": 0.85, "updateFrequency": "30m", "region": "France",  "beat": "World"},
    {"name": "The Japan Times",    "url": "https://www.japantimes.co.jp/feed/",                             "type": "rss", "enabled": True, "trustScore": 0.85, "updateFrequency": "1h",  "region": "Japan",   "beat": "Asia"},
    {"name": "Bangkok Post",       "url": "https://www.bangkokpost.com/rss/data/topstories.xml",            "type": "rss", "enabled": True, "trustScore": 0.82, "updateFrequency": "1h",  "region": "Thailand","beat": "Asia"},
    {"name": "The Irish Times",    "url": "https://www.irishtimes.com/cmlink/news-1.1319192",               "type": "rss", "enabled": True, "trustScore": 0.84, "updateFrequency": "1h",  "region": "Ireland", "beat": "Europe"},
    {"name": "CNA (Singapore)",    "url": "https://news.google.com/rss/search?q=when:24h+source:channelnewsasia", "type": "rss", "enabled": True, "trustScore": 0.85, "updateFrequency": "30m", "region": "Singapore","beat": "Asia"},
    {"name": "The Straits Times",  "url": "https://news.google.com/rss/search?q=when:24h+source:straitstimes","type": "rss", "enabled": True, "trustScore": 0.85, "updateFrequency": "30m", "region": "Singapore","beat": "Asia"},
    {"name": "ABC News (AU)",      "url": "https://news.google.com/rss/search?q=when:24h+source:abc.net.au",  "type": "rss", "enabled": True, "trustScore": 0.86, "updateFrequency": "30m", "region": "Australia","beat": "World"},
    {"name": "Sydney Morning Herald","url": "https://news.google.com/rss/search?q=when:24h+source:smh",      "type": "rss", "enabled": True, "trustScore": 0.84, "updateFrequency": "30m", "region": "Australia","beat": "World"},

    # ── Tier 2: topical / beat feeds (branch out topically) ───────────────────
    {"name": "Google News — Business","url": "https://news.google.com/rss/headlines/section/topic/BUSINESS", "type": "rss", "enabled": True, "trustScore": 0.60, "updateFrequency": "15m", "region": "Global", "beat": "Economy"},
    {"name": "Google News — Health",  "url": "https://news.google.com/rss/headlines/section/topic/HEALTH",   "type": "rss", "enabled": True, "trustScore": 0.60, "updateFrequency": "15m", "region": "Global", "beat": "Health"},
    {"name": "Google News — Science", "url": "https://news.google.com/rss/headlines/section/topic/SCIENCE",  "type": "rss", "enabled": True, "trustScore": 0.60, "updateFrequency": "15m", "region": "Global", "beat": "Science"},

    # ── Tier 3: science, academic & fact-checking ─────────────────────────────
    {"name": "Nature",             "url": "https://www.nature.com/nature/current_issue/rss",                "type": "rss", "enabled": True, "trustScore": 0.93, "updateFrequency": "1d",  "region": "Global",  "beat": "Science"},
    {"name": "The Conversation",   "url": "https://theconversation.com/us/articles.atom",                   "type": "rss", "enabled": True, "trustScore": 0.86, "updateFrequency": "6h",  "region": "US",      "beat": "Analysis"},
    {"name": "NASA Breaking News",  "url": "https://www.nasa.gov/rss/dyn/breaking_news.rss",                 "type": "rss", "enabled": True, "trustScore": 0.94, "updateFrequency": "1d",  "region": "US",      "beat": "Science"},
    {"name": "Snopes",             "url": "https://www.snopes.com/feed/",                                   "type": "rss", "enabled": True, "trustScore": 0.90, "updateFrequency": "6h",  "region": "US",      "beat": "Fact-check"},
    {"name": "Full Fact",          "url": "https://fullfact.org/feed/",                                     "type": "rss", "enabled": True, "trustScore": 0.90, "updateFrequency": "6h",  "region": "UK",      "beat": "Fact-check"},
    {"name": "UC Berkeley News",   "url": "https://news.berkeley.edu/feed/",                                "type": "rss", "enabled": True, "trustScore": 0.90, "updateFrequency": "1d",  "region": "US",      "beat": "Research"},
    {"name": "Columbia Journalism Review","url": "https://www.cjr.org/feed",                               "type": "rss", "enabled": True, "trustScore": 0.88, "updateFrequency": "1d",  "region": "US",      "beat": "Media"},

    # ── Extensible: API / scraper source examples (admins add their own) ──────
    {"name": "GDELT Event API",    "url": "https://api.gdeltproject.org/api/v2/doc/doc",                    "type": "api",     "enabled": False, "trustScore": 0.75, "updateFrequency": "15m", "region": "Global", "beat": "Events"},
    {"name": "ReliefWeb Updates",  "url": "https://api.reliefweb.int/v1/reports",                           "type": "api",     "enabled": False, "trustScore": 0.88, "updateFrequency": "1h",  "region": "Global", "beat": "Humanitarian"},
]

# Per-source trust lookup keyed by the `source` slug used inside stories.json.
SOURCE_SLUG_TRUST = {
    "bbc": 0.95, "reuters": 0.97, "guardian": 0.92, "ap": 0.96, "npr": 0.90,
    "aljazeera": 0.88, "france24": 0.85, "nature": 0.93, "nasa": 0.94,
    "conversation": 0.86, "snopes": 0.9, "fullfact": 0.9, "japantimes": 0.85,
    "cna": 0.85, "straitstimes": 0.85, "abcau": 0.86, "smh": 0.84,
    "bangkokpost": 0.82, "irishtimes": 0.84, "googlenews": 0.6, "espn": 0.7,
    "cjr": 0.88, "berkeleyuniv": 0.9, "gdelt": 0.75, "reliefweb": 0.88,
}

# ── DYNAMIC CATEGORY DETECTORS ───────────────────────────────────────────────────
#
# Categories are NOT a hardcoded enum. Each detector is a theme signature; a
# topic is labelled with the highest-scoring theme it matches. When a topic
# matches no theme strongly, an emergent category is synthesised from the
# topic's own dominant entities (so genuinely new categories appear on their
# own from clustering + topic analysis). The seed detectors below simply give
# the common themes good, human-readable names.

THEME_DETECTORS = {
    "Ongoing Wars":            ["war", "conflict", "military", "offensive", "troops", "ceasefire", "invasion", "frontline", "missile", "airstrike", "combat", "rebels", "insurgency"],
    "Climate Events":          ["climate", "warming", "emissions", "wildfire", "flood", "drought", "hurricane", "glacier", "heatwave", "carbon", "sea level", "deforestation"],
    "Public Health":           ["outbreak", "virus", "pandemic", "vaccine", "disease", "epidemic", "infection", "hospital", "health", "cholera", "measles", "polio"],
    "Government Policy":        ["policy", "legislation", "bill", "regulation", "parliament", "congress", "sanctions", "reform", "law", "ministry", "election", "referendum"],
    "Economic Crises":         ["inflation", "recession", "default", "debt", "currency", "bankruptcy", "unemployment", "markets", "collapse", "imf", "bailout", "shortage"],
    "Corporate Accountability":["lawsuit", "fraud", "settlement", "whistleblower", "antitrust", "recall", "scandal", "investigation", "regulator", "fine", "monopoly"],
    "Technology & Privacy":    ["privacy", "surveillance", "data", "breach", "ai", "algorithm", "encryption", "cyberattack", "hacking", "spyware", "platform", "regulation"],
    "Infrastructure Failures": ["bridge", "dam", "grid", "blackout", "collapse", "pipeline", "railway", "infrastructure", "outage", "maintenance", "structural"],
    "International Relations":  ["treaty", "summit", "diplomacy", "alliance", "sanctions", "negotiations", "embassy", "borders", "refugee", "talks", "accord"],
    "Scientific Projects":     ["mission", "telescope", "reactor", "spacecraft", "experiment", "research", "satellite", "probe", "laboratory", "collider", "trial"],
}

# Words that, when present near a topic, signal it is *still active* (relevance).
ONGOING_SIGNALS = {
    "ongoing", "continues", "still", "escalat", "renew", "remains", "deadline",
    "upcoming", "expected", "scheduled", "vote", "ruling", "hearing", "election",
    "talks", "negotiat", "warned", "threat", "rising", "spreading", "deploy",
}

# Words that signal a topic carries unusually high real-world significance.
SIGNIFICANCE_SIGNALS = {
    "war": 3.0, "nuclear": 3.0, "genocide": 3.0, "famine": 2.5, "pandemic": 2.5,
    "crisis": 2.0, "collapse": 2.0, "sanctions": 1.8, "death": 1.8, "killed": 1.8,
    "displaced": 1.8, "refugee": 1.7, "outbreak": 1.7, "default": 1.6, "fraud": 1.5,
    "investigation": 1.4, "election": 1.4, "treaty": 1.3, "emergency": 2.0,
    "disaster": 2.0, "attack": 1.7, "breach": 1.4, "recall": 1.3, "lawsuit": 1.2,
}

STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
    "with", "by", "from", "is", "are", "was", "were", "be", "been", "have", "has",
    "had", "do", "does", "did", "will", "would", "could", "should", "may", "might",
    "can", "must", "says", "said", "say", "new", "as", "this", "that", "these",
    "those", "which", "who", "what", "when", "where", "why", "how", "all", "each",
    "every", "both", "any", "some", "after", "before", "over", "into", "amid",
    "than", "then", "about", "his", "her", "its", "their", "they", "them", "first",
    "more", "most", "report", "reports", "reported", "plan", "plans", "use", "used",
    "year", "years", "day", "days", "week", "month", "two", "three", "one", "out",
    "up", "down", "off", "now", "also", "not", "no", "so", "if", "we", "you", "it",
}

# Capitalised words that begin sentences / clauses but are NOT named entities.
# Excluded from entity recognition so topics fingerprint on real entities only.
NON_ENTITY_WORDS = {
    "according", "however", "despite", "although", "though", "meanwhile",
    "furthermore", "moreover", "nevertheless", "additionally", "having", "while",
    "whilst", "many", "several", "details", "experts", "officials", "sources",
    "analysts", "researchers", "studies", "according to", "but", "and", "yet",
    "still", "since", "because", "during", "following", "amid", "across", "among",
    "another", "other", "such", "here", "there", "today", "yesterday", "tomorrow",
    "recently", "earlier", "later", "currently", "previously", "meanwhile",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december", "spokesperson", "government",
    "president", "minister", "prime", "secretary", "director", "chief", "leader",
}

IMPORTANCE_BANDS = [
    (120, "Critical"),
    (70,  "Very High"),
    (40,  "High"),
    (20,  "Elevated"),
    (0,   "Notable"),
]


# ── TEXT / ENTITY HELPERS ────────────────────────────────────────────────────────

_WORD_RE = r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]+"


def _depossess(w):
    """Strip possessive/quote suffixes so 'Russia's' == 'Russia'."""
    return re.sub(r"[’']s?$", "", w).strip("-’'")


def _tokens(text):
    """Lowercase significant content tokens (entities + meaningful words)."""
    if not text:
        return []
    raw = (_depossess(w) for w in re.findall(_WORD_RE, text))
    return [w.lower() for w in raw if len(w) > 2 and w.lower() not in STOP_WORDS]


def extract_entities(text, limit=8):
    """Lightweight named-entity recognition.

    Captures capitalised multi-word phrases (e.g. "Russia–Ukraine", "World
    Health Organization") and prominent proper nouns. Returns ordered, deduped
    entities — the semantic fingerprint of a story.
    """
    if not text:
        return []
    words = [_depossess(w) for w in re.findall(_WORD_RE, text)]
    words = [w for w in words if len(w) > 1]
    excluded = STOP_WORDS | NON_ENTITY_WORDS

    def keep(w):
        return w[0].isupper() and w.lower() not in excluded

    entities, phrase = [], []
    for w in words:
        if keep(w):
            phrase.append(w)
        else:
            if len(phrase) >= 2:
                entities.append(" ".join(phrase))
            phrase = []
    if len(phrase) >= 2:
        entities.append(" ".join(phrase))
    # Standalone proper nouns
    for w in words:
        if keep(w) and len(w) > 3:
            if not any(w in e for e in entities):
                entities.append(w)
    # Dedupe, case-insensitive, preserve order
    seen, out = set(), []
    for e in entities:
        k = e.lower()
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out[:limit]


def _signature(entities):
    """Stable topic fingerprint from the top entities."""
    return frozenset(e.lower() for e in entities[:ENTITY_SIGNATURE_LEN])


def _parse_time(ts):
    if not ts:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(ts[:19] if "T" in ts else ts, fmt).replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
    return None


def _slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:60] or "topic"


# ── CLUSTERING (topic discovery via entity overlap + historical linkage) ─────────

def _entity_overlap(a, b):
    """Jaccard-style overlap between two entity sets (semantic linkage)."""
    if not a or not b:
        return 0.0
    sa, sb = set(e.lower() for e in a), set(e.lower() for e in b)
    inter = len(sa & sb)
    if inter == 0:
        return 0.0
    return inter / min(len(sa), len(sb))


def cluster_articles(articles, threshold=0.34):
    """Group articles into topics by entity overlap.

    This is the historical-event-linkage step: articles about "new sanctions",
    "battlefield developments" and "refugee statistics" cluster onto the same
    ongoing conflict even when the original headline is never repeated, because
    they share an entity fingerprint (e.g. {ukraine, russia, kyiv}).
    """
    clusters = []  # each: {"signature": set, "articles": [...]}
    for art in articles:
        ents = art["entities"]
        if not ents:
            continue
        best, best_score = None, 0.0
        for c in clusters:
            score = _entity_overlap(ents, c["signature_entities"])
            if score > best_score:
                best, best_score = c, score
        if best is not None and best_score >= threshold:
            best["articles"].append(art)
            # Grow the cluster signature with newly seen entities
            for e in ents:
                if e.lower() not in {x.lower() for x in best["signature_entities"]}:
                    best["signature_entities"].append(e)
        else:
            clusters.append({"signature_entities": list(ents), "articles": [art]})
    return [c for c in clusters if len(c["articles"]) >= MIN_CLUSTER_SIZE]


# ── DYNAMIC CATEGORY ASSIGNMENT ──────────────────────────────────────────────────

def assign_category(cluster_tokens, cluster_entities):
    """Pick the best theme, or synthesise an emergent category.

    Returns (category_name, emergent: bool). Emergent categories are derived
    from the cluster's own dominant entity, so new categories appear without
    any code change when clustering surfaces an unmodelled theme.
    """
    token_set = cluster_tokens  # Counter
    best_theme, best_score = None, 0
    for theme, signals in THEME_DETECTORS.items():
        score = sum(token_set.get(s, 0) for s in signals)
        if score > best_score:
            best_theme, best_score = theme, score
    if best_theme and best_score >= 2:
        return best_theme, False
    # Emergent: name the category after the dominant entity / theme word.
    if cluster_entities:
        return f"{cluster_entities[0]} Watch", True
    if token_set:
        top = token_set.most_common(1)[0][0]
        return f"{top.title()} Watch", True
    return "Developing Stories", True


# ── METRICS ──────────────────────────────────────────────────────────────────────

def _coverage_timeseries(articles, now):
    """Bucket articles into trust-weighted coverage windows.

    Returns list of {periodStart, score, sources} ordered oldest→newest, plus a
    parallel source-diversity series.
    """
    buckets = defaultdict(lambda: {"score": 0.0, "sources": set()})
    for art in articles:
        t = art["time"]
        if not t:
            continue
        age_days = (now - t).days
        window = age_days // COVERAGE_WINDOW_DAYS  # 0 = current window
        if window < 0:
            window = 0
        if window > PEAK_LOOKBACK_WINDOWS:
            continue
        trust = SOURCE_SLUG_TRUST.get(art["source"], 0.7)
        buckets[window]["score"] += trust
        buckets[window]["sources"].add(art["source"])

    if not buckets:
        return [], []

    max_window = max(buckets.keys())
    series, diversity = [], []
    for w in range(max_window, -1, -1):  # oldest → newest
        b = buckets.get(w, {"score": 0.0, "sources": set()})
        period_start = now - timedelta(days=(w + 1) * COVERAGE_WINDOW_DAYS)
        series.append({
            "period": period_start.strftime("%Y-%m-%d"),
            "windowsAgo": w,
            "score": round(b["score"], 2),
        })
        diversity.append({
            "period": period_start.strftime("%Y-%m-%d"),
            "windowsAgo": w,
            "sourceCount": len(b["sources"]),
        })
    return series, diversity


def compute_metrics(cluster, now):
    """Compute StoryAttentionMetrics + recordationemScore for one topic."""
    articles = cluster["articles"]
    series, diversity = _coverage_timeseries(articles, now)

    if not series:
        return None

    scores = [pt["score"] for pt in series]
    peak = max(scores) if scores else 0.0
    current = series[-1]["score"] if series else 0.0

    # attentionDecayRate ∈ [0,1]: how far coverage has fallen from its peak.
    decay = 0.0 if peak <= 0 else max(0.0, (peak - current) / peak)

    # significanceScore: real-world weight from significance signals + scale.
    tokens = cluster["token_counts"]
    sig_raw = sum(SIGNIFICANCE_SIGNALS.get(w, 0.0) * min(c, 5)
                  for w, c in tokens.items())
    # Scale bonus: bigger sustained coverage implies a bigger story.
    sig_scale = math.log1p(len(articles)) + math.log1p(peak)
    significance = round(1.0 + sig_raw * 0.15 + sig_scale * 0.4, 3)

    # relevanceScore: still-active signal. Recency of last article + ongoing
    # language + whether *some* coverage persists into recent windows.
    last_art = max(articles, key=lambda a: a["time"] or now)
    last_time = last_art["time"] or now
    days_since = max(0, (now - last_time).days)
    recency = math.exp(-days_since / 120.0)  # 1.0 today → ~0.45 at 100 days
    ongoing_hits = sum(1 for w in tokens for sig in ONGOING_SIGNALS if sig in w)
    ongoing = min(1.5, 0.6 + ongoing_hits * 0.08)
    # Persistence: coverage in the latest third of windows keeps relevance up.
    tail = scores[-max(1, len(scores) // 3):]
    persistence = 1.0 if any(s > 0 for s in tail) else 0.5
    relevance = round((0.4 + recency) * ongoing * persistence, 3)

    # Discovery formula.
    rec_score = (peak * significance * relevance) / max(current, 1.0)

    metrics = {
        "peakCoverageScore": round(peak, 3),
        "currentCoverageScore": round(current, 3),
        "attentionDecayRate": round(decay, 3),
        "relevanceScore": relevance,
        "significanceScore": significance,
    }
    return {
        "metrics": metrics,
        "recordationemScore": round(rec_score, 3),
        "coverageDeclinePct": -int(round(decay * 100)),
        "coverageHistory": series,
        "sourceDiversity": diversity,
        "lastVerifiedUpdate": last_time.strftime("%Y-%m-%dT%H:%M:%S"),
        "daysSinceUpdate": days_since,
    }


def importance_label(score):
    for cutoff, label in IMPORTANCE_BANDS:
        if score >= cutoff:
            return label
    return "Notable"


def status_label(metrics, days_since):
    """Ongoing status string for the card."""
    if days_since <= 30 and metrics["relevanceScore"] >= 0.9:
        return "Ongoing"
    if days_since <= 90:
        return "Active"
    if metrics["relevanceScore"] >= 0.7:
        return "Simmering"
    return "Dormant"


# ── NARRATIVE SECTIONS (LLM with extractive fallback) ────────────────────────────

def _sentences(text, limit=3):
    parts = re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text or "").strip())
    parts = [p.strip() for p in parts if len(p.strip()) > 30]
    return parts[:limit]


SOURCE_LABELS = {
    "bbc": "BBC News", "reuters": "Reuters", "guardian": "The Guardian",
    "ap": "AP News", "npr": "NPR", "aljazeera": "Al Jazeera",
    "france24": "France 24", "nature": "Nature", "nasa": "NASA",
    "conversation": "The Conversation", "snopes": "Snopes", "fullfact": "Full Fact",
    "japantimes": "The Japan Times", "cna": "CNA", "straitstimes": "The Straits Times",
    "abcau": "ABC News", "smh": "Sydney Morning Herald", "bangkokpost": "Bangkok Post",
    "irishtimes": "The Irish Times", "googlenews": "Google News", "espn": "ESPN",
    "cjr": "Columbia Journalism Review", "berkeleyuniv": "UC Berkeley", "verum": "Verum",
}

# Per-category "why this still matters" openers — each topic draws from the set
# matching its category (falling back to a generic set), varied by a per-topic
# index so no two write-ups read identically.
_WHY_BY_CATEGORY = {
    "Ongoing Wars": [
        "The fighting tied to {ent} has slipped off front pages, but it has not stopped.",
        "{ent} no longer leads bulletins, yet the conflict keeps grinding on with real casualties and shifting front lines.",
        "Peace headlines faded; the war around {ent} did not.",
    ],
    "Public Health": [
        "{ent} stopped trending, but the caseload, response and downstream effects are still unfolding.",
        "The acute-alarm phase of {ent} passed — the public-health consequences did not.",
        "Coverage of {ent} cooled, even as clinicians and officials keep managing it week to week.",
    ],
    "Climate Events": [
        "The cameras left {ent}, but the recovery, displacement and long-tail damage continue.",
        "{ent} has faded from the cycle while its climate and economic aftershocks keep landing.",
        "Attention moved on from {ent}; the science and the cleanup did not.",
    ],
    "Government Policy": [
        "The vote made headlines; the implementation of {ent} is where the real consequences play out, quietly.",
        "{ent} left the front page the moment the debate ended — but the policy is now shaping outcomes in the background.",
        "Legislative drama around {ent} subsided; the follow-through rarely gets covered.",
    ],
    "Economic Crises": [
        "Market panic over {ent} eased in the headlines, but households and institutions are still absorbing the hit.",
        "{ent} dropped out of the business pages while its financial fallout kept compounding.",
        "The acute crisis phase of {ent} passed; the slow economic damage is ongoing.",
    ],
    "International Relations": [
        "The summit optics around {ent} faded, but the underlying negotiations and tensions persist.",
        "{ent} left the diplomatic spotlight without being resolved.",
        "Coverage of {ent} cooled even as the talks, sanctions and alignments keep shifting.",
    ],
    "Technology & Privacy": [
        "The breach headlines around {ent} passed, but the exposure and its consequences are still live.",
        "{ent} stopped being news while its effects on users, regulators and platforms kept spreading.",
        "The initial alarm over {ent} faded faster than the problem did.",
    ],
    "Corporate Accountability": [
        "The scandal around {ent} left the news cycle before the investigations and settlements concluded.",
        "{ent} stopped making headlines while the legal and regulatory process quietly ground on.",
        "Public attention on {ent} moved elsewhere; the accountability questions did not close.",
    ],
    "Infrastructure Failures": [
        "The failure at {ent} made a brief splash; the repairs, inquiries and risk remain.",
        "{ent} dropped out of coverage while the underlying vulnerability persisted.",
        "The dramatic images from {ent} faded faster than the structural problem.",
    ],
    "Scientific Projects": [
        "The launch buzz around {ent} faded, but the mission and its findings continue.",
        "{ent} left the science pages while the long research timeline kept running.",
        "Attention on {ent} cooled between milestones, though the work never paused.",
    ],
}
_WHY_GENERIC = [
    "{ent} has fallen out of active coverage, but the underlying situation is still developing.",
    "The headlines about {ent} moved on; the substance has not been resolved.",
    "{ent} no longer draws daily reporting, yet it keeps producing verifiable developments.",
]


def _human_list(items):
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])} and {items[-1]}"


def _human_sources(slugs):
    labels = [SOURCE_LABELS.get(s, s.title()) for s in slugs]
    if len(labels) <= 3:
        return _human_list(labels)
    return f"{', '.join(labels[:2])} and {len(labels) - 2} others"


def _theme_phrases(keywords):
    themed = []
    for w in keywords:
        for signals in THEME_DETECTORS.values():
            if w in signals and w not in themed:
                themed.append(w)
    return _human_list(themed[:3])


def _fmt_date(dt):
    if not dt:
        return "an earlier date"
    return f"{dt:%B} {dt.day}, {dt.year}"


def build_narrative(cluster, title, m, category="Developing Stories", entities=None, status="Active"):
    """Produce the detail-page narrative sections — varied and story-specific.

    Uses the LLM (Groq/Gemini) when a key is present for editor-quality prose.
    The extractive fallback below is deliberately data-driven: it weaves each
    topic's own metrics, dates, entities, themes and sources into differently
    phrased sections so no two write-ups read the same. Output is
    editor-reviewable and overridable via recordationem_editorial.json.
    """
    arts = sorted(cluster["articles"], key=lambda a: a["time"] or datetime.min.replace(tzinfo=timezone.utc))
    earliest, latest = arts[0], arts[-1]

    llm = _try_llm_narrative(title, earliest, latest, m)
    if llm:
        return llm

    entities = entities or []
    metrics = m["metrics"]
    decline = abs(m["coverageDeclinePct"])
    peak = metrics["peakCoverageScore"]
    current = metrics["currentCoverageScore"]
    days = m["daysSinceUpdate"]
    n_reports = len(arts)
    src_slugs = sorted({a["source"] for a in arts})
    n_sources = len(src_slugs)
    src_label = _human_sources(src_slugs)
    ent_label = _human_list(entities[:3]) or title
    themes = _theme_phrases([w for w, _ in cluster["token_counts"].most_common(25)])
    e_date, l_date = _fmt_date(earliest["time"]), _fmt_date(latest["time"])
    span_days = (latest["time"] - earliest["time"]).days if (latest["time"] and earliest["time"]) else 0
    pick = sum(ord(c) for c in (title or "x"))

    # WHY — category-flavoured opener + topic-specific evidence clause
    openers = _WHY_BY_CATEGORY.get(category, _WHY_GENERIC)
    opener = openers[pick % len(openers)].format(ent=ent_label)
    theme_clause = f" The through-line runs through {themes}." if themes else ""
    why = (
        f"{opener} Coverage is down {decline}% from its peak, and the most recent "
        f"verified update is {days} day{'s' if days != 1 else ''} old — yet Verum's "
        f"discovery engine still surfaced it because the historical attention was high, "
        f"current attention is low, and it keeps generating checkable developments across "
        f"{n_sources} source{'s' if n_sources != 1 else ''}.{theme_clause}"
    )

    # WHAT HAPPENED — anchored to first sustained coverage
    hist = " ".join(_sentences(earliest.get("content") or earliest["title"], 3)) or earliest["title"]
    lead = [
        "The story first drew sustained coverage around",
        "Reporting first clustered in force around",
        "It broke into the mainstream cycle around",
        "Coverage first peaked in the window around",
    ][pick % 4]
    what_happened = f"{lead} {e_date}. {hist}"

    # WHAT IS HAPPENING NOW — recency + footprint
    nowtext = " ".join(_sentences(latest.get("content") or latest["title"], 3)) or latest["title"]
    recency = ("in the last few days" if days <= 7
               else f"about {days} days ago" if days < 60
               else f"{days} days ago")
    what_now = (
        f"The most recent verified reporting lands {recency} ({l_date}): {nowtext} "
        f"Verum is tracking {n_reports} report{'s' if n_reports != 1 else ''} on this topic "
        f"across {n_sources} source{'s' if n_sources != 1 else ''} — {src_label}."
    )

    # WHAT CHANGED — peak vs now, framing shift, source-diversity trend
    div = m.get("sourceDiversity") or []
    div_note = ""
    if len(div) >= 2:
        first_d, last_d = div[0]["sourceCount"], div[-1]["sourceCount"]
        if last_d < first_d:
            div_note = (f" Source diversity has narrowed from {first_d} to {last_d} outlets per cycle — "
                        f"a common marker of a fading story.")
        elif last_d > first_d:
            div_note = f" Notably, source diversity has widened from {first_d} to {last_d} outlets per cycle."
    changed = (
        f"At its peak the topic drew a coverage score of {peak}; that has fallen to {current} — "
        f"a {decline}% decline over roughly {span_days} day{'s' if span_days != 1 else ''}. "
        f"Early coverage framed it as “{earliest['title'][:90]}”, while the latest thread "
        f"reads “{latest['title'][:90]}”.{div_note}"
    )

    return {
        "whyStillImportant": why,
        "whatHappened": what_happened,
        "whatIsHappeningNow": what_now,
        "whatChanged": changed,
        "generatedBy": "extractive",
    }


def _try_llm_narrative(title, earliest, latest, metrics):
    """Best-effort LLM narrative. Returns None if no key / any failure."""
    groq_key = os.environ.get("GROQ_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not (groq_key or gemini_key):
        return None

    prompt = (
        "You are an editor for Verum's 'Recordationem' desk, which recovers "
        "important stories that have faded from the news. Using the two "
        "datapoints below (earliest and latest reporting on the same ongoing "
        "topic), write four concise, factual, non-sensational sections. Return "
        "STRICT JSON with keys: whyStillImportant, whatHappened, "
        "whatIsHappeningNow, whatChanged.\n\n"
        f"TOPIC: {title}\n"
        f"COVERAGE DECLINE: {metrics['coverageDeclinePct']}%\n"
        f"EARLIEST ({earliest.get('time')}): {earliest['title']}. "
        f"{(earliest.get('content') or '')[:600]}\n"
        f"LATEST ({latest.get('time')}): {latest['title']}. "
        f"{(latest.get('content') or '')[:600]}\n"
    )
    try:
        if groq_key:
            from groq import Groq
            client = Groq(api_key=groq_key)
            resp = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
                max_tokens=900,
                response_format={"type": "json_object"},
            )
            raw = resp.choices[0].message.content
        else:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            raw = model.generate_content(prompt).text
        data = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
        data["generatedBy"] = "ai"
        return data
    except Exception as e:  # noqa: BLE001 — degrade gracefully
        log.warning(f"LLM narrative failed, using extractive fallback: {e}")
        return None


def build_watch_next(cluster, title):
    """Derive upcoming milestones (Watch Next) from forward-looking language."""
    future_kw = {
        "vote": "Vote", "election": "Election", "hearing": "Hearing",
        "deadline": "Deadline", "summit": "Summit", "report": "Report",
        "ruling": "Court ruling", "talks": "Talks", "review": "Review",
        "trial": "Trial", "launch": "Launch", "meeting": "Meeting",
    }
    items, seen = [], set()
    for art in sorted(cluster["articles"], key=lambda a: a["time"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        text = f"{art['title']} {art.get('content','')[:400]}".lower()
        for kw, label in future_kw.items():
            if kw in text and label not in seen:
                seen.add(label)
                items.append({
                    "type": label,
                    "title": f"Watch for an upcoming {label.lower()} related to {title}.",
                    "sourceHint": art["title"][:90],
                })
        if len(items) >= 4:
            break
    if not items:
        items.append({
            "type": "Developments",
            "title": f"Verum is tracking {title} for the next verifiable development.",
            "sourceHint": "",
        })
    return items


def build_updates(cluster, limit=8):
    """Recent verified-updates timeline (most recent first)."""
    arts = sorted(cluster["articles"], key=lambda a: a["time"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    updates = []
    for a in arts[:limit]:
        updates.append({
            "date": (a["time"] or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S"),
            "title": a["title"],
            "source": a["source"],
            "url": a.get("original_url", ""),
            "storyId": a["id"],
        })
    return updates


# ── EDITORIAL OVERRIDES ──────────────────────────────────────────────────────────

def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def load_editorial():
    """Editor overrides keyed by topic id.

    Schema (recordationem_editorial.json):
    {
      "merges":   { "child_id": "parent_id", ... },
      "overrides": {
         "<id>": {
            "approved": true|false,
            "archived": true|false,
            "importanceScore": 95,            // hard override of recordationemScore
            "title": "Russia–Ukraine War",
            "category": "Ongoing Wars",
            "notes": ["Editor context note ..."],
            "summaries": { "whyStillImportant": "...", ... }
         }
      }
    }
    """
    return load_json(EDITORIAL_FILE, {"merges": {}, "overrides": {}})


def apply_editorial(story, editorial):
    """Layer editor decisions on top of an auto-discovered story (in place)."""
    ov = editorial.get("overrides", {}).get(story["id"])
    if not ov:
        story.setdefault("editorial", {"approved": True, "archived": False, "notes": []})
        return story

    ed = story.setdefault("editorial", {})
    ed["approved"] = ov.get("approved", True)
    ed["archived"] = ov.get("archived", False)
    ed["notes"] = ov.get("notes", [])

    if "title" in ov:
        story["title"] = ov["title"]
    if "category" in ov:
        story["category"] = ov["category"]
    if "importanceScore" in ov:
        story["recordationemScore"] = ov["importanceScore"]
        story["importance"] = importance_label(ov["importanceScore"])
        story["editorial"]["importanceOverridden"] = True
    for key, val in (ov.get("summaries") or {}).items():
        if key in story:
            story[key] = val
            story.setdefault("editorial", {})["summariesOverridden"] = True
    return story


# ── CORE PIPELINE ────────────────────────────────────────────────────────────────

def _flatten_stories(data):
    """Normalise stories.json into a flat article list for analysis."""
    stories = data.get("stories", {})
    articles = []
    for sid, s in stories.items():
        if not isinstance(s, dict):
            continue
        title = s.get("title", "")
        content = s.get("content", "")
        ents = extract_entities(f"{title}. {title}. {content[:1500]}")
        articles.append({
            "id": sid,
            "title": title,
            "content": content,
            "category": s.get("category", "News"),
            "source": s.get("source", "verum"),
            "time": _parse_time(s.get("time")),
            "image": s.get("image", ""),
            "original_url": s.get("original_url", ""),
            "entities": ents,
        })
    return articles


def discover(data, threshold=DEFAULT_THRESHOLD, now=None):
    """Run the full discovery engine over a stories.json data structure.

    Returns the recordationem.json payload (dict).
    """
    editorial = load_editorial()
    merges = editorial.get("merges", {})

    log.info("Recordationem: flattening corpus...")
    articles = _flatten_stories(data)
    log.info(f"Recordationem: {len(articles)} articles in corpus")

    # Anchor "now" to the newest article in the corpus (capped at wall-clock).
    # In production the corpus is fresh so this equals real now; on an older
    # snapshot it keeps the coverage-decay maths meaningful instead of scoring
    # every topic as 100% declined against a future clock.
    if now is None:
        times = [a["time"] for a in articles if a["time"]]
        wall = datetime.now(timezone.utc)
        now = min(max(times), wall) if times else wall

    log.info("Recordationem: clustering into topics (entity linkage)...")
    clusters = cluster_articles(articles)
    log.info(f"Recordationem: {len(clusters)} candidate topics")

    discovered = []
    for cluster in clusters:
        # token counts across the cluster (theme + significance detection)
        token_counts = defaultdict(int)
        for art in cluster["articles"]:
            for tok in _tokens(f"{art['title']} {art['title']} {art.get('content','')[:800]}"):
                token_counts[tok] += 1
        from collections import Counter
        cluster["token_counts"] = Counter(token_counts)

        m = compute_metrics(cluster, now)
        if not m:
            continue
        if m["recordationemScore"] < threshold:
            continue

        # Topic title: most representative entity phrase.
        entities_sorted = _dominant_entities(cluster)
        title = _topic_title(entities_sorted, cluster)
        category, emergent = assign_category(cluster["token_counts"], entities_sorted)
        status = status_label(m["metrics"], m["daysSinceUpdate"])

        # Narrative sections are generated per-topic from its own metrics, dates,
        # entities and sources, so each write-up is distinct (no shared template).
        narrative = build_narrative(
            cluster, title, m, category=category, entities=entities_sorted, status=status
        )

        sig = _signature(entities_sorted)
        topic_id = "rec_" + _slugify("-".join(sorted(sig))[:48]) if sig else "rec_" + _slugify(title)

        story = {
            "id": topic_id,
            "title": title,
            "slug": _slugify(title),
            "category": category,
            "categoryEmergent": emergent,
            "entities": entities_sorted[:10],
            "keywords": [w for w, _ in cluster["token_counts"].most_common(12)],
            "articleCount": len(cluster["articles"]),
            "image": _pick_image(cluster),
            "metrics": m["metrics"],
            "recordationemScore": m["recordationemScore"],
            "importance": importance_label(m["recordationemScore"]),
            "coverageDeclinePct": m["coverageDeclinePct"],
            "status": status,
            "lastVerifiedUpdate": m["lastVerifiedUpdate"],
            "daysSinceUpdate": m["daysSinceUpdate"],
            "coverageHistory": m["coverageHistory"],
            "sourceDiversity": m["sourceDiversity"],
            "whyStillImportant": narrative["whyStillImportant"],
            "whatHappened": narrative["whatHappened"],
            "whatIsHappeningNow": narrative["whatIsHappeningNow"],
            "whatChanged": narrative["whatChanged"],
            "narrativeSource": narrative.get("generatedBy", "extractive"),
            "updates": build_updates(cluster),
            "watchNext": build_watch_next(cluster, title),
            "memberStoryIds": [a["id"] for a in cluster["articles"]],
        }
        discovered.append(story)

    # Editorial merges: fold child topics into parents before final assembly.
    discovered = _apply_merges(discovered, merges)

    # Apply editorial overrides + drop archived/unapproved.
    final = []
    for story in discovered:
        apply_editorial(story, editorial)
        if story.get("editorial", {}).get("archived"):
            continue
        if story.get("editorial", {}).get("approved") is False:
            continue
        final.append(story)

    final.sort(key=lambda s: s["recordationemScore"], reverse=True)
    final = final[:MAX_STORIES]

    categories = _dynamic_categories(final)

    payload = {
        "mission": MISSION_STATEMENT,
        "subtitle": MISSION_SUBTITLE,
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "threshold": threshold,
        "formula": "recordationemScore = (peak * significance * relevance) / max(current, 1)",
        "categories": categories,
        "stories": final,
        "sources": load_sources(),
        "stats": {
            "corpusSize": len(articles),
            "topicsExamined": len(clusters),
            "topicsSurfaced": len(final),
        },
    }
    _update_history(final, now)
    return payload


def _dominant_entities(cluster):
    """Rank entities by frequency across the cluster's articles."""
    counts = defaultdict(int)
    display = {}
    for art in cluster["articles"]:
        for e in art["entities"]:
            counts[e.lower()] += 1
            display.setdefault(e.lower(), e)
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [display[k] for k, _ in ranked]


def _topic_title(entities, cluster):
    """Human-readable topic title from the leading entities.

    Picks the two strongest *distinct* entities (skipping ones that are
    substrings of an already-chosen entity) and pairs them with an en dash when
    both are short enough to read as a 'X–Y' topic label.
    """
    if not entities:
        return cluster["articles"][0]["title"][:60]

    chosen = []
    for e in entities:
        el = e.lower()
        if any(el in c.lower() or c.lower() in el for c in chosen):
            continue
        chosen.append(e)
        if len(chosen) == 2:
            break

    if not chosen:
        return entities[0]
    if len(chosen) == 2 and len(chosen[0]) <= 20 and len(chosen[1]) <= 20:
        return f"{chosen[0]}–{chosen[1]}"
    return chosen[0]


def _pick_image(cluster):
    for art in sorted(cluster["articles"], key=lambda a: a["time"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        if art.get("image"):
            return art["image"]
    return ""


def _apply_merges(stories, merges):
    """Merge child topic ids into parents (editor 'merge duplicate topics')."""
    if not merges:
        return stories
    by_id = {s["id"]: s for s in stories}
    for child, parent in merges.items():
        if child in by_id and parent in by_id:
            p, c = by_id[parent], by_id[child]
            p["memberStoryIds"] = list(dict.fromkeys(p["memberStoryIds"] + c["memberStoryIds"]))
            p["updates"] = sorted(p["updates"] + c["updates"], key=lambda u: u["date"], reverse=True)[:8]
            p["articleCount"] += c["articleCount"]
            del by_id[child]
    return list(by_id.values())


def _dynamic_categories(stories):
    """Categories that emerged this run, with counts (generated, not hardcoded)."""
    counts = defaultdict(int)
    emergent = {}
    for s in stories:
        counts[s["category"]] += 1
        emergent[s["category"]] = emergent.get(s["category"], False) or s.get("categoryEmergent", False)
    return [
        {"name": name, "count": counts[name], "emergent": emergent[name]}
        for name in sorted(counts, key=lambda n: -counts[n])
    ]


# ── COVERAGE HISTORY PERSISTENCE ─────────────────────────────────────────────────

def _update_history(stories, now):
    """Append this run's coverage snapshot so decay can be tracked over runs."""
    history = load_json(HISTORY_FILE, {"snapshots": []})
    history["snapshots"].append({
        "at": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "topics": {
            s["id"]: {
                "current": s["metrics"]["currentCoverageScore"],
                "peak": s["metrics"]["peakCoverageScore"],
                "score": s["recordationemScore"],
            }
            for s in stories
        },
    })
    # keep last 200 snapshots
    history["snapshots"] = history["snapshots"][-200:]
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump(history, f, indent=2)
    except OSError as e:
        log.warning(f"Could not persist coverage history: {e}")


# ── SOURCES ──────────────────────────────────────────────────────────────────────

def load_sources():
    """Load admin-configured sources; seed defaults on first run."""
    sources = load_json(SOURCES_FILE, None)
    if sources is None:
        try:
            with open(SOURCES_FILE, "w") as f:
                json.dump({"sources": DEFAULT_SOURCES}, f, indent=2)
            log.info(f"Seeded default sources → {SOURCES_FILE}")
        except OSError:
            pass
        return DEFAULT_SOURCES
    return sources.get("sources", DEFAULT_SOURCES) if isinstance(sources, dict) else sources


# ── SEARCH INTEGRATION HELPER ────────────────────────────────────────────────────

def search(payload, query):
    """Return Recordationem topics matching a search query.

    Powers the 'Recordationem Updates' band in site search results: it lets a
    reader immediately see whether a topic has ongoing significance despite
    limited current coverage.
    """
    q = (query or "").lower().strip()
    if not q:
        return []
    terms = [t for t in re.split(r"\s+", q) if t]
    results = []
    for s in payload.get("stories", []):
        haystack = " ".join([
            s["title"], s["category"], " ".join(s.get("entities", [])),
            " ".join(s.get("keywords", [])), s.get("whyStillImportant", ""),
        ]).lower()
        if all(t in haystack for t in terms):
            results.append(s)
    return results


# ── PUBLIC ENTRYPOINTS ───────────────────────────────────────────────────────────

def run(data=None, threshold=DEFAULT_THRESHOLD, write=True, output=OUTPUT_FILE):
    """Build recordationem.json. Importable from auto_publish.py.

    Pass the already-loaded stories.json dict as `data` to avoid re-reading.
    """
    if data is None:
        data = load_json(STORIES_FILE, None)
        if data is None:
            log.error(f"{STORIES_FILE} not found — cannot run Recordationem")
            return None
    payload = discover(data, threshold=threshold)
    log.info(
        f"Recordationem: surfaced {len(payload['stories'])} topics across "
        f"{len(payload['categories'])} categories "
        f"(threshold={threshold})"
    )
    if write:
        with open(output, "w") as f:
            json.dump(payload, f, indent=2)
        log.info(f"✓ {output} written")
    return payload


def _cli():
    parser = argparse.ArgumentParser(description="Verum Recordationem discovery engine")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                        help=f"recordationemScore threshold (default {DEFAULT_THRESHOLD})")
    parser.add_argument("--stories", default=STORIES_FILE, help="path to stories.json")
    parser.add_argument("--output", default=OUTPUT_FILE, help="output file")
    parser.add_argument("--dry-run", action="store_true", help="compute but do not write")
    parser.add_argument("--search", help="search the freshly built index and print matches")
    args = parser.parse_args()

    data = load_json(args.stories, None)
    if data is None:
        log.error(f"{args.stories} not found")
        sys.exit(1)

    payload = run(data, threshold=args.threshold, write=not args.dry_run, output=args.output)
    if payload is None:
        sys.exit(1)

    if args.search:
        hits = search(payload, args.search)
        log.info(f"{len(hits)} match(es) for '{args.search}':")
        for h in hits:
            log.info(f"  • {h['title']}  [{h['category']}]  "
                     f"score={h['recordationemScore']}  decline={h['coverageDeclinePct']}%")


if __name__ == "__main__":
    _cli()
