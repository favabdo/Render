import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Webhook } from 'lucide-react';
import { webhooksApi } from '../services/settings.service';
import WebhooksModal from '../components/WebhooksModal';

export default function IntegrationsSection() {
  const { t } = useTranslation('settings');
  const [count, setCount] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    webhooksApi
      .list()
      .then((data) => setCount((data.webhooks || []).length))
      .catch((err) => {
        console.error('[API] loadWebhooksCardMeta error:', err);
        setCount(0);
      });
  }, []);

  return (
    <div className="settings-content-section active" id="settings-sec-integrations">
      <div className="page-content">
        <div className="settings-top-row">
          <div>
            <h2>{t('integrations.title')}</h2>
            <div className="settings-top-desc">{t('integrations.subtitle')}</div>
          </div>
        </div>
        <div className="settings-card-grid">
          <div className="settings-card" style={{ cursor: 'pointer' }} onClick={() => setModalOpen(true)}>
            <div className="settings-card-icon" style={{ background: 'rgba(108,92,231,0.1)', color: 'var(--primary)' }}>
              <Webhook size={20} />
            </div>
            <div className="settings-card-title">{t('integrations.webhooksTitle')}</div>
            <div className="settings-card-desc">{t('integrations.webhooksDesc')}</div>
            <div className="settings-card-meta">
              <span>{count === null ? t('integrations.loading') : count ? t('integrations.configuredCount', { count }) : t('integrations.notConfigured')}</span>
              <span className="settings-card-connect">{t('integrations.configure')}</span>
            </div>
          </div>
        </div>
      </div>

      {modalOpen && <WebhooksModal onClose={() => setModalOpen(false)} onChanged={setCount} />}
    </div>
  );
}
