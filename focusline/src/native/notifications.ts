import { NativeModules } from 'react-native';
import type { NotificationsApi } from '../contracts/native';

const M = NativeModules.FLNotifications;

export const notifications: NotificationsApi = {
  requestPermission: () => M.requestPermission(),
  /** Resolves even when the system refuses to show it (e.g. permission denied); the reason is NSLogged. */
  post: n => M.post(n),
};

export interface NotificationsDebugStatus {
  authorization:
    | 'authorized'
    | 'denied'
    | 'notDetermined'
    | 'provisional'
    | 'other';
  alertSetting: string;
  soundSetting: string;
  alertStyle: 'banner' | 'alert' | 'none';
  delegateInstalled: boolean;
  deliveredIds: string[];
  willPresentCount: number;
  lastPresentedId: string | null;
  clickedCount: number;
  appIsActive: boolean;
}

/** Dev-only helpers for HarnessB (not part of the contract). */
export const notificationsDebug = {
  available: (): boolean => !!M && typeof M.debugStatus === 'function',
  status: (): Promise<NotificationsDebugStatus> => M.debugStatus(),
  clear: (idPrefix: string): void => M.debugClear(idPrefix),
};
