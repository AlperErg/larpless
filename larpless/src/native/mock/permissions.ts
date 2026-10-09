import type { PermissionsApi } from '../../contracts/native';

export const mockPermissions: PermissionsApi = {
  status: async () => ({ screen: 'granted', camera: 'granted' }),
  request: async () => 'granted',
  openSettings: async (kind) => {
    console.log('[mock permissions] openSettings', kind);
  },
  relaunch: async () => {
    console.log('[mock permissions] relaunch');
  },
};
