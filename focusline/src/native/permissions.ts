import { NativeModules } from 'react-native';
import type { PermissionsApi } from '../contracts/native';

const M = NativeModules.FLPermissions;

export const permissions: PermissionsApi = {
  status: () => M.status(),
  request: (kind) => M.request(kind),
  openSettings: (kind) => M.openSettings(kind),
  relaunch: () => M.relaunch(),
};
