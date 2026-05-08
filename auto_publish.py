"""
Verum News — Auto Publisher
Fetches RSS feeds, rewrites articles with Groq AI, updates stories.json, deploys to Netlify.
Run manually: python auto_publish.py
Runs automatically via GitHub Actions on a schedule.
"""

import os
import json
import random
import hashlib
import feedparser
import requests
from datetime import datetime, timezone
from groq import Groq

# ── CONFIG ────────────────────────────────────────────────────────────────────

GROQ_API_KEY      = os.environ.get('GROQ_API_KEY')
NETLIFY_AUTH_TOKEN = os.environ.get('NETLIFY_AUTH_TOKEN')
NETLIFY_SITE_ID   = os.environ.get('NETLIFY_SITE_ID', 'b6e1ba3f-9f5e-46c1-984a-10c3b5fa89de')
STORIES_FILE      = 'stories.json'

# How many new stories to fetch per run
MAX_NEW_STORIES = 6

# ── RSS FEEDS ─────────────────────────────────────────────────────────────────

FEEDS = [
    # BBC
    { 'url': 'https://feeds.bbci.co.uk/news/world/rss.xml',                    'source': 'BBC News',     'category': 'World'    },
    { 'url': 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',  'source': 'BBC News',     'category': 'Science'  },
    { 'url': 'https://feeds.bbci.co.uk/news/health/rss.xml',                   'source': 'BBC News',     'category': 'Health'   },
    { 'url': 'https://feeds.bbci.co.uk/news/politics/rss.xml',                 'source': 'BBC News',     'category': 'Politics' },
    # Reuters
    { 'url': 'https://feeds.reuters.com/reuters/worldNews',                    'source': 'Reuters',      'category': 'World'    },
    { 'url': 'https://feeds.reuters.com/reuters/politicsNews',                 'source': 'Reuters',      'category': 'Politics' },
    # AP
    { 'url': 'https://feeds.apnews.com/rss/apf-topnews',                       'source': 'AP News',      'category': 'News'     },
    { 'url': 'https://feeds.apnews.com/rss/apf-sports',                        'source': 'AP News',      'category': 'Sports'   },
    { 'url': 'https://feeds.apnews.com/rss/apf-Health',                        'source': 'AP News',      'category': 'Health'   },
    { 'url': 'https://feeds.apnews.com/rss/apf-science',                       'source': 'AP News',      'category': 'Science'  },
    # ESPN
    { 'url': 'https://www.espn.com/espn/rss/news',                             'source': 'ESPN',         'category': 'Sports'   },
    # NPR
    { 'url': 'https://feeds.npr.org/1001/rss.xml',                             'source': 'NPR',          'category': 'News'     },
    { 'url': 'https://feeds.npr.org/1128/rss.xml',                             'source': 'NPR',          'category': 'Health'   },
    { 'url': 'https://feeds.npr.org/1007/rss.xml',                             'source': 'NPR',          'category': 'Science'  },
    # The Guardian
    { 'url': 'https://www.theguardian.com/world/rss',                          'source': 'The Guardian', 'category': 'World'    },
    { 'url': 'https://www.theguardian.com/politics/rss',                       'source': 'The Guardian', 'category': 'Politics' },
    { 'url': 'https://www.theguardian.com/science/rss',                        'source': 'The Guardian', 'category': 'Science'  },
    { 'url': 'https://www.theguardian.com/society/rss',                        'source': 'The Guardian', 'category': 'Health'   },
    # NASA
    { 'url': 'https://www.nasa.gov/rss/dyn/breaking_news.rss',                 'source': 'NASA',         'category': 'Science'  },
]

# ── HELPERS ───────────────────────────────────────────────────────────────────

def make_id(title):
    """Generate a unique story ID from the title."""
    return 'auto_' + hashlib.md5(title.encode()).hexdigest()[:8]

def now_iso():
    """Return current UTC time as ISO string."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')

def load_seen_ids(stories):
    """Collect all existing story IDs so we don't duplicate."""
    seen = set()
    seen.add(stories['hero']['id'])
    for group in ['stack', 'latest', 'world']:
        for s in stories.get(group, []):
            seen.add(s['id'])
    for cat_stories in stories.get('categories', {}).values():
        for s in cat_stories:
            seen.add(s['id'])
    return seen

def fetch_rss_items():
    """Fetch all RSS feeds and return a flat list of raw items."""
    items = []
    for feed_config in FEEDS:
        try:
            print(f"  Fetching {feed_config['source']} ({feed_config['category']})...")
            feed = feedparser.parse(feed_config['url'])
            for entry in feed.entries[:3]:  # take up to 3 per feed
                title   = entry.get('title', '').strip()
                summary = entry.get('summary', entry.get('description', '')).strip()
                # Strip HTML tags from summary
                import re
                summary = re.sub(r'<[^>]+>', '', summary).strip()
                if title and summary and len(summary) > 80:
                    items.append({
                        'title':    title,
                        'summary':  summary[:1200],  # cap input length
                        'source':   feed_config['source'],
                        'category': feed_config['category'],
                        'id':       make_id(title),
                    })
        except Exception as e:
            print(f"  ⚠ Could not fetch {feed_config['url']}: {e}")
    return items

def rewrite_with_groq(item):
    """Use Groq to rewrite a raw RSS item into a full Verum article."""
    client = Groq(api_key=GROQ_API_KEY)

    prompt = f"""You are a journalist for Verum, a no-nonsense news site with the tagline "The truth for all."
Verum reports facts clearly and concisely — no sensationalism, no opinion, no fluff.

Rewrite the following news item as a short Verum article with 3–4 paragraphs.
- Write in plain, clear language
- Stick strictly to the facts given
- Do not add opinions or speculation
- Do not mention the original source by name in the article body
- Keep it under 250 words

Source headline: {item['title']}
Source summary: {item['summary']}

Return ONLY the article body text. Separate paragraphs with a blank line. No headline, no byline."""

    try:
        response = client.chat.completions.create(
            model='llama3-8b-8192',
            messages=[{'role': 'user', 'content': prompt}],
            max_tokens=600,
            temperature=0.4,
        )
        content = response.choices[0].message.content.strip()
        return content
    except Exception as e:
        print(f"  ⚠ Groq error for '{item['title']}': {e}")
        return None

def build_story(item, content):
    """Build a full story object for stories.json."""
    return {
        'id':       item['id'],
        'title':    item['title'],
        'category': item['category'],
        'author':   item['source'],
        'time':     now_iso(),
        'read':     '3 min read',
        'image':    f"images/{item['id']}.jpg",
        'content':  content,
    }

def inject_stories(stories, new_stories):
    """
    Inject new stories into stories.json:
    - First new story → hero
    - Next 3 → latest (shift old ones to category bank)
    - Rest → category bank
    """
    if not new_stories:
        return stories

    # Ensure categories dict exists
    if 'categories' not in stories:
        stories['categories'] = {c: [] for c in ['News','World','Politics','Sports','Health','Science']}

    for i, story in enumerate(new_stories):
        cat = story['category']

        if i == 0:
            # Promote current hero to category bank
            old_hero = stories['hero']
            _add_to_bank(stories, old_hero)
            stories['hero'] = story
            print(f"  → Hero: {story['title'][:60]}")

        elif i <= 3 and len(stories.get('latest', [])) > 0:
            # Shift oldest latest story to bank, prepend new one
            if len(stories['latest']) >= 6:
                old = stories['latest'].pop()
                _add_to_bank(stories, old)
            stories['latest'].insert(0, story)
            print(f"  → Latest: {story['title'][:60]}")

        else:
            # Add to category bank
            _add_to_bank(stories, story)
            print(f"  → {cat} bank: {story['title'][:60]}")

    return stories

def _add_to_bank(stories, story):
    """Add a story to its category bank, capping at 10."""
    cat = story.get('category', 'News')
    if cat not in stories['categories']:
        stories['categories'][cat] = []
    bank = stories['categories'][cat]
    bank.insert(0, story)
    if len(bank) > 10:
        bank.pop()

def deploy_to_netlify(stories):
    """Trigger a Netlify deploy by updating stories.json via the API."""
    print("\n📡 Deploying to Netlify...")

    url = f'https://api.netlify.com/api/v1/sites/{NETLIFY_SITE_ID}/files/stories.json'
    headers = {
        'Authorization': f'Bearer {NETLIFY_AUTH_TOKEN}',
        'Content-Type':  'application/octet-stream',
    }
    data = json.dumps(stories, indent=2).encode('utf-8')

    try:
        res = requests.put(url, headers=headers, data=data)
        if res.status_code in (200, 201):
            print('✅ stories.json updated on Netlify successfully')
            return True
        else:
            print(f'⚠ Netlify API returned {res.status_code}: {res.text[:200]}')
            # Fallback: trigger a new deploy
            deploy_url = f'https://api.netlify.com/api/v1/sites/{NETLIFY_SITE_ID}/deploys'
            res2 = requests.post(deploy_url, headers={'Authorization': f'Bearer {NETLIFY_AUTH_TOKEN}'})
            print(f'  Fallback deploy trigger: {res2.status_code}')
            return res2.status_code in (200, 201)
    except Exception as e:
        print(f'⚠ Deploy error: {e}')
        return False

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    print('=' * 60)
    print('VERUM AUTO PUBLISHER')
    print(f'Started: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print('=' * 60)

    # Load existing stories
    print('\n📂 Loading stories.json...')
    with open(STORIES_FILE) as f:
        stories = json.load(f)
    seen_ids = load_seen_ids(stories)
    print(f'  Existing story IDs: {len(seen_ids)}')

    # Fetch RSS
    print('\n📡 Fetching RSS feeds...')
    rss_items = fetch_rss_items()
    print(f'  Total raw items fetched: {len(rss_items)}')

    # Filter out already-seen stories
    new_items = [item for item in rss_items if item['id'] not in seen_ids]
    random.shuffle(new_items)  # mix sources for variety
    new_items = new_items[:MAX_NEW_STORIES]
    print(f'  New stories to process: {len(new_items)}')

    if not new_items:
        print('\n✅ No new stories found. Site is up to date.')
        return

    # Rewrite with Groq
    print('\n✍  Rewriting with Groq AI...')
    new_stories = []
    for item in new_items:
        print(f'  Processing: {item["title"][:60]}...')
        content = rewrite_with_groq(item)
        if content:
            story = build_story(item, content)
            new_stories.append(story)
            print(f'  ✓ Done')
        else:
            print(f'  ✗ Skipped (AI error)')

    print(f'\n  Successfully written: {len(new_stories)} stories')

    # Inject into stories.json
    print('\n📝 Updating stories.json...')
    stories = inject_stories(stories, new_stories)

    # Save locally
    with open(STORIES_FILE, 'w') as f:
        json.dump(stories, f, indent=2)
    print('  ✓ stories.json saved locally')

    # Deploy to Netlify
    deploy_to_netlify(stories)

    print('\n' + '=' * 60)
    print(f'DONE — {len(new_stories)} new stories published to Verum')
    print('=' * 60)

if __name__ == '__main__':
    main()
