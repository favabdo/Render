import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon } from 'lucide-react';
import { getStoredTheme, setTheme } from '../../theme';

/**
 * زرار تبديل الوضع الفاتح/الغامق. موجود فوق زرار تبديل اللغة في الشريط الجانبي،
 * وبيظهر في كل صفحات الداشبورد لأنه جوه الـ Sidebar المشترك.
 */
export default function ThemeToggle({ className = '' }) {
  const { t } = useTranslation('common');
  const [theme, setThemeState] = useState(getStoredTheme());
  const isDark = theme === 'dark';

  function handleToggle() {
    const next = isDark ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  }

  return (
    <button
      type="button"
      className={`sidebar-btn theme-toggle-btn ${className}`.trim()}
      title={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      aria-label={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      onClick={handleToggle}
    >
      {isDark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
