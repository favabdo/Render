import apiClient from '../../../services/apiClient';

export const notificationsApi = {
  list: () => apiClient.get('/api/notifications').then((r) => r.data.notifications || []),
  unreadCount: () => apiClient.get('/api/notifications/unread-count').then((r) => r.data.unread || 0),
  setStatus: (id, status) => apiClient.patch(`/api/notifications/${id}`, { status }).then((r) => r.data),
  markAllRead: () => apiClient.post('/api/notifications/mark-all-read').then((r) => r.data),
};
