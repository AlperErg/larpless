import type { ScreenModelApi, ScreenModelProgress, ScreenModelScores } from '../../contracts/native';

/**
 * In-memory FLScreenModel. Starts "not installed", so the classifier keeps using Ollama unless a test (or the
 * dev mock) calls download() or setScores(). download() fakes progress without any network.
 */
let installed = false;
let scores: Omit<ScreenModelScores, 'capturedAt'> | null = null;
const listeners = new Set<(p: ScreenModelProgress) => void>();

export const mockScreenModel: ScreenModelApi & {
  setInstalled(v: boolean): void;
  setScores(s: Omit<ScreenModelScores, 'capturedAt'> | null): void;
} = {
  setInstalled(v) {
    installed = v;
  },
  setScores(s) {
    scores = s;
  },
  status: async (files) => ({
    supported: true,
    installed,
    missing: installed ? [] : files.map((f) => f.name),
    loaded: false,
  }),
  download: async (files) => {
    files.forEach((f, i) => {
      listeners.forEach((cb) => cb({ name: f.name, receivedBytes: f.size, totalBytes: f.size, fileIndex: i, fileCount: files.length }));
    });
    installed = true;
  },
  cancelDownload: async () => {},
  onProgress: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  classify: async () => {
    if (!installed || !scores) throw Object.assign(new Error('not installed'), { code: 'E_NOT_INSTALLED' });
    return { ...scores, capturedAt: Date.now() };
  },
  unload: async () => {},
};
