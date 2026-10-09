import type { NativeApis } from '../../contracts/native';
import { mockScreen } from './screen';
import { mockPermissions } from './permissions';
import { mockWebcam } from './webcam';
import { mockPanel } from './panel';
import { mockNotifications } from './notifications';
import { mockSound } from './sound';
import { mockAppShell } from './appShell';

export const mockApis: NativeApis = {
  screen: mockScreen,
  permissions: mockPermissions,
  webcam: mockWebcam,
  panel: mockPanel,
  notifications: mockNotifications,
  sound: mockSound,
  appShell: mockAppShell,
};
