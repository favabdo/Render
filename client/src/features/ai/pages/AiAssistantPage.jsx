import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

export default function AiAssistantPage() {
  const { t } = useTranslation('ai');
  return (
    <div id="page-ai" className="page">
      <div className="page-content">
        <div className="page-header">
          <h2>{t('title')}</h2>
        </div>
        <div className="coming-soon-box">
          <div className="coming-soon-icon">
            <Sparkles size={26} color="#fff" />
          </div>
          <h3>{t('comingSoon')}</h3>
          <p>{t('comingSoonDesc')}</p>
        </div>
      </div>
    </div>
  );
}
