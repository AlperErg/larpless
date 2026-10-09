import { NativeModules } from 'react-native';
import type { SoundApi } from '../contracts/native';

const M = NativeModules.FLSound;

export const sound: SoundApi = {
  play: (id, fadeMs = 400) => M.play(id, fadeMs),
  setVolume: (v) => M.setVolume(v),
  duck: (factor, fadeMs = 400) => M.duck(factor, fadeMs),
  chime: (kind) => M.chime(kind),
};
