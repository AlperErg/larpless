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

export function greeting(now: number): string {
  const h = new Date(now).getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
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
