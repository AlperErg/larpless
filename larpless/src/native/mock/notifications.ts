import type { NotificationsApi } from '../../contracts/native';

export const mockNotifications: NotificationsApi = {
  requestPermission: async () => 'granted',
  post: async (n) => {
    console.log('[mock notifications] post', n.id, n.title);
  },
};
