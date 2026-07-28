const STORAGE_KEY = 'nilechat_theme';

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'light';
  return localStorage.getItem(STORAGE_KEY) || 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

// تفعيل الثيم المحفوظ فورًا وقت تحميل التطبيق (قبل أول render) عشان مايبانش
// وميض من الوضع الفاتح للغامق (flash of unstyled theme)
applyTheme(getStoredTheme());
