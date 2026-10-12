import type { AppShellApi } from '../../contracts/native';

export const mockAppShell: AppShellApi = {
  beginSessionActivity: () => {
    console.log('[mock appShell] beginSessionActivity');
  },
  endSessionActivity: () => {
    console.log('[mock appShell] endSessionActivity');
  },
  bringToFront: () => {
    console.log('[mock appShell] bringToFront');
  },
  stopOllama: () => {
    console.log('[mock appShell] stopOllama');
  },
  onMenuCommand: () => () => {},
  onSystemSleep: () => () => {},
};
