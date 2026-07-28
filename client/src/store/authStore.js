import { create } from 'zustand';

function readStoredUser() {
  try {
    const raw = localStorage.getItem('nilechat_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const useAuthStore = create((set) => ({
  token: localStorage.getItem('nilechat_token') || null,
  user: readStoredUser(),

  setAuth: (token, user) => {
    localStorage.setItem('nilechat_token', token);
    localStorage.setItem('nilechat_user', JSON.stringify(user));
    set({ token, user });
  },

  logout: () => {
    localStorage.removeItem('nilechat_token');
    localStorage.removeItem('nilechat_user');
    set({ token: null, user: null });
  },
}));

export default useAuthStore;
