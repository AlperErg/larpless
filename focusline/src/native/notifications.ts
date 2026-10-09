import { NativeModules } from 'react-native';
import type { NotificationsApi } from '../contracts/native';

const M = NativeModules.FLNotifications;

export const notifications: NotificationsApi = {
  requestPermission: () => M.requestPermission(),
  post: (n) => M.post(n),
};
