import { NativeModules } from 'react-native';
import type { NotificationsApi } from '../contracts/native';

const M = NativeModules.FLNotifications;

export const notifications: NotificationsApi = {
  requestPermission: () => M.requestPermission(),
  /** Resolves even when the system refuses to show it (e.g. permission denied); the reason is NSLogged. */
  post: n => M.post(n),
};
