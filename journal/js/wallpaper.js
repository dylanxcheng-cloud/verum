/**
 * wallpaper.js — reminder option 2: render today's habits and upcoming
 * events into a lock-screen wallpaper image (Canvas → PNG).
 */
import { addDays, formatTime, fromKey, relativeLabel, todayKey } from './dates.js';
import { habitsForDay, isDone } from './habits.js';
import { occurrencesBetween } from './recur.js';

export const PRESETS = [
  { id: 'iphone-6.1', name: 'iPhone 6.1" (15 / 16)', w: 1179, h: 2556 },
  { id: 'iphone-6.7', name: 'iPhone 6.7" (Plus / Pro Max)', w: 1290, h: 2796 },
  { id: 'iphone-se', name: 'iPhone SE', w: 750, h: 1334 },
  { id: 'android-fhd', name: 'Android 1080 × 2400', w: 1080, h: 2400 },
  { id: 'pixel-pro', name: 'Pixel Pro 1344 × 2992', w: 1344, h: 2992 },
  { id: 'tablet', name: 'Tablet 1640 × 2360', w: 1640, h: 2360 },
  { id: 'desktop', name: 'Desktop 2560 × 1440', w: 2560, h: 1440 },
];

const THEMES = {
  dark: { bg1: '#0f1020', bg2: '#1c1e3a', text: '#f5f5fa', muted: 'rgba(245,245,250,0.6)', card: 'rgba(255,255,255,0.07)' },
  light: { bg1: '#f6f5ff', bg2: '#e4e0ff', text: '#17172b', muted: 'rgba(23,23,43,0.6)', card: 'rgba(23,23,43,0.06)' },
  forest: { bg1: '#0b1a14', bg2: '#173b2b', text: '#f0fff6', muted: 'rgba(240,255,246,0.6)', card: 'rgba(255,255,255,0.07)' },
  sunset: { bg1: '#2a0f2a', bg2: '#6b2d3c', text: '#fff4ec', muted: 'rgba(255,244,236,0.65)', card: 'rgba(255,255,255,0.08)' },
};
export const THEME_IDS = Object.keys(THEMES);

