import { create } from 'zustand';
import { applyAccentColor, getStoredAccentColor, resetAccentColor } from '../theme/accentColor';

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
    // لو الإيجنت ده (أو حتى نفس الإيجنت لسه في نفس التاب) عنده لون طابع شخصي
    // محفوظ من قبل، لازم يتطبّق فورًا هنا كمان — مش بس وقت تحميل الصفحة —
    // عشان لو تسجيل الدخول حصل جوه نفس الـ SPA (بدون ريفريش كامل للصفحة)
    // زي انتقال صفحة اللوجين للداشبورد
    if (user && user.id) applyAccentColor(getStoredAccentColor(user.id));
  },

  logout: () => {
    localStorage.removeItem('nilechat_token');
    localStorage.removeItem('nilechat_user');
    set({ token: null, user: null });
    // نرجع للون الافتراضي عشان صفحة تسجيل الدخول (ومحدش عارف مين هيسجل
    // دخول بعد كده) ماتفضلش واقفة على لون إيجنت تاني كان مسجل قبل كده
    resetAccentColor();
  },
}));

export default useAuthStore;
