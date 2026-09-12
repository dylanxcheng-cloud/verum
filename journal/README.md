# Daybook

A small journaling web app: daily habits, a journal, and the things people ask you to do, with three
ways to be reminded. It lives at `/journal/` on the Verum site. Plain HTML, CSS and ES modules; no build
step, no backend, no accounts. Everything stays on the device.

**Run it:** serve the repo root (`python3 -m http.server 8000`) and open <http://localhost:8000/journal/>.

## The idea

- **Habits** are things you do on repeat. Pick the weekdays, tick them off, keep a streak.
- **Journal** is one plain note per day, with a mood.
- **Events** are things someone asked you to do. Once, or repeating daily / weekly / monthly / yearly.
  Tick off each occurrence, or skip just one.
- **Every event can remind you three ways**, any mix:
  1. **Notification** before it happens (calendar-style lead time), plus an optional daily habit nudge.
  2. **Wallpaper**: a lock-screen image of today's habits and upcoming events, sized for your phone.
  3. **Widget**: a live one-glance page you add to the home screen.

Design: Google Calendar's schedule view (date circles, colored chips, blue accent, "+" button) for
events, and a Notes-style paper card and checklists for the journal and habits.

## Files

```
journal/
  index.html, widget.html, manifest.webmanifest, sw.js, css/app.css
  js/store.js      one JSON document in localStorage; export/import
  js/dates.js      date helpers      js/recur.js     recurrence engine
  js/habits.js     streaks           js/reminders.js notification scheduling
  js/ics.js        add-to-calendar   js/wallpaper.js canvas renderer
  js/app.js        UI                js/widget.js    widget page
  tests/           node --test journal/tests/*.test.mjs
  tools/make-icons.mjs
```

## What the web version can't do (and the workaround)

- Notifications fire only while Daybook is open (a tab or the installed app). For alerts when it's
  closed, press **.ics** on an event to drop it into the phone's calendar with the same alert.
- The wallpaper is an image you set yourself; web pages can't change a phone's wallpaper.
- The widget is a page, not a system widget.

## From website to app

Keep the same code and data. Wrap it with Capacitor to get what the browser can't give:
OS-scheduled notifications that fire when the app is closed, automatic wallpaper on Android, and
real home-screen widgets (iOS WidgetKit / Android Glance) reading the same JSON document.
No server, no accounts, no subscriptions needed for any of that.

## Other reminder ideas

- Add-to-calendar (built) and a snooze / "still not done" re-alert.
- A morning summary notification: today's habits and asks in one line.
- Share-sheet capture: share a text or email into Daybook to create an event.
- Natural-language entry: "every other Tuesday at 7".
- Weekly review prompt in the journal with the week's streaks and completed asks.
