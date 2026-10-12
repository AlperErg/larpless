import type { FloatingPanelApi } from '../../contracts/native';

export const mockPanel: FloatingPanelApi = {
  show: async () => {
    console.log('[mock panel] show');
  },
  ensureVisible: async () => {
    console.log('[mock panel] ensureVisible');
  },
  hide: async () => {
    console.log('[mock panel] hide');
  },
  update: (state) => {
    console.log('[mock panel] update', state.status, state.title);
  },
  setColorScheme: () => {},
  onAction: () => () => {},
};
