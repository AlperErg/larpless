import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '../config';
import type { AppDataState, AppStore } from '../contracts/store';

export const initialAppState: AppDataState = {
  loaded: false,
  modules: [],
  settings: DEFAULT_SETTINGS,
  sessions: [],
};

const notImplemented = (name: string) => console.log(`[appStore] ${name} (not implemented)`);

// Phase 0: initial state + no-op actions. WS-C implements them on top of core/db.
export const useAppStore = create<AppStore>()((set) => ({
  ...initialAppState,
  load: async () => {
    notImplemented('load');
    set({ loaded: true });
  },
  saveModules: async () => {
    notImplemented('saveModules');
  },
  updateSettings: async () => {
    notImplemented('updateSettings');
  },
  getChunks: async () => {
    notImplemented('getChunks');
    return [];
  },
}));
