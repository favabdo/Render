import apiClient from '../../../services/apiClient';

export async function login(email, password) {
  const { data } = await apiClient.post('/auth/login', { email, password });
  return data; // { token, user }
}

export async function getInviteInfo(token) {
  const { data } = await apiClient.get(`/api/invite/${token}`);
  return data; // { email }
}

export async function acceptInvite(token, password) {
  const { data } = await apiClient.post(`/api/invite/${token}/accept`, { password });
  return data;
}