/** Collect what should appear on the wallpaper. */
export function wallpaperContent(state, opts) {
  const today = todayKey();
  const habits = habitsForDay(state.habits, today).map((h) => ({
    ...h,
    done: isDone(state.habitLog, h.id, today),
  }));
  const to = addDays(today, Math.max(1, opts.days || 7) - 1);
  const events = [];
  for (const ev of state.events) {
    const wp = ev.reminders && ev.reminders.wallpaper;
    if (!wp || !wp.enabled) continue;
    for (const key of occurrencesBetween(ev, today, to)) {
      if (ev.completed && ev.completed[key]) continue;
      events.push({ ev, key });
    }
  }
  events.sort((a, b) => (a.key + (a.ev.time || '')).localeCompare(b.key + (b.ev.time || '')));
  return { today, habits, events };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/**
 * Render into `canvas`. `opts` = state.settings.wallpaper (+ overrides).
 * Returns the content used, so the UI can say "3 habits, 4 events".
 */
export function render(canvas, state, opts) {
  const preset = PRESETS.find((p) => p.id === opts.preset) || PRESETS[0];
  const W = opts.width || preset.w;
  const H = opts.height || preset.h;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const t = THEMES[opts.theme] || THEMES.dark;
  const accent = opts.accent || '#1a73e8';
  const u = Math.min(W, H) / 1080; // scale unit
  const font = (px, weight = 400) => `${weight} ${Math.round(px * u)}px -apple-system, "SF Pro Text", Inter, Roboto, system-ui, sans-serif`;

  // Background
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, t.bg1);
  g.addColorStop(1, t.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Soft accent glow
  const glow = ctx.createRadialGradient(W * 0.8, H * 0.15, 0, W * 0.8, H * 0.15, W * 0.8);
  glow.addColorStop(0, hexToRgba(accent, 0.35));
  glow.addColorStop(1, hexToRgba(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const content = wallpaperContent(state, opts);
  const margin = 72 * u;
  const contentW = W - margin * 2;
  let y = H * ((Number(opts.topOffset) || 30) / 100);
  const bottomLimit = H - 200 * u; // leave room for the lock-screen controls

  // Date header
  ctx.fillStyle = t.muted;
  ctx.font = font(30, 600);
  ctx.textBaseline = 'top';
  ctx.fillText(fromKey(content.today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase(), margin, y);
  y += 60 * u;

  if (opts.showHabits !== false) {
    const done = content.habits.filter((h) => h.done).length;
    ctx.fillStyle = t.text;
    ctx.font = font(52, 700);
    ctx.fillText('Today', margin, y);
    ctx.font = font(30, 500);
    ctx.fillStyle = t.muted;
    const label = content.habits.length ? `${done}/${content.habits.length} done` : 'No habits yet';
    ctx.fillText(label, margin + contentW - ctx.measureText(label).width, y + 20 * u);
    y += 80 * u;

    // Progress bar
    roundRect(ctx, margin, y, contentW, 12 * u, 6 * u);
    ctx.fillStyle = t.card;
    ctx.fill();
    if (content.habits.length) {
      roundRect(ctx, margin, y, contentW * (done / content.habits.length), 12 * u, 6 * u);
      ctx.fillStyle = accent;
      ctx.fill();
    }
    y += 40 * u;

    const rowH = 64 * u;
    for (const h of content.habits) {
      if (y + rowH > bottomLimit) break;
      // checkbox
      roundRect(ctx, margin, y + 8 * u, 40 * u, 40 * u, 10 * u);
      ctx.fillStyle = h.done ? accent : t.card;
      ctx.fill();
      if (h.done) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 5 * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(margin + 11 * u, y + 28 * u);
        ctx.lineTo(margin + 18 * u, y + 36 * u);
        ctx.lineTo(margin + 30 * u, y + 18 * u);
        ctx.stroke();
      }
      ctx.fillStyle = h.done ? t.muted : t.text;
      ctx.font = font(36, 500);
      ctx.fillText(ellipsize(ctx, `${h.emoji ? h.emoji + ' ' : ''}${h.name}`, contentW - 70 * u), margin + 60 * u, y + 8 * u);
      y += rowH;
    }
    y += 40 * u;
  }

  if (opts.showEvents !== false && y < bottomLimit - 120 * u) {
    ctx.fillStyle = t.text;
    ctx.font = font(52, 700);
    ctx.fillText('Coming up', margin, y);
    y += 80 * u;
    if (!content.events.length) {
      ctx.fillStyle = t.muted;
      ctx.font = font(32, 400);
      ctx.fillText('Nothing scheduled — enjoy the quiet.', margin, y);
      y += 60 * u;
    }
    let lastKey = null;
    for (const { ev, key } of content.events) {
      const rowH = 92 * u;
      if (y + rowH > bottomLimit) break;
      if (key !== lastKey) {
        ctx.fillStyle = accent;
        ctx.font = font(26, 700);
        ctx.fillText(relativeLabel(key, content.today).toUpperCase(), margin, y);
        y += 40 * u;
        lastKey = key;
      }
      roundRect(ctx, margin, y, contentW, 76 * u, 18 * u);
      ctx.fillStyle = t.card;
      ctx.fill();
      ctx.fillStyle = t.text;
      ctx.font = font(34, 600);
      const timeText = formatTime(ev.time);
      ctx.font = font(28, 500);
      const tw = ctx.measureText(timeText).width;
      ctx.fillStyle = t.muted;
      ctx.fillText(timeText, margin + contentW - tw - 24 * u, y + 24 * u);
      ctx.fillStyle = t.text;
      ctx.font = font(34, 600);
      const title = ev.from ? `${ev.title} · ${ev.from}` : ev.title;
      ctx.fillText(ellipsize(ctx, title, contentW - tw - 70 * u), margin + 24 * u, y + 20 * u);
      y += rowH;
    }
  }

  if (opts.showJournalPrompt !== false && y < bottomLimit - 60 * u) {
    ctx.fillStyle = t.muted;
    ctx.font = font(26, 400);
    ctx.fillText(ellipsize(ctx, journalPrompt(state), contentW), margin, bottomLimit - 40 * u);
  }

  // Footer stamp
  ctx.fillStyle = t.muted;
  ctx.font = font(20, 500);
  const stamp = 'Updated ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  ctx.fillText(stamp, W - margin - ctx.measureText(stamp).width, H - 120 * u);

  return content;
}

function journalPrompt(state) {
  const today = todayKey();
  const entry = state.journal[today];
  if (entry && entry.text) return '“' + entry.text.split('\n')[0].slice(0, 80) + '”';
  const prompts = [
    'What would make today a good day?',
    'One thing you are grateful for today.',
    'What is the smallest step you can take right now?',
    'Who could you check in on today?',
  ];
  return prompts[fromKey(today).getDate() % prompts.length];
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function download(canvas, filename = `daybook-wallpaper-${todayKey()}.png`) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}
