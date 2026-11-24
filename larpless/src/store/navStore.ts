import { create } from 'zustand';

export type Route =
  | 'onboarding'
  | 'home'
  | 'session'
  | 'summary'
  | 'history'
  | 'modules'
  | 'settings'
  | 'acknowledgements'
  | 'dev'
  | 'feed'
  | 'profile'
  | 'login'; // last three: Phase 2

export interface NavParams {
  sessionId?: string;
  /** Signed-out Friends screen. Cleared once an account is signed in. */
  auth?: 'signIn' | 'signUp';
}

export interface NavState {
  route: Route;
  params: NavParams;
  paletteOpen: boolean;
  /** Closing/quitting during a session saves it first (#74): this shows "Saving your session…" meanwhile. */
  savingOnQuit: boolean;
  go(r: Route, p?: NavParams): void;
  setPaletteOpen(o: boolean): void;
  setSavingOnQuit(o: boolean): void;
}

export const useNavStore = create<NavState>()((set) => ({
  route: 'home',
  params: {},
  paletteOpen: false,
  savingOnQuit: false,
  go: (route, params = {}) => set({ route, params }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSavingOnQuit: (savingOnQuit) => set({ savingOnQuit }),
}));
