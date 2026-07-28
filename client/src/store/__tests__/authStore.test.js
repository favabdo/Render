import { describe, it, expect, beforeEach } from 'vitest';
import useAuthStore from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null });
  });

  it('starts with no token/user when localStorage is empty', () => {
    const { token, user } = useAuthStore.getState();
    expect(token).toBeNull();
    expect(user).toBeNull();
  });

  it('setAuth stores the token/user in state and localStorage', () => {
    const fakeUser = { id: 1, email: 'agent@example.com', display_name: 'Agent' };
    useAuthStore.getState().setAuth('fake-jwt-token', fakeUser);

    const state = useAuthStore.getState();
    expect(state.token).toBe('fake-jwt-token');
    expect(state.user).toEqual(fakeUser);
    expect(localStorage.getItem('nilechat_token')).toBe('fake-jwt-token');
    expect(JSON.parse(localStorage.getItem('nilechat_user'))).toEqual(fakeUser);
  });

  it('logout clears state and localStorage', () => {
    useAuthStore.getState().setAuth('fake-jwt-token', { id: 1, email: 'a@b.com' });
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(localStorage.getItem('nilechat_token')).toBeNull();
    expect(localStorage.getItem('nilechat_user')).toBeNull();
  });
});
