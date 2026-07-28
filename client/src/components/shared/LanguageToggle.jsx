import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { changeLanguage } from '../../i18n';

/**
 * زرار تبديل اللغة (عربي / إنجليزي). موجود فوق زرار تسجيل الخروج في الشريط الجانبي،
 * وبيظهر في كل صفحات الداشبورد لأنه جوه الـ Sidebar المشترك.
 */
export default function LanguageToggle({ className = '' }) {
  const { t, i18n } = useTranslation('common');
  const isArabic = i18n.language === 'ar';

  function handleToggle() {
    changeLanguage(isArabic ? 'en' : 'ar');
  }

  return (
    <button
      type="button"
      className={`sidebar-btn language-toggle-btn ${className}`.trim()}
      title={t('language.toggleLabel')}
      aria-label={t('language.toggleLabel')}
      onClick={handleToggle}
    >
      <Languages size={20} />
      <span className="language-toggle-code">{isArabic ? 'EN' : 'AR'}</span>
    </button>
  );
}
