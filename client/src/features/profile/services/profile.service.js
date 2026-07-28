import apiClient from '../../../services/apiClient';

export const meApi = {
  get: () => apiClient.get('/api/me').then((r) => r.data),
  update: (payload) => apiClient.patch('/api/me', payload).then((r) => r.data),
  changePassword: (current_password, new_password) =>
    apiClient.patch('/api/me/password', { current_password, new_password }).then((r) => r.data),
  getNotificationPrefs: () => apiClient.get('/api/me/notification-prefs').then((r) => r.data.prefs),
  updateNotifPrefs: (prefs) => apiClient.put('/api/me/notification-prefs', { prefs }).then((r) => r.data.prefs),
  regenerateToken: () => apiClient.post('/api/me/token/regenerate').then((r) => r.data),
  uploadAvatar: (file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return apiClient.post('/api/me/avatar', formData).then((r) => r.data);
  },
  removeAvatar: () => apiClient.delete('/api/me/avatar').then((r) => r.data),
};
