/**
 * Real size of the app's root view. On react-native-macos, Dimensions.get('window') reports the
 * screen, not the window, so App.tsx feeds this from the root view's onLayout.
 *
 * `emulate` (dev only) pins the root to a fixed size so layout can be checked headlessly at
 * 900×600 or 1440×900 without resizing the window: __FL.ui.viewport(900, 600).
 */
import { create } from 'zustand';

export interface ViewportState {
  w: number;
  h: number;
  emulate: { w: number; h: number } | null;
  setSize(w: number, h: number): void;
  setEmulate(e: { w: number; h: number } | null): void;
}

export const useViewport = create<ViewportState>()((set) => ({
  w: 1100,
  h: 720,
  emulate: null,
  setSize: (w, h) => set({ w, h }),
  setEmulate: (emulate) => set({ emulate }),
}));
