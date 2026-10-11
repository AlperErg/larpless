import { NativeModules } from 'react-native';
import type { NowPlayingApi } from '../contracts/native';

const M = NativeModules.FLNowPlaying;

export const nowPlaying: NowPlayingApi = {
  setEnabled: on => M.setEnabled(on),
};
