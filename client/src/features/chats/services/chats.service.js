import apiClient from '../../../services/apiClient';
import { mapCannedResponse, mapResolveCategory } from '../../../utils/templateMappers';

export const conversationsApi = {
  list: () => apiClient.get('/api/conversations').then((r) => r.data),
  getContact: (contactId) => apiClient.get(`/api/contacts/${contactId}`).then((r) => r.data),
  prevConversations: (contactId, excludeId) =>
    apiClient.get(`/api/contacts/${contactId}/conversations`, { params: { exclude: excludeId } }).then((r) => r.data),
  messages: (id) => apiClient.get(`/api/conversations/${id}/messages`).then((r) => r.data),
  reply: (id, text) => apiClient.post(`/api/conversations/${id}/reply`, { text }).then((r) => r.data),
  replyMedia: (id, file, clientId, caption = '') => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    if (caption) formData.append('caption', caption);
    formData.append('clientId', clientId);
    // مهم: من غير Content-Type يدوي عشان المتصفح يحط الـ multipart boundary لوحده
    return apiClient.post(`/api/conversations/${id}/reply-media`, formData).then((r) => r.data);
  },
  addNote: (id, text) => apiClient.post(`/api/conversations/${id}/notes`, { text }).then((r) => r.data),
  assign: (id, agentId) => apiClient.post(`/api/conversations/${id}/assign`, agentId ? { agentId } : {}).then((r) => r.data),
  resolve: (id, category, notes) => apiClient.post(`/api/conversations/${id}/resolve`, { category, notes }).then((r) => r.data),
  reopen: (id) => apiClient.post(`/api/conversations/${id}/reopen`).then((r) => r.data),
  generateReply: (id) => apiClient.post(`/api/conversations/${id}/generate-reply`),

  getLabels: (id) => apiClient.get(`/api/conversations/${id}/labels`).then((r) => r.data),
  addLabel: (id, labelId) => apiClient.post(`/api/conversations/${id}/labels`, { labelId }).then((r) => r.data),
  removeLabel: (id, labelId) => apiClient.delete(`/api/conversations/${id}/labels/${labelId}`).then((r) => r.data),

  getTeams: (id) => apiClient.get(`/api/conversations/${id}/teams`).then((r) => r.data),
  addTeam: (id, teamId) => apiClient.post(`/api/conversations/${id}/teams`, { teamId }).then((r) => r.data),
  removeTeam: (id, teamId) => apiClient.delete(`/api/conversations/${id}/teams/${teamId}`).then((r) => r.data),

  // دمج رقم المحادثة الحالية مع كونتاكت موجود بالفعل (العميل بعت من رقم جديد
  // والإيجنت عرفه إنه نفس عميل قديم)
  linkContact: (id, contactId) => apiClient.post(`/api/conversations/${id}/contact`, { mode: 'link', contactId }).then((r) => r.data),
};

export const labelsApi = {
  list: () => apiClient.get('/api/labels').then((r) => r.data),
  create: (payload) => apiClient.post('/api/labels', payload).then((r) => r.data),
};

export const teamsApi = {
  list: () => apiClient.get('/api/teams').then((r) => r.data),
};

export const agentsApi = {
  list: () => apiClient.get('/api/inboxes-available-agents').then((r) => r.data),
};

export const cannedResponsesApi = {
  list: () => apiClient.get('/api/canned-responses').then((r) => r.data.map(mapCannedResponse)),
};

export const resolveCategoriesApi = {
  list: () => apiClient.get('/api/resolve-categories').then((r) => r.data.map(mapResolveCategory)),
};
