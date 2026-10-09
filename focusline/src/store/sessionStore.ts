import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '../config';
import type { SessionStore, SessionStoreState } from '../contracts/store';

export const initialSessionState: SessionStoreState = {
  status: 'idle',
  session: null,
  timer: { baseS: 0, runningSinceMs: null },
  chunks: [],
  current: null,
  webcam: { enabled: DEFAULT_SETTINGS.webcamEnabled, personPresent: true, phoneVisible: false },
  privacy: { framesAnalysed: 0, checksWithoutScreenshot: 0, framesStored: 0 },
  pomodoro: null,
  alert: { level: 0, distractedSinceMs: null },
  sound: { id: DEFAULT_SETTINGS.defaultSound, volume: DEFAULT_SETTINGS.volume },
  ollama: { status: 'unknown', model: DEFAULT_SETTINGS.model },
  lastSummary: null,
};

const notImplemented = (name: string) => console.log(`[sessionStore] ${name} (not implemented)`);

// Phase 0: initial state + no-op actions. WS-C wires these to core/sessionController.
export const useSessionStore = create<SessionStore>()(() => ({
  ...initialSessionState,
  start: async () => {
    notImplemented('start');
  },
  pause: () => {
    notImplemented('pause');
  },
  resume: () => {
    notImplemented('resume');
  },
  end: async () => {
    notImplemented('end');
    return null;
  },
  relabelChunk: async () => {
    notImplemented('relabelChunk');
  },
  setSound: () => {
    notImplemented('setSound');
  },
  setVolume: () => {
    notImplemented('setVolume');
  },
  togglePomodoro: () => {
    notImplemented('togglePomodoro');
  },
  skipPomodoroPhase: () => {
    notImplemented('skipPomodoroPhase');
  },
  refreshOllama: async () => {
    notImplemented('refreshOllama');
  },
}));
