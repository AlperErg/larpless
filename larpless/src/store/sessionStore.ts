import { create } from 'zustand';
import { config, DEFAULT_SETTINGS } from '../config';
import type { SessionStore, SessionStoreState } from '../contracts/store';
import { createClassifier } from '../core/classifier';
import { createOllama } from '../core/ollama';
import { effectiveProfile } from '../core/powerProfile';
import { createSessionController } from '../core/sessionController';
import type { SessionController } from '../core/sessionController';
import { fixtureChunks } from '../fixtures/data';
import { native } from '../native';
import { appDb, upsertSessionSummary, useAppStore } from './appStore';
import { useOllamaStore } from './ollamaStore';
import { allSubjects } from '../core/subjectLibrary';

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

const settings = () => useAppStore.getState().settings;

let controller: SessionController | null = null;

/** The session controller behind the store actions (created on first use). */
export function getSessionController(): SessionController {
  if (!controller) {
    const ollama = createOllama({
      baseUrl: () => settings().ollamaUrl,
      model: () => settings().model,
      timeoutMs: config.CLASSIFY_TIMEOUT_MS,
    });
    const classifier = createClassifier({
      native,
      ollama,
      now: Date.now,
      config,
      getPower: () => effectiveProfile(settings().powerProfile),
    });
    controller = createSessionController({
      native,
      db: appDb,
      store: useSessionStore,
      getModules: () => allSubjects(useAppStore.getState().modules),
      getSettings: settings,
      classifier,
      ollama,
      now: Date.now,
      config,
      prepareOllama: () => useOllamaStore.getState().prepare({ launch: true }),
      onSessionSaved: upsertSessionSummary,
      demoChunks: fixtureChunks,
    });
  }
  return controller;
}

export const useSessionStore = create<SessionStore>()(() => ({
  ...initialSessionState,
  start: (opts) => getSessionController().start(opts),
  pause: () => getSessionController().pause(),
  resume: () => getSessionController().resume(),
  end: () => getSessionController().end(),
  relabelChunk: (chunkId, patch) => getSessionController().relabelChunk(chunkId, patch),
  setSound: (id) => getSessionController().setSound(id),
  setVolume: (v) => getSessionController().setVolume(v),
  togglePomodoro: () => getSessionController().togglePomodoro(),
  skipPomodoroPhase: () => getSessionController().skipPomodoroPhase(),
  refreshOllama: () => getSessionController().refreshOllama(),
}));

// A finished launch, restart or download changes what the health check reports (sidebar, settings).
useOllamaStore.subscribe((s, prev) => {
  const started = prev.starting && !s.starting;
  const pulled = prev.pull.status === 'pulling' && s.pull.status !== 'pulling';
  if (started || pulled) {
    useSessionStore
      .getState()
      .refreshOllama()
      .catch(() => {});
  }
});
