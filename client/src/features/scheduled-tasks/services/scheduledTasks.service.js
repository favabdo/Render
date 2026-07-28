import apiClient from '../../../services/apiClient';

export const scheduledTasksApi = {
  listAll: () => apiClient.get('/api/scheduled-tasks').then((r) => r.data),
  add: (contactId, taskText, dueDate, customerName) =>
    apiClient.post(`/api/contacts/${contactId}/scheduled-tasks`, { taskText, dueDate, customerName }).then((r) => r.data),
  end: (contactId, taskId) => apiClient.patch(`/api/contacts/${contactId}/scheduled-tasks/${taskId}/end`).then((r) => r.data),
};
