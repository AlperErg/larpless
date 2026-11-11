/** Pure formatting helpers for the UI (no react-native imports, Jest-friendly). */
import { format, isToday, isYesterday } from 'date-fns';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** h:mm:ss, e.g. 0:15:10 / 1:02:03. */
export function formatClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad2(m)}:${pad2(s % 60)}`;
}

/** m:ss (or h:mm:ss above an hour), for countdowns. */
export function formatCountdown(totalS: number): string {
  const s = Math.max(0, Math.ceil(totalS));
  if (s >= 3600) return formatClock(s);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** Compact duration: "45s", "24m", "1h 12m", "2h". */
export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  if (s < 60) return `${s}s`;
  const totalM = Math.round(s / 60);
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Like formatDuration, but keeps the seconds under 10 minutes ("1m 30s"). Breakdown legends list many short
 * entries, and rounding each of them to whole minutes made the legend add up to more than the session.
 */
export function formatLegendDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  if (s < 60 || s >= 600 || s % 60 === 0) return formatDuration(s);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Hours with one decimal: "3.5 h". */
export function formatHours(totalS: number): string {
  const h = totalS / 3600;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} h`;
}

/** "12 s ago", "3 min ago", "just now". */
export function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 2) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ago`;
}

/** Openers per time of day: [first hour, lines]. The last band whose hour has passed is used. */
const GREETINGS: readonly (readonly [number, readonly string[]])[] = [
  [0, ['Burning the midnight oil', 'Up late', 'Still at it', 'The quiet hours']],
  [5, ['Good morning', 'Morning', 'Rise and shine', 'Early start']],
  [12, ['Good afternoon', 'Afternoon', 'Hope the day is going well']],
  [18, ['Good evening', 'Evening', 'Hope today went well']],
  [22, ['Good evening', 'Late one tonight', 'One more before bed']],
];

const GREETING_TAILS: readonly string[] = [
  'Ready when you are.',
  'What are we studying today?',
  'Pick a subject and go.',
  'One focused session at a time.',
  'Time for a good session.',
  'A session today keeps the streak going.',
  'Every streak starts with one session.',
  "Don't break the chain.",
  'Studying is easier with friends.',
  'Share LarpLess with a friend.',
  'Share your stats and see who keeps up.',
];

/** Extra closing lines for particular weekdays (0 = Sunday). */
const WEEKDAY_TAILS: Readonly<Record<number, string>> = {
  1: 'New week, clean slate.',
  5: 'One last push before the weekend.',
  0: 'A quiet Sunday session?',
};

function greetingBand(now: number): number {
  const h = new Date(now).getHours();
  let band = 0;
  GREETINGS.forEach(([from], i) => {
    if (h >= from) band = i;
  });
  return band;
}

/** Local calendar day as a count of days, going up by exactly one each day. */
function dayNumber(now: number): number {
  return Math.floor((now - new Date(now).getTimezoneOffset() * 60_000) / 86_400_000);
}

/**
 * Time-of-day opener, e.g. "Good morning". The line depends on the day, the time band and `visit`
 * (how many times Home has been opened), never on chance, so a re-render shows the same one.
 */
export function greeting(now: number, visit = 0): string {
  const band = greetingBand(now);
  const lines = GREETINGS[band][1];
  return lines[(dayNumber(now) + band + visit) % lines.length];
}

/**
 * Home subtitle: opener plus a closing line, e.g. "Good morning. Ready when you are."
 * Each `visit` moves on to the next opener and the next closing line.
 */
export function homeGreeting(now: number, streak = 0, visit = 0): string {
  const tails = [...GREETING_TAILS];
  const weekday = WEEKDAY_TAILS[new Date(now).getDay()];
  if (weekday) tails.push(weekday);
  if (streak >= 2) tails.push(`${streak}-day streak. Keep it going.`);
  // Steps by one line a day and per visit, so every line comes round whatever the pool size.
  const tail = tails[(dayNumber(now) + 2 * greetingBand(now) + visit) % tails.length];
  return `${greeting(now, visit)}. ${tail}`;
}

/** "Today", "Yesterday", or "Mon 6 Oct". */
export function formatDay(at: number): string {
  if (isToday(at)) return 'Today';
  if (isYesterday(at)) return 'Yesterday';
  return format(at, 'EEE d MMM');
}

/** "14:05". */
export function formatTime(at: number): string {
  return format(at, 'HH:mm');
}

/** "14:05:30". */
export function formatTimeS(at: number): string {
  return format(at, 'HH:mm:ss');
}

/** "Thursday 9 October 2026". */
export function formatLongDate(at: number): string {
  return format(at, 'EEEE d MMMM yyyy');
}

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Decimal units, as Ollama shows them: 3_295_612_832 → "3.3 GB", 41_200_000 → "41 MB". */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${Math.max(0, Math.round(n))} B`;
}
