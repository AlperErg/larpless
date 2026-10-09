import type { SoundApi } from '../../contracts/native';

export const mockSound: SoundApi = {
  play: async (id) => {
    console.log('[mock sound] play', id);
  },
  setVolume: (v) => {
    console.log('[mock sound] setVolume', v);
  },
  duck: (factor) => {
    console.log('[mock sound] duck', factor);
  },
  chime: (kind) => {
    console.log('[mock sound] chime', kind);
  },
};
