import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '../config';
import type { SessionSummary } from '../contracts/domain';
import type { AppDataState, AppStore } from '../contracts/store';
import { createDb } from '../core/db';
import type { KeyValue } from '../core/db';

export const initialAppState: AppDataState = {
  loaded: false,
  modules: [],
  settings: DEFAULT_SETTINGS,
  sessions: [],
};

/** The app's db: core/db over AsyncStorage (injected here, never imported by core). Labels only. */
export const appDb = createDb(AsyncStorage as unknown as KeyValue);

export const useAppStore = create<AppStore>()((set, get) => ({
  ...initialAppState,

  load: async () => {
    try {
      const [modules, settings, sessions] = await Promise.all([appDb.loadModules(), appDb.loadSettings(), appDb.listSessions()]);
      // Own courses are optional (the built-in subject library is always on), so onboarding doesn't depend on them.
      set({ loaded: true, modules, sessions, settings });
    } catch {
      console.warn('[appStore] load failed, using defaults');
      set({ loaded: true });
    }
  },

  saveModules: async (modules) => {
    set({ modules });
    await appDb.saveModules(modules);
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await appDb.saveSettings(settings);
  },

  getChunks: (sessionId) => appDb.getChunks(sessionId),
}));

/** Insert or replace a saved summary in the in-memory list (newest first). Used by the session store. */
export function upsertSessionSummary(summary: SessionSummary): void {
  const sessions = [summary, ...useAppStore.getState().sessions.filter((s) => s.id !== summary.id)];
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  useAppStore.setState({ sessions });
}
