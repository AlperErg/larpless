import { create } from 'zustand';
import type { ScreenModelSetupState, ScreenModelSetupStore } from '../contracts/store';
import { SCREEN_MODEL_BYTES, SCREEN_MODEL_FILES } from '../core/screenModel';
import { native } from '../native';

export const initialScreenModelState: ScreenModelSetupState = { status: null, download: { status: 'idle' } };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useScreenModelStore = create<ScreenModelSetupStore>()((set, get) => ({
  ...initialScreenModelState,

  async refresh() {
    try {
      set({ status: await native.screenModel.status(SCREEN_MODEL_FILES) });
    } catch (e) {
      console.warn('[screen model] status failed:', errorText(e));
    }
  },

  async downloadModels() {
    if (get().download.status === 'pulling') return;
    // Bytes of files already on disk count as done, so the bar starts where it is.
    const missing = new Set(get().status?.missing ?? SCREEN_MODEL_FILES.map((f) => f.name));
    const doneBefore = SCREEN_MODEL_FILES.filter((f) => !missing.has(f.name)).reduce((n, f) => n + f.size, 0);
    const finished = new Map<string, number>();
    set({ download: { status: 'pulling', completed: doneBefore, total: SCREEN_MODEL_BYTES } });
    // Native code emits at most every 250 ms per file; the bar sums the bytes over all files.
    const unsubscribe = native.screenModel.onProgress((p) => {
      finished.set(p.name, p.receivedBytes);
      const completed = doneBefore + [...finished.values()].reduce((a, b) => a + b, 0);
      set({ download: { status: 'pulling', completed: Math.min(completed, SCREEN_MODEL_BYTES), total: SCREEN_MODEL_BYTES } });
    });
    try {
      await native.screenModel.download(SCREEN_MODEL_FILES);
      set({ download: { status: 'done' } });
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      set({ download: code === 'E_CANCELLED' ? { status: 'idle' } : { status: 'error', message: errorText(e) } });
    } finally {
      unsubscribe();
      await get().refresh();
    }
  },

  cancelDownload() {
    native.screenModel.cancelDownload().catch(() => {});
  },
}));
