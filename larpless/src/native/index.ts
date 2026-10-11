import { NativeModules } from 'react-native';
import { config } from '../config';
import type { NativeApis } from '../contracts/native';
import { screen } from './screen';
import { permissions } from './permissions';
import { webcam } from './webcam';
import { panel } from './panel';
import { notifications } from './notifications';
import { sound } from './sound';
import { appShell } from './appShell';
import { nowPlaying } from './nowPlaying';
import { mockApis } from './mock';

function pick<K extends keyof NativeApis>(key: K, moduleName: string, real: NativeApis[K]): NativeApis[K] {
  if (config.USE_MOCK_NATIVE) return mockApis[key];
  if (!NativeModules[moduleName]) {
    console.warn(`[native] ${moduleName} missing, using mock`);
    return mockApis[key];
  }
  return real;
}

export const native: NativeApis = {
  screen: pick('screen', 'FLScreenCapture', screen),
  permissions: pick('permissions', 'FLPermissions', permissions),
  webcam: pick('webcam', 'FLWebcam', webcam),
  panel: pick('panel', 'FLFloatingPanel', panel),
  notifications: pick('notifications', 'FLNotifications', notifications),
  sound: pick('sound', 'FLSound', sound),
  appShell: pick('appShell', 'FLAppShell', appShell),
  nowPlaying: pick('nowPlaying', 'FLNowPlaying', nowPlaying),
};
