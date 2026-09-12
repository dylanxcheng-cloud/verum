# Daybook — habits, journal & the things people ask you to do

A small journaling web app that lives at `/journal/` on the Verum site. No build step, no backend, no
dependencies: plain HTML, CSS and ES modules, installable as a Progressive Web App (PWA).

**Open it:** `journal/index.html` (serve the repo root; e.g. `python3 -m http.server` then
<http://localhost:8000/journal/>). Any static host works, including the existing Netlify deploy.

## What it does

| Area | Details |
| --- | --- |
| **Daily habits** | Add as many as you like, pick which weekdays each applies to, tick them off per day. Streaks only count scheduled days; a 7-day grid and a 30-day completion rate per habit; archive instead of delete to keep history. |
| **Journal** | One entry per day with a mood, autosaved as you type. Browse back and forth through days. |
| **Events** | "Someone asked me to…" items with who asked, notes, date and optional time. One-time, or repeating daily / weekly (pick weekdays) / monthly / yearly, with an "every N" interval and optional end date. Mark each occurrence done, or skip a single occurrence of a repeating event. |
| **Reminder 1 · Notification** | Calendar-style alert with a lead time (at time, 5 min … 1 week before). Plus an optional daily habit nudge listing what's still open. |
| **Reminder 2 · Wallpaper** | Renders today's habits, upcoming events and your journal line into a lock-screen PNG sized for common phones (iPhone 6.1"/6.7"/SE, Android FHD+, Pixel Pro, tablet, desktop). Four styles, custom accent, adjustable clear space for the clock. |
| **Reminder 3 · Widget** | `widget.html` is a stripped-down live view (small/medium/large, light/dark). Add it to the home screen as its own icon, keep it in a browser side panel, or embed it with an iframe. Ticking a habit in the widget updates the app. |
| **Also** | Add-to-calendar (.ics with RRULE + VALARM) per event, offline support via service worker, JSON export/import, light/dark/system theme. |

## Layout

```
journal/
  index.html            the app (5 views: Today · Habits · Events · Reminders · Settings)
  widget.html           glanceable widget view
  manifest.webmanifest  PWA manifest (installable, shortcuts)
  sw.js                 offline cache + notification click / push handlers
  css/app.css
  js/
    store.js      single JSON state document in localStorage; export/import; cross-tab sync
    dates.js      local-date helpers (YYYY-MM-DD keys)
    recur.js      recurrence engine (occursOn / occurrencesBetween / nextOccurrence)
    habits.js     scheduling, streaks, completion stats
    reminders.js  lead-time math + in-page notification scheduler
    ics.js        iCalendar export
    wallpaper.js  Canvas renderer for lock-screen images
    widget.js     widget page logic
    app.js        UI
  tests/          node:test unit tests   →  node --test journal/tests/*.test.mjs
  tools/make-icons.mjs   regenerates the PNG icons (pure JS, no deps)
```

All state is one JSON object (`daybook.v1` in localStorage). That is deliberate: the same document can
later be synced to a backend or handed to a native shell unchanged.

## Honest limits of the web version

- **Notifications fire while the page or installed PWA is open.** Browsers can't run a timer for a
  closed tab. On iPhone, notifications only work at all after "Add to Home Screen". Background
  alerts today: use the per-event **Add to calendar** button so the phone's calendar app does it.
- **The wallpaper is a file you set manually.** Web pages cannot change a phone's wallpaper.
- **The widget is a page, not a system widget.** Home-screen widgets need native code.

## Roadmap: website → app

1. **Ship the PWA** (done here). Install prompt, offline, home-screen icon.
2. **Accounts + sync** — Supabase or Firebase; sync the single JSON document with last-write-wins,
   later per-record merge. Enables multi-device and the next step.
3. **Real push (closed-app notifications)** — Web Push (VAPID) from a small scheduled worker
   (Cloudflare Worker cron / Netlify scheduled function) that reads synced events and pushes at the
   lead time. `sw.js` already handles the `push` event. Works on Android and desktop; iOS 16.4+ when
   installed.
4. **Native shell with Capacitor** — wraps this exact codebase into iOS/Android apps and unlocks:
   - Local notifications scheduled by the OS (no server needed, fires when the app is closed).
   - **Automatic wallpaper** on Android (`WallpaperManager`); on iOS, a Shortcuts automation that
     pulls the generated image daily (Apple doesn't allow apps to set wallpaper directly).
   - **Real home-screen and lock-screen widgets** (WidgetKit / Jetpack Glance) reading the shared
     data document via an App Group / shared storage — `widget.js` is the spec for what they show.
5. **Store release** — App Store / Play listing, privacy labels, onboarding.

## Other reminder options worth adding

- **Add-to-calendar (.ics)** — already built; the cheapest way to get background reminders now.
- **Calendar subscription feed** — a per-user `webcal://` URL once sync exists, so every event and
  change appears in Apple/Google Calendar automatically.
- **Email / SMS digest** — a morning summary of habits + today's asks; trivially added to the
  scheduled worker in step 3, and works on every device with no permissions.
- **Messaging bots** — Telegram/WhatsApp/iMessage-via-Shortcuts nudges; also a fast way to *capture*
  an ask ("remind me Maria wants the report Friday 4pm").
- **Live Activities / Dynamic Island** (iOS) and **Always-on-display** widgets for the next event.
- **Location-based reminders** (native) — "when I get to the office".
- **Snooze / escalate** — re-notify if an occurrence is still undone after N minutes.
- **Share-sheet capture** — share a text or email into the app to create an event.
- **Natural-language entry** — parse "every other Tuesday at 7" into the recurrence rule.
- **Weekly review** — a Sunday journal prompt with streak stats and the week's completed asks.
