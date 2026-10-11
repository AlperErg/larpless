/**
 * Persistence over an injected key-value store (AsyncStorage in the app, a Map in tests).
 * Keys: CONTRACTS.md §8. Labels only: never images, never window titles.
 */
import { DEFAULT_SETTINGS } from '../config';
import { isPowerProfile } from './powerProfile';
import type { Chunk, SessionSummary, Settings, StudyModule } from '../contracts/domain';

export interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const KEYS = {
  modules: 'fl:modules',
  settings: 'fl:settings',
  sessions: 'fl:sessions',
  chunks: (sessionId: string) => `fl:chunks:${sessionId}`,
} as const;

export interface Db {
  loadModules(): Promise<StudyModule[]>;
  saveModules(m: StudyModule[]): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  /** Newest first. */
  listSessions(): Promise<SessionSummary[]>;
  /** Insert or replace by id; keeps the list newest first. */
  saveSession(s: SessionSummary): Promise<void>;
  /** Append (or replace by id) one chunk of a session. */
  appendChunk(c: Chunk): Promise<void>;
  getChunks(sessionId: string): Promise<Chunk[]>;
  /** Replace a stored chunk (matched by id). Returns false when it isn't stored. */
  updateChunk(c: Chunk): Promise<boolean>;
}

/** In-memory KeyValue (tests, fallback). */
export function createMemoryKv(map: Map<string, string> = new Map()): KeyValue & { map: Map<string, string> } {
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

/** Only the Chunk fields, so nothing else (e.g. a stray window title) is ever persisted. */
function cleanChunk(c: Chunk): Chunk {
  return {
    id: c.id,
    sessionId: c.sessionId,
    index: c.index,
    startedAt: c.startedAt,
    durationS: c.durationS,
    kind: c.kind,
    moduleId: c.moduleId,
    reason: c.reason,
    activity: c.activity,
    confidence: c.confidence,
    source: c.source,
    appName: c.appName,
  };
}

export function createDb(kv: KeyValue): Db {
  // Serialise read-modify-write operations so concurrent appends don't lose chunks.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function readJson<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await kv.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw) as unknown;
      return (v ?? fallback) as T;
    } catch {
      return fallback;
    }
  }
  const writeJson = (key: string, v: unknown) => kv.setItem(key, JSON.stringify(v));
  const readArray = async <T>(key: string): Promise<T[]> => {
    const v = await readJson<unknown>(key, []);
    return Array.isArray(v) ? (v as T[]) : [];
  };

  return {
    loadModules: () => readArray<StudyModule>(KEYS.modules),
    saveModules: (m) => serial(() => writeJson(KEYS.modules, m)),

    async loadSettings() {
      const s = await readJson<unknown>(KEYS.settings, {});
      const merged = { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' && !Array.isArray(s) ? (s as Partial<Settings>) : {}) };
      if (!isPowerProfile(merged.powerProfile)) merged.powerProfile = DEFAULT_SETTINGS.powerProfile;
      return merged;
    },
    saveSettings: (s) =>
      serial(() => {
        const powerProfile = isPowerProfile(s.powerProfile) ? s.powerProfile : DEFAULT_SETTINGS.powerProfile;
        return writeJson(KEYS.settings, { ...s, powerProfile });
      }),

    listSessions: () => readArray<SessionSummary>(KEYS.sessions),
    saveSession: (s) =>
      serial(async () => {
        const list = (await readArray<SessionSummary>(KEYS.sessions)).filter((x) => x.id !== s.id);
        list.push(s);
        list.sort((a, b) => b.startedAt - a.startedAt);
        await writeJson(KEYS.sessions, list);
      }),

    appendChunk: (c) =>
      serial(async () => {
        const key = KEYS.chunks(c.sessionId);
        const list = (await readArray<Chunk>(key)).filter((x) => x.id !== c.id);
        list.push(cleanChunk(c));
        list.sort((a, b) => a.index - b.index);
        await writeJson(key, list);
      }),
    getChunks: (sessionId) => readArray<Chunk>(KEYS.chunks(sessionId)),
    updateChunk: (c) =>
      serial(async () => {
        const key = KEYS.chunks(c.sessionId);
        const list = await readArray<Chunk>(key);
        const i = list.findIndex((x) => x.id === c.id);
        if (i < 0) return false;
        list[i] = cleanChunk(c);
        await writeJson(key, list);
        return true;
      }),
  };
}
