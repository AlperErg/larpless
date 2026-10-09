import { NativeModules, NativeEventEmitter } from 'react-native';
import type { AppShellApi } from '../contracts/native';

const M = NativeModules.FLAppShell;
const emitter = M ? new NativeEventEmitter(M) : null;

export const appShell: AppShellApi = {
  beginSessionActivity: () => M.beginSessionActivity(),
  endSessionActivity: () => M.endSessionActivity(),
  bringToFront: () => M.bringToFront(),
  onMenuCommand: cb => {
    const sub = emitter!.addListener('FLMenuCommand', cb);
    return () => sub.remove();
  },
};

export interface AppShellDebugInfo {
  activityActive: boolean;
  activityAgeS: number | null;
  menu: {
    title: string;
    key: string;
    command: string;
    enabled: boolean;
    cmdModifier: boolean;
  }[];
  jsListening: boolean;
  appIsActive: boolean;
  appIsHidden: boolean;
  mainWindowKey: boolean;
  mainWindowVisible: boolean;
}

/** Dev-only helpers for HarnessB (not part of the contract). */
export const appShellDebug = {
  available: (): boolean => !!M && typeof M.debugInfo === 'function',
  info: (): Promise<AppShellDebugInfo> => M.debugInfo(),
  /** Posts a synthesized ⌘+key keyDown to the app (the real key-equivalent path). */
  key: (
    key: 'k' | 'return' | 'period',
  ): Promise<{
    posted: boolean;
    mainWindowWasKey: boolean;
    appIsActive: boolean;
  }> => M.debugKey(key),
  /** Hide LarpLess (true) or unhide it without activating (false). */
  setHidden: (
    hidden: boolean,
  ): Promise<{ appIsHidden: boolean; appIsActive: boolean }> =>
    M.debugSetHidden(hidden),
};
