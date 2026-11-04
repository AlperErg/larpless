import type { AppShellApi, HardwareInfo } from '../../contracts/native';

let hardware: HardwareInfo = { memoryBytes: 16 * 2 ** 30, appleSilicon: true, chip: 'Apple M2', gpu: null };

export const mockAppShell: AppShellApi & { setHardware(h: HardwareInfo): void } = {
  setHardware(h) {
    hardware = h;
  },
  hardware: async () => hardware,
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
