import apiClient from '../../../services/apiClient';

export const customerDetailsApi = {
  getContact: (id) => apiClient.get(`/api/contacts/${id}`).then((r) => r.data),
  addPhone: (id, phone) => apiClient.post(`/api/contacts/${id}/phones`, { phone }).then((r) => r.data),
  // آخر محادثة بس لكل رقم تابع للكونتاكت ده (مش كل الهيستوري) — بتستخدم في
  // مودال "اختار الرقم" لما العميل عنده أكتر من رقم مرتبط بمحادثات
  getContactConversations: (id) => apiClient.get(`/api/contacts/${id}/conversations`).then((r) => r.data),
  // دمج كارت العميل الحالي (بكل أرقامه ومحادثاته) جوه كارت عميل تاني —
  // العميل الحالي بيختفي وكل بياناته بتتنقل للعميل المستهدف
  mergeIntoContact: (sourceContactId, targetContactId) =>
    apiClient.post(`/api/contacts/${sourceContactId}/merge`, { targetContactId }).then((r) => r.data),

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
