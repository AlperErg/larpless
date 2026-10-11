import type { NowPlayingApi } from '../../contracts/native';

/**
 * Records the on/off flag only. The track title, artist and position stay in the
 * native panel process and are never returned here.
 */
export const mockNowPlaying: NowPlayingApi & { enabled: boolean } = {
  enabled: true,
  setEnabled(on: boolean) {
    this.enabled = on;
  },
};
