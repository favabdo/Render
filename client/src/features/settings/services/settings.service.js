import apiClient from '../../../services/apiClient';

export const companyApi = {
  getSettings: () => apiClient.get('/api/company/settings').then((r) => r.data),
  updateSettings: (payload) => apiClient.patch('/api/company/settings', payload).then((r) => r.data),
  getAutomationSettings: () => apiClient.get('/api/company/automation-settings').then((r) => r.data),
  updateAutomationSettings: (payload) => apiClient.patch('/api/company/automation-settings', payload).then((r) => r.data),
};

export const agentsSettingsApi = {
  list: () => apiClient.get('/api/agents-list').then((r) => r.data),
  create: (payload) => apiClient.post('/api/users', payload).then((r) => r.data),
  update: (id, payload) => apiClient.patch(`/api/users/${id}`, payload).then((r) => r.data),
  remove: (id, password) => apiClient.delete(`/api/users/${id}`, { data: { password } }).then((r) => r.data),
};

export const labelsSettingsApi = {
  create: (payload) => apiClient.post('/api/labels', payload).then((r) => r.data),
  update: (id, payload) => apiClient.put(`/api/labels/${id}`, payload).then((r) => r.data),
  remove: (id) => apiClient.delete(`/api/labels/${id}`),
};

export const teamsApi = {
  list: () => apiClient.get('/api/teams').then((r) => r.data),
  create: (payload) => apiClient.post('/api/teams', payload).then((r) => r.data),
  update: (id, payload) => apiClient.put(`/api/teams/${id}`, payload).then((r) => r.data),
  remove: (id) => apiClient.delete(`/api/teams/${id}`).then((r) => r.data),
  getMembers: (id) => apiClient.get(`/api/teams/${id}/members`).then((r) => r.data),
  setMembers: (id, agentIds) => apiClient.post(`/api/teams/${id}/members`, { agentIds }).then((r) => r.data),
};

export const inboxesApi = {
  channels: () => apiClient.get('/api/inboxes/channels').then((r) => r.data),
  list: () => apiClient.get('/api/inboxes').then((r) => r.data),
  authenticateWhatsapp: (payload) => apiClient.post('/api/inboxes/whatsapp/authenticate', payload).then((r) => r.data),
  create: (payload) => apiClient.post('/api/inboxes', payload).then((r) => r.data),
  updateStatus: (id, status) => apiClient.patch(`/api/inboxes/${id}`, { status }).then((r) => r.data),
  remove: (id) => apiClient.delete(`/api/inboxes/${id}`).then((r) => r.data),
  setAgents: (id, agentIds) => apiClient.post(`/api/inboxes/${id}/agents`, { agentIds }).then((r) => r.data),
  availableAgents: () => apiClient.get('/api/inboxes-available-agents').then((r) => r.data),
};

export const webhooksApi = {
  list: () => apiClient.get('/api/webhooks').then((r) => r.data),
  create: (payload) => apiClient.post('/api/webhooks', payload).then((r) => r.data),
  update: (id, payload) => apiClient.put(`/api/webhooks/${id}`, payload).then((r) => r.data),
  remove: (id) => apiClient.delete(`/api/webhooks/${id}`).then((r) => r.data),
  test: (id) => apiClient.post(`/api/webhooks/${id}/test`).then((r) => r.data),
};

// اتصالات شات ووت (External_Provider_byA)
export const chatwootApi = {
  list: () => apiClient.get('/api/external-providers').then((r) => r.data),
  create: (payload) => apiClient.post('/api/external-providers', payload).then((r) => r.data),
  update: (id, payload) => apiClient.patch(`/api/external-providers/${id}`, payload).then((r) => r.data),
  setActive: (id, isActive) => apiClient.patch(`/api/external-providers/${id}/active`, { isActive }).then((r) => r.data),
  regenerateSecret: (id) => apiClient.post(`/api/external-providers/${id}/regenerate-secret`).then((r) => r.data),
  remove: (id) => apiClient.delete(`/api/external-providers/${id}`).then((r) => r.data),
};

// ربط كونتاكتس/إيجنتس شات ووت بكونتاكتس/إيجنتس نايل شات
export const chatwootMergeApi = {
  unmergedContacts: (providerId) => apiClient.get(`/api/external-providers/${providerId}/unmerged-contacts`).then((r) => r.data),
  mergeContact: (id, nileContactId) => apiClient.post(`/api/external-contacts/${id}/merge`, { nileContactId }).then((r) => r.data),
  unmergeContact: (id) => apiClient.post(`/api/external-contacts/${id}/unmerge`).then((r) => r.data),
  unmergedAgents: (providerId) => apiClient.get(`/api/external-providers/${providerId}/unmerged-agents`).then((r) => r.data),
  allAgents: (providerId) => apiClient.get(`/api/external-providers/${providerId}/agents`).then((r) => r.data),
  syncAgents: (providerId) => apiClient.post(`/api/external-providers/${providerId}/sync-agents`).then((r) => r.data),
  mergeAgent: (id, nileUserId, agentApiAccessToken, agentEmail, agentPassword) =>
    apiClient
      .post(`/api/external-agents/${id}/merge`, { nileUserId, agentApiAccessToken, agentEmail, agentPassword })
      .then((r) => r.data),
  unmergeAgent: (id) => apiClient.post(`/api/external-agents/${id}/unmerge`).then((r) => r.data),
  setAgentToken: (id, { agentApiAccessToken, agentEmail, agentPassword, refreshTokenNow } = {}) =>
    apiClient
      .patch(`/api/external-agents/${id}/token`, { agentApiAccessToken, agentEmail, agentPassword, refreshTokenNow })
      .then((r) => r.data),
};
