import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Webhook, Plus, Copy } from 'lucide-react';
import { webhooksApi } from '../services/settings.service';
import { formatMessageTimestamp } from '../../../utils/dateFormat';
import useToastStore from '../../../store/toastStore';
import Modal from '../../../components/ui/Modal';

export default function WebhooksModal({ onClose, onChanged }) {
  const { t } = useTranslation('settings');
  const showToast = useToastStore((s) => s.showToast);
  const [webhooks, setWebhooks] = useState([]);
  const [availableEvents, setAvailableEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState(new Set());
  const [addError, setAddError] = useState('');
  const [testingId, setTestingId] = useState(null);

  function eventLabel(evt) {
    return t(`webhooksModal.events.${evt}`, { defaultValue: evt });
  }

  function load() {
    setLoading(true);
    webhooksApi
      .list()
      .then((data) => {
        setWebhooks(data.webhooks || []);
        setAvailableEvents(data.available_events || []);
        onChanged?.((data.webhooks || []).length);
      })
      .catch((err) => console.error('[API] loadWebhooksList error:', err))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  function toggleEventChoice(evt) {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(evt)) next.delete(evt);
      else next.add(evt);
      return next;
    });
  }

  async function createWebhook() {
    setAddError('');
    const trimmed = url.trim();
    if (!trimmed) return setAddError(t('webhooksModal.urlRequired'));
    if (selectedEvents.size === 0) return setAddError(t('webhooksModal.eventRequired'));
    try {
      await webhooksApi.create({ url: trimmed, events: Array.from(selectedEvents) });
      setUrl('');
      setSelectedEvents(new Set());
      showToast(t('webhooksModal.createSuccess'), 'success');
      load();
    } catch (err) {
      setAddError(err.response?.data?.error || t('webhooksModal.createFailed'));
    }
  }

  async function toggleEnabled(wh) {
    setWebhooks((prev) => prev.map((w) => (w.id === wh.id ? { ...w, enabled: !w.enabled } : w)));
    try {
      await webhooksApi.update(wh.id, { enabled: !wh.enabled });
    } catch (err) {
      showToast(err.response?.data?.error || t('webhooksModal.toggleFailed'), 'error');
      setWebhooks((prev) => prev.map((w) => (w.id === wh.id ? { ...w, enabled: wh.enabled } : w)));
    }
  }

  async function testNow(id) {
    setTestingId(id);
    try {
      const data = await webhooksApi.test(id);
      showToast(data.delivered ? t('webhooksModal.testSuccess') : t('webhooksModal.testFailed'), data.delivered ? 'success' : 'error');
      load();
    } catch (err) {
      showToast(err.response?.data?.error || t('webhooksModal.testSendFailed'), 'error');
    } finally {
      setTestingId(null);
    }
  }

  function deleteWebhook(id) {
    if (!window.confirm(t('webhooksModal.confirmDelete'))) return;
    const previous = webhooks;
    // Optimistic: الويب هوك بيختفي من اللستة فورًا، ولو الحذف فشل بنرجّعه
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    onChanged?.(previous.length - 1);
    webhooksApi
      .remove(id)
      .then(() => showToast(t('webhooksModal.deleteSuccess'), 'success'))
      .catch((err) => {
        setWebhooks(previous);
        onChanged?.(previous.length);
        showToast(err.response?.data?.error || t('webhooksModal.deleteFailed'), 'error');
      });
  }

  function copySecret(secret) {
    navigator.clipboard
      .writeText(secret)
      .then(() => showToast(t('webhooksModal.secretCopied'), 'success'))
      .catch(() => showToast(t('webhooksModal.copyFailedPrefix') + secret, 'error'));
  }

  return (
    <Modal onClose={onClose} width={520}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(var(--primary-rgb),0.12)', color: 'var(--primary)' }}>
          <Webhook size={22} />
        </div>
        <div className="resolve-modal-title">{t('webhooksModal.title')}</div>
      </div>
      <div className="resolve-modal-sub" style={{ paddingRight: 0, marginBottom: 16 }}>
        {t('webhooksModal.subtitle')}
      </div>

      <div style={{ marginBottom: 6 }}>
        {loading && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', padding: '8px 0' }}>{t('webhooksModal.loading')}</div>}
        {!loading && webhooks.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', padding: '8px 0' }}>{t('webhooksModal.empty')}</div>
        )}
        {!loading &&
          webhooks.map((wh) => (
            <div key={wh.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 700, wordBreak: 'break-all' }}>{wh.url}</div>
                <button
                  className={`toggle${wh.enabled ? ' on' : ''}`}
                  title={t('webhooksModal.toggleEnabled')}
                  aria-label={t('webhooksModal.toggleEnabled')}
                  onClick={() => toggleEnabled(wh)}
                ></button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {wh.events.map((e) => (
                  <span key={e} className="label-chip" style={{ background: 'rgba(var(--primary-rgb),0.1)', color: 'var(--primary)' }}>
                    {eventLabel(e)}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11.5, marginBottom: 8 }}>
                {!wh.last_triggered_at ? (
                  <span style={{ color: 'var(--text-secondary)' }}>{t('webhooksModal.noAttemptsYet')}</span>
                ) : wh.last_error ? (
                  <span style={{ color: 'var(--danger)' }}>
                    {t('webhooksModal.lastAttemptFailed', { time: formatMessageTimestamp(wh.last_triggered_at), error: wh.last_error })}
                  </span>
                ) : (
                  <span style={{ color: 'var(--success)' }}>
                    {t('webhooksModal.lastAttemptSucceeded', { time: formatMessageTimestamp(wh.last_triggered_at), code: wh.last_status_code })}
                  </span>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11.5,
                  color: 'var(--text-secondary)',
                  marginBottom: 10,
                }}
              >
                <span>{t('webhooksModal.secret')}</span>
                <code style={{ background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: 6, fontSize: 11 }}>
                  {wh.secret.slice(0, 8)}••••••••
                </code>
                <button
                  className="st-icon-btn"
                  title={t('webhooksModal.copySecret')}
                  aria-label={t('webhooksModal.copySecret')}
                  onClick={() => copySecret(wh.secret)}
                >
                  <Copy size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="resolve-cancel-btn"
                  style={{ flex: 1, padding: 7 }}
                  disabled={testingId === wh.id}
                  onClick={() => testNow(wh.id)}
                >
                  {testingId === wh.id ? t('webhooksModal.sendingTest') : t('webhooksModal.sendTestEvent')}
                </button>
                <button
                  className="resolve-cancel-btn"
                  style={{ flex: 1, padding: 7, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                  onClick={() => deleteWebhook(wh.id)}
                >
                  {t('webhooksModal.delete')}
                </button>
              </div>
            </div>
          ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 16 }}>
        <div className="resolve-cats-label">{t('webhooksModal.addNew')}</div>
        <input
          className="iw-input"
          placeholder={t('webhooksModal.urlPlaceholder')}
          style={{ marginBottom: 12 }}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="resolve-cats-label" style={{ marginTop: 0 }}>
          {t('webhooksModal.eventsToSend')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, margin: '8px 0 12px' }}>
          {availableEvents.map((evt) => (
            <label key={evt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selectedEvents.has(evt)}
                onChange={() => toggleEventChoice(evt)}
                style={{ width: 15, height: 15, accentColor: 'var(--primary)' }}
              />
              {eventLabel(evt)}
            </label>
          ))}
        </div>
        {addError && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 8 }}>{addError}</div>}
        <button className="resolve-confirm-btn" style={{ width: '100%' }} onClick={createWebhook}>
          <Plus size={15} /> {t('webhooksModal.addWebhook')}
        </button>
      </div>

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>
          {t('webhooksModal.close')}
        </button>
      </div>
    </Modal>
  );
}
