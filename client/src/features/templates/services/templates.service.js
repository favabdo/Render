import apiClient from '../../../services/apiClient';
import { mapCannedResponse, mapResolveCategory } from '../../../utils/templateMappers';

export const cannedResponsesApi = {
  list: () => apiClient.get('/api/canned-responses').then((r) => r.data.map(mapCannedResponse)),
  create: (label, text) => apiClient.post('/api/canned-responses', { label, text }).then((r) => mapCannedResponse(r.data)),
  update: (id, label, text) =>
    apiClient.put(`/api/canned-responses/${id}`, { label, text }).then((r) => mapCannedResponse(r.data)),
  remove: (id) => apiClient.delete(`/api/canned-responses/${id}`),
  reorder: (orderedIds) => apiClient.patch('/api/canned-responses/reorder', { orderedIds }),
};

export const resolveCategoriesApi = {
  list: () => apiClient.get('/api/resolve-categories').then((r) => r.data.map(mapResolveCategory)),
  create: (payload) => apiClient.post('/api/resolve-categories', payload).then((r) => mapResolveCategory(r.data)),
  update: (id, payload) => apiClient.put(`/api/resolve-categories/${id}`, payload).then((r) => mapResolveCategory(r.data)),
  remove: (id) => apiClient.delete(`/api/resolve-categories/${id}`),
  reorder: (orderedIds) => apiClient.patch('/api/resolve-categories/reorder', { orderedIds }),
};
