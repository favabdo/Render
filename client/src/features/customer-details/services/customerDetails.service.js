import apiClient from '../../../services/apiClient';

export const customerDetailsApi = {
  getContact: (id) => apiClient.get(`/api/contacts/${id}`).then((r) => r.data),
  addPhone: (id, phone) => apiClient.post(`/api/contacts/${id}/phones`, { phone }).then((r) => r.data),
  // كل المحادثات (وبالتالي كل الأرقام) الخاصة بكونتاكت معيّن — بتستخدم في مودال
  // "دمج رقم" عشان نعرف إيه المحادثة/الرقم اللي هيتدمج مع العميل الحالي
  getContactConversations: (id) => apiClient.get(`/api/contacts/${id}/conversations`).then((r) => r.data),
  // نفس بالظبط endpoint الدمج المستخدم من كارت المحادثة (linkConversationContact) —
  // بتربط رقم/محادثة معينة بكونتاكت مستهدف (هنا: العميل اللي فاتحين صفحته)
  mergeConversationIntoContact: (conversationId, targetContactId) =>
    apiClient.post(`/api/conversations/${conversationId}/contact`, { mode: 'link', contactId: targetContactId }).then((r) => r.data),

  listVisits: (contactId) => apiClient.get(`/api/contacts/${contactId}/visits`).then((r) => r.data),
  addVisit: (contactId, payload) => apiClient.post(`/api/contacts/${contactId}/visits`, payload).then((r) => r.data),

  listMaintenanceContracts: (contactId) => apiClient.get(`/api/contacts/${contactId}/maintenance-contracts`).then((r) => r.data),
  addMaintenanceContract: (contactId, payload) =>
    apiClient.post(`/api/contacts/${contactId}/maintenance-contracts`, payload).then((r) => r.data),
  stopMaintenanceContract: (contactId, contractId2) =>
    apiClient.patch(`/api/contacts/${contactId}/maintenance-contracts/${contractId2}/stop`).then((r) => r.data),
  deleteMaintenanceContract: (contactId, contractId2) =>
    apiClient.delete(`/api/contacts/${contactId}/maintenance-contracts/${contractId2}`).then((r) => r.data),
};
