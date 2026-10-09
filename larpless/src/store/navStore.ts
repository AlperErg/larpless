import { create } from 'zustand';

export type Route =
  | 'onboarding'
  | 'home'
  | 'session'
  | 'summary'
  | 'history'
  | 'modules'
  | 'settings'
  | 'dev'
  | 'feed'
  | 'profile'
  | 'login'; // last three: Phase 2

export interface NavParams {
  sessionId?: string;
}

export interface NavState {
  route: Route;
  params: NavParams;
  paletteOpen: boolean;
  go(r: Route, p?: NavParams): void;
  setPaletteOpen(o: boolean): void;
}

export const useNavStore = create<NavState>()((set) => ({
  route: 'home',
  params: {},
  paletteOpen: false,
  go: (route, params = {}) => set({ route, params }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
