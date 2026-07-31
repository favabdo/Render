import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, MessageCircle, MessagesSquare, Trash2, Inbox as InboxIcon, Copy, RefreshCw, Link2 } from 'lucide-react';
import { inboxesApi, chatwootApi } from '../services/settings.service';
import useToastStore from '../../../store/toastStore';
import InboxWizard from '../components/InboxWizard';
import ChatwootMergeModal from '../components/ChatwootMergeModal';

export default function InboxesSection() {
  const { t } = useTranslation('settings');
  const showToast = useToastStore((s) => s.showToast);
  const [inboxes, setInboxes] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mergeProvider, setMergeProvider] = useState(null);

  function load() {
    setLoading(true);
    setFailed(false);
    Promise.all([inboxesApi.list(), chatwootApi.list().catch(() => [])])
      .then(([inboxList, providerList]) => {
        setInboxes(inboxList);
        setProviders(providerList || []);
      })
      .catch((err) => {
        console.error('[Inboxes] load error:', err);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleStatus(inbox) {
    const newStatus = inbox.status === 'active' ? 'inactive' : 'active';
    setInboxes((prev) => prev.map((i) => (i.id === inbox.id ? { ...i, status: newStatus } : i)));
    try {
      await inboxesApi.updateStatus(inbox.id, newStatus);
    } catch (err) {
      console.error('[API] iwToggleInboxStatus error:', err);
      showToast(err.response?.data?.error || t('inboxes.updateFailed'), 'error');
      setInboxes((prev) => prev.map((i) => (i.id === inbox.id ? { ...i, status: inbox.status } : i)));
    }
  }

  function deleteInbox(id) {
    if (!window.confirm(t('inboxes.confirmDelete'))) return;
    const previous = inboxes;
    // Optimistic: الإنبوكس بيختفي من الجدول فورًا، ولو الحذف فشل بنرجّعه
    setInboxes((prev) => prev.filter((i) => i.id !== id));
    inboxesApi
      .remove(id)
      .catch((err) => {
        console.error('[API] iwDeleteInbox error:', err);
        setInboxes(previous);
        showToast(err.response?.data?.error || t('inboxes.deleteFailed'), 'error');
      });
  }

  async function toggleProviderActive(provider) {
    setProviders((prev) => prev.map((p) => (p.id === provider.id ? { ...p, is_active: !p.is_active } : p)));
    try {
      await chatwootApi.setActive(provider.id, !provider.is_active);
    } catch (err) {
      showToast(err.response?.data?.error || t('inboxes.updateFailed'), 'error');
      setProviders((prev) => prev.map((p) => (p.id === provider.id ? { ...p, is_active: provider.is_active } : p)));
    }
  }

  function copyWebhookUrl(url) {
    navigator.clipboard
      .writeText(url)
      .then(() => showToast(t('chatwootFields.urlCopied'), 'success'))
      .catch(() => showToast(url, 'error'));
  }

  async function regenerateSecret(provider) {
    if (!window.confirm(t('chatwootModal.confirmRegenerate'))) return;
    try {
      const data = await chatwootApi.regenerateSecret(provider.id);
      setProviders((prev) => prev.map((p) => (p.id === provider.id ? data.provider : p)));
      showToast(t('chatwootModal.regenerateSuccess'), 'success');
    } catch (err) {
      showToast(err.response?.data?.error || t('chatwootModal.regenerateFailed'), 'error');
    }
  }

  const isEmpty = inboxes.length === 0 && providers.length === 0;

  return (
    <div className="settings-content-section active" id="settings-sec-inboxes">
      <div className="page-content">
        <div className="settings-top-row">
          <div>
            <h2>{t('inboxes.title')}</h2>
            <div className="settings-top-desc">{t('inboxes.subtitle')}</div>
          </div>
          <button className="page-btn" onClick={() => setWizardOpen(true)}>
            <Plus size={16} /> {t('inboxes.addInbox')}
          </button>
        </div>
        <table className="settings-table">
          <thead>
            <tr>
              <th>{t('inboxes.columns.inbox')}</th>
              <th>{t('inboxes.columns.channel')}</th>
              <th>{t('inboxes.columns.agents')}</th>
              <th>{t('inboxes.columns.status')}</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="iw-empty">
                  {t('inboxes.loading')}
                </td>
              </tr>
            )}
            {!loading && failed && (
              <tr>
                <td colSpan={5} className="iw-empty">
                  {t('inboxes.loadFailed')}
                </td>
              </tr>
            )}
            {!loading && !failed && isEmpty && (
              <tr>
                <td colSpan={5} className="iw-empty">
                  <InboxIcon size={28} style={{ opacity: 0.4, display: 'block', margin: '0 auto 8px' }} />
                  {t('inboxes.empty')}
                </td>
              </tr>
            )}
            {!loading &&
              !failed &&
              inboxes.map((i) => (
                <tr key={`inbox-${i.id}`}>
                  <td>
                    <div className="st-person">
                      <div
                        className="settings-card-icon"
                        style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(37,211,102,0.12)', color: '#25D366' }}
                      >
                        <MessageCircle size={15} />
                      </div>
                      {i.name}
                    </div>
                  </td>
                  <td>
                    WhatsApp
                    {i.phone_number ? ` · ${i.phone_number}` : i.display_phone_number ? ` · ${i.display_phone_number}` : ''}
                  </td>
                  <td>{i.agents_count}</td>
                  <td>
                    <button className={`toggle${i.status === 'active' ? ' on' : ''}`} onClick={() => toggleStatus(i)}></button>
                  </td>
                  <td>
                    <button className="st-icon-btn danger" onClick={() => deleteInbox(i.id)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            {!loading &&
              !failed &&
              providers.map((p) => (
                <tr key={`chatwoot-${p.id}`}>
                  <td>
                    <div className="st-person">
                      <div
                        className="settings-card-icon"
                        style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(31,147,255,0.12)', color: '#1F93FF' }}
                      >
                        <MessagesSquare size={15} />
                      </div>
                      {p.name}
                    </div>
                  </td>
                  <td>Chatwoot · {p.base_url}</td>
                  <td>—</td>
                  <td>
                    <button className={`toggle${p.is_active ? ' on' : ''}`} onClick={() => toggleProviderActive(p)}></button>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="st-icon-btn" title={t('chatwootModal.copyUrl')} onClick={() => copyWebhookUrl(p.webhookUrl)}>
                        <Copy size={13} />
                      </button>
                      <button className="st-icon-btn" title={t('chatwootModal.regenerateSecret')} onClick={() => regenerateSecret(p)}>
                        <RefreshCw size={13} />
                      </button>
                      <button className="st-icon-btn" title={t('chatwootModal.manageMerge')} onClick={() => setMergeProvider(p)}>
                        <Link2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {wizardOpen && (
        <InboxWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            load();
          }}
        />
      )}

      {mergeProvider && <ChatwootMergeModal provider={mergeProvider} onClose={() => setMergeProvider(null)} />}
    </div>
  );
}
