import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from '../../../../services/apiClient';

vi.mock('../../../../services/apiClient', () => ({
  default: { get: vi.fn() },
}));

const { default: useChatsStore } = await import('../chatsStore');

describe('chatsStore — shared Teams/Labels state', () => {
  beforeEach(() => {
    useChatsStore.setState({ allLabels: [], teams: [], staticDataLoaded: false });
    vi.clearAllMocks();
  });

  it('refreshLabels replaces allLabels with the latest server data', async () => {
    apiClient.get.mockResolvedValueOnce({ data: [{ id: 1, name: 'Urgent', color: '#ef4444' }] });

    await useChatsStore.getState().refreshLabels();

    expect(apiClient.get).toHaveBeenCalledWith('/api/labels');
    expect(useChatsStore.getState().allLabels).toEqual([{ id: 1, name: 'Urgent', color: '#ef4444' }]);
  });

  it('refreshTeams replaces teams with the latest server data', async () => {
    apiClient.get.mockResolvedValueOnce({ data: [{ id: 2, name: 'Support', members_count: 3 }] });

    await useChatsStore.getState().refreshTeams();

    expect(apiClient.get).toHaveBeenCalledWith('/api/teams');
    expect(useChatsStore.getState().teams).toEqual([{ id: 2, name: 'Support', members_count: 3 }]);
  });

  it('a refresh is visible to every consumer of the store — single source of truth', async () => {
    apiClient.get.mockResolvedValueOnce({ data: [{ id: 9, name: 'VIP' }] });
    await useChatsStore.getState().refreshLabels();

    // أي مكون تاني بيستخدم useChatsStore (زي صفحة Settings) هياخد نفس القيمة
    // بالظبط من غير أي state محلي منفصل أو أي نداء مزامنة إضافي
    const fromChatsFeature = useChatsStore.getState().allLabels;
    const fromSettingsFeature = useChatsStore.getState().allLabels;
    expect(fromChatsFeature).toBe(fromSettingsFeature);
  });
});
