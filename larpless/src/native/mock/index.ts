import type { NativeApis } from '../../contracts/native';
import { mockScreen } from './screen';
import { mockPermissions } from './permissions';
import { mockWebcam } from './webcam';
import { mockPanel } from './panel';
import { mockNotifications } from './notifications';
import { mockSound } from './sound';
import { mockAppShell } from './appShell';
import { mockNowPlaying } from './nowPlaying';
import { mockOllamaHost } from './ollamaHost';
import { mockKeychain } from './keychain';
import { mockScreenModel } from './screenModel';

export const mockApis: NativeApis = {
  screen: mockScreen,
  screenModel: mockScreenModel,
  permissions: mockPermissions,
  webcam: mockWebcam,
  panel: mockPanel,
  notifications: mockNotifications,
  sound: mockSound,
  appShell: mockAppShell,
  nowPlaying: mockNowPlaying,
  ollamaHost: mockOllamaHost,
  keychain: mockKeychain,
};
