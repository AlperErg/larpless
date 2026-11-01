import { NativeModules, NativeEventEmitter } from 'react-native';
import type { AppShellApi } from '../contracts/native';

const M = NativeModules.FLAppShell;
const emitter = M ? new NativeEventEmitter(M) : null;

export const appShell: AppShellApi = {
  beginSessionActivity: () => M.beginSessionActivity(),
  endSessionActivity: () => M.endSessionActivity(),
  bringToFront: () => M.bringToFront(),
  stopOllama: () => M.stopOllama?.(),
  onSystemSleep: cb => {
    const sub = emitter!.addListener('FLSystemSleep', cb);
    return () => sub.remove();
  },
  onMenuCommand: cb => {
    const sub = emitter!.addListener('FLMenuCommand', cb);
    return () => sub.remove();
  },
};
