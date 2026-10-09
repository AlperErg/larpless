/**
 * Pure UI derivations from store data (no react-native imports, Jest-friendly).
 * Core (WS-C) owns the authoritative summary maths; these only shape data for display.
 */
import { addDays, format, startOfDay, startOfWeek } from 'date-fns';
import type { BreakdownEntry, Chunk, SessionSummary, StudyModule, TagColor } from '../../contracts/domain';

export interface ModuleLook {
  name: string;
  color: TagColor;
}

/** Module name + colour. Unknown ids (deleted modules, fixtures without modules) degrade gracefully. */
export function lookModule(modules: StudyModule[], id: string | null | undefined): ModuleLook {
  if (!id) return { name: 'Unknown', color: 'gray' };
  const m = modules.find((x) => x.id === id);
  if (m) return { name: m.name, color: m.color };
  // e.g. "mod_biology" → "Biology" (readable ids); random ids → "Unknown subject".
  const tail = id.replace(/^mod_/, '');
  if (/^[a-z]{4,}$/i.test(tail) && !/\d/.test(tail)) {
    return { name: tail[0].toUpperCase() + tail.slice(1), color: 'gray' };
  }
  return { name: 'Unknown subject', color: 'gray' };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Live breakdown: per-module seconds + Distracted, pct of (subject + distracted). */
export function breakdownFromChunks(chunks: Chunk[], modules: StudyModule[]): BreakdownEntry[] {
  const per = new Map<string, number>();
  const order: string[] = [];
  let distracted = 0;
  for (const c of chunks) {
    if (c.kind === 'subject' && c.moduleId) {
      if (!per.has(c.moduleId)) order.push(c.moduleId);
      per.set(c.moduleId, (per.get(c.moduleId) ?? 0) + c.durationS);
    } else if (c.kind === 'distracted') {
      distracted += c.durationS;
    }
  }
  let denom = distracted;
  per.forEach((s) => {
    denom += s;
  });
  if (denom === 0) return [];
  const out: BreakdownEntry[] = order.map((id) => {
    const look = lookModule(modules, id);
    const seconds = per.get(id) ?? 0;
    return { key: id, label: look.name, color: look.color, seconds, pct: round1((seconds / denom) * 100) };
  });
  out.sort((a, b) => b.seconds - a.seconds);
  if (distracted > 0) {
    out.push({ key: 'distracted', label: 'Distracted', color: 'red', seconds: distracted, pct: round1((distracted / denom) * 100) });
  }
  return out;
}

/** Focus % = subject / (all − away − unknown). */
export function focusPctFromChunks(chunks: Chunk[]): number {
  let subject = 0;
  let counted = 0;
  for (const c of chunks) {
    if (c.kind === 'subject') subject += c.durationS;
    if (c.kind === 'subject' || c.kind === 'distracted') counted += c.durationS;
  }
  return counted ? Math.round((subject / counted) * 100) : 0;
}

/** Re-colour stored breakdown entries with the current module colours/names. */
export function relookBreakdown(entries: BreakdownEntry[], modules: StudyModule[]): BreakdownEntry[] {
  return entries.map((e) => {
    if (e.key === 'distracted') return e;
    const m = modules.find((x) => x.id === e.key);
    return m ? { ...e, label: m.name, color: m.color } : e;
  });
}

export interface ChunkLook {
  label: string;
  color: TagColor;
  emoji: string;
}

export function lookChunk(c: Pick<Chunk, 'kind' | 'moduleId' | 'reason'>, modules: StudyModule[]): ChunkLook {
  switch (c.kind) {
    case 'subject': {
      const m = lookModule(modules, c.moduleId);
      return { label: m.name, color: m.color, emoji: '📖' };
    }
    case 'distracted':
      return {
        label: 'Distracted',
        color: 'red',
        emoji: c.reason === 'phone' ? '📱' : '🚫',
      };
    case 'away':
      return { label: 'Away', color: 'gray', emoji: '🚶' };
    default:
      return { label: 'Unknown', color: 'gray', emoji: '❔' };
  }
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export const dayKey = (at: number) => format(at, 'yyyy-MM-dd');

/** Minutes studied per local day (keyed yyyy-MM-dd). */
export function minutesByDay(sessions: SessionSummary[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    out.set(k, (out.get(k) ?? 0) + s.totalS / 60);
  }
  return out;
}

/** Consecutive days ending today or yesterday with a session where totalS ≥ 15 min. */
export function streakDays(sessions: SessionSummary[], now: number): number {
  const qualifying = new Set(sessions.filter((s) => s.totalS >= 15 * 60).map((s) => dayKey(s.startedAt)));
  let day = startOfDay(now);
  if (!qualifying.has(dayKey(day.getTime()))) {
    day = addDays(day, -1);
    if (!qualifying.has(dayKey(day.getTime()))) return 0;
  }
  let n = 0;
  while (qualifying.has(dayKey(day.getTime()))) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}

export interface WeekGroup {
  key: string;
  weekStart: number;
  sessions: SessionSummary[];
  totalS: number;
}

/** Sessions grouped by ISO week (Monday start), newest week first. */
export function groupByWeek(sessions: SessionSummary[]): WeekGroup[] {
  const map = new Map<string, WeekGroup>();
  for (const s of sessions) {
    const ws = startOfWeek(s.startedAt, { weekStartsOn: 1 }).getTime();
    const k = dayKey(ws);
    let g = map.get(k);
    if (!g) {
      g = { key: k, weekStart: ws, sessions: [], totalS: 0 };
      map.set(k, g);
    }
    g.sessions.push(s);
    g.totalS += s.totalS;
  }
  const groups = Array.from(map.values()).sort((a, b) => b.weekStart - a.weekStart);
  groups.forEach((g) => g.sessions.sort((a, b) => b.startedAt - a.startedAt));
  return groups;
}

export interface SubjectTotal {
  key: string;
  label: string;
  color: TagColor;
  seconds: number;
}

/** Total seconds per subject across sessions (from each summary's breakdown), biggest first. */
export function totalsBySubject(sessions: SessionSummary[], modules: StudyModule[]): SubjectTotal[] {
  const map = new Map<string, SubjectTotal>();
  for (const s of sessions) {
    for (const e of s.breakdown) {
      if (e.key === 'distracted') continue;
      const m = modules.find((x) => x.id === e.key);
      const cur = map.get(e.key) ?? { key: e.key, label: m?.name ?? e.label, color: m?.color ?? e.color, seconds: 0 };
      cur.seconds += e.seconds;
      map.set(e.key, cur);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds);
}
