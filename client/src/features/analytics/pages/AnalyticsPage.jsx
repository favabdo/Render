import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';

export default function AnalyticsPage() {
  const { t } = useTranslation('analytics');
  return (
    <div id="page-analytics" className="page">
      <div className="page-content">
        <div className="page-header">
          <h2>{t('title')}</h2>
        </div>
        <div className="coming-soon-box">
          <div className="coming-soon-icon">
            <BarChart3 size={26} color="#fff" />
          </div>
          <h3>{t('comingSoon')}</h3>
          <p>{t('comingSoonDesc')}</p>
        </div>
      </div>
    </div>
  );
}
