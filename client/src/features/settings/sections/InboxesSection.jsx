import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, MessageCircle, MessagesSquare, Trash2, Inbox as InboxIcon, Copy, RefreshCw, Link2, Pencil } from 'lucide-react';
import { inboxesApi, chatwootApi } from '../services/settings.service';
import useToastStore from '../../../store/toastStore';
import InboxWizard from '../components/InboxWizard';
import ChatwootMergeModal from '../components/ChatwootMergeModal';
import Modal from '../../../components/ui/Modal';

// مودال تعديل اتصال شات ووت (Base URL / Account ID / Inbox ID / Token) —
// نفس الحقول اللي في الويزارد، بس هنا للتعديل بعد الإنشاء
function ChatwootEditModal({ provider, onClose, onSaved }) {
  const { t } = useTranslation('settings');
  const showToast = useToastStore((s) => s.showToast);
  const [baseUrl, setBaseUrl] = useState(provider.base_url || '');
  const [accountId, setAccountId] = useState(provider.account_id || '');
  const [inboxIdOnProvider, setInboxIdOnProvider] = useState(provider.inbox_id_on_provider || '');
  const [apiAccessToken, setApiAccessToken] = useState('');
  const [loginEmail, setLoginEmail] = useState(provider.login_email || '');
  const [loginPassword, setLoginPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const data = await chatwootApi.update(provider.id, {
        baseUrl: baseUrl.trim() || undefined,
        accountId: accountId.trim() || undefined,
        inboxIdOnProvider: inboxIdOnProvider.trim() || undefined,
        apiAccessToken: apiAccessToken.trim() || undefined,
        loginEmail: loginEmail.trim() || undefined,
        loginPassword: loginPassword || undefined,
      });
      showToast(t('chatwootModal.updateSuccess'), 'success');
      onSaved(data.provider);
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || t('chatwootModal.updateFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  // زرار "جدد التوكن دلوقتي" — بيسجل دخول شات ووت بالإيميل والباسورد
  // (الجداد لو كتبتهم، وإلا المخزنين خلاص) ويجيب توكن جديد فورًا، من غير
  // ما نستنى أول رسالة تفشل عشان النظام يجدده لوحده
  async function refreshNow() {
    setRefreshing(true);
    try {
      const data = await chatwootApi.update(provider.id, {
        baseUrl: baseUrl.trim() || undefined,
        accountId: accountId.trim() || undefined,
        inboxIdOnProvider: inboxIdOnProvider.trim() || undefined,
        loginEmail: loginEmail.trim() || undefined,
        loginPassword: loginPassword || undefined,
        refreshTokenNow: true,
      });
      showToast(t('chatwootModal.tokenRefreshed'), 'success');
      onSaved(data.provider);
    } catch (err) {
      showToast(err.response?.data?.error || t('chatwootModal.tokenRefreshFailed'), 'error');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Modal onClose={onClose} width={480}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(31,147,255,0.12)', color: '#1F93FF' }}>
          <MessagesSquare size={22} />
        </div>
        <div className="resolve-modal-title">{provider.name}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        <div className="iw-form-label">{t('chatwootFields.baseUrl')}</div>
        <input className="iw-input" placeholder={t('chatwootFields.baseUrlPlaceholder')} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <div className="iw-form-hint">{t('chatwootFields.baseUrlEditHint')}</div>

        <div className="iw-form-label" style={{ marginTop: 6 }}>{t('chatwootFields.accountId')}</div>
        <input className="iw-input" placeholder={t('chatwootFields.accountIdPlaceholder')} value={accountId} onChange={(e) => setAccountId(e.target.value)} />

        <div className="iw-form-label" style={{ marginTop: 6 }}>{t('chatwootFields.inboxId')}</div>
        <input
          className="iw-input"
          placeholder={t('chatwootFields.inboxIdPlaceholder')}
          value={inboxIdOnProvider}
          onChange={(e) => setInboxIdOnProvider(e.target.value)}
        />

        <div className="iw-form-label" style={{ marginTop: 6 }}>{t('chatwootFields.token')}</div>
        <input
          className="iw-input"
          type="password"
          placeholder={t('chatwootModal.tokenPlaceholderEdit')}
          value={apiAccessToken}
          onChange={(e) => setApiAccessToken(e.target.value)}
        />

        <div className="iw-form-label" style={{ marginTop: 10 }}>{t('chatwootFields.loginEmail')}</div>
        <input
          className="iw-input"
          type="email"
          placeholder={t('chatwootFields.loginEmailPlaceholder')}
          value={loginEmail}
          onChange={(e) => setLoginEmail(e.target.value)}
        />
        <div className="iw-form-label" style={{ marginTop: 6 }}>{t('chatwootFields.loginPassword')}</div>
        <input
          className="iw-input"
          type="password"
          placeholder={t('chatwootModal.tokenPlaceholderEdit')}
          value={loginPassword}
          onChange={(e) => setLoginPassword(e.target.value)}
        />
        <div className="iw-form-hint">{t('chatwootFields.loginHint')}</div>
        <button
          className="resolve-cancel-btn"
          style={{ marginTop: 4 }}
          disabled={refreshing || (!loginEmail.trim() && !provider.login_email) || (!loginPassword && !provider.login_password)}
          onClick={refreshNow}
        >
          <RefreshCw size={13} /> {refreshing ? t('chatwootModal.refreshingToken') : t('chatwootModal.refreshTokenNow')}
        </button>
      </div>
      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>
          {t('chatwootModal.cancel')}
        </button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={save}>
          {t('chatwootModal.save')}
        </button>
      </div>
    </Modal>
  );
}

export default function InboxesSection() {
  const { t } = useTranslation('settings');
  const showToast = useToastStore((s) => s.showToast);
  const [inboxes, setInboxes] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mergeProvider, setMergeProvider] = useState(null);
  const [editingProvider, setEditingProvider] = useState(null);

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

  function deleteProvider(provider) {
    if (!window.confirm(t('chatwootModal.confirmDelete'))) return;
    const previous = providers;
    setProviders((prev) => prev.filter((p) => p.id !== provider.id));
    chatwootApi.remove(provider.id).catch((err) => {
      setProviders(previous);
      showToast(err.response?.data?.error || t('chatwootModal.deleteFailed'), 'error');
    });
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
                      <button className="st-icon-btn" title={t('chatwootModal.edit')} onClick={() => setEditingProvider(p)}>
                        <Pencil size={13} />
                      </button>
                      <button className="st-icon-btn" title={t('chatwootModal.copyUrl')} onClick={() => copyWebhookUrl(p.webhookUrl)}>
                        <Copy size={13} />
                      </button>
                      <button className="st-icon-btn" title={t('chatwootModal.regenerateSecret')} onClick={() => regenerateSecret(p)}>
                        <RefreshCw size={13} />
                      </button>
                      <button className="st-icon-btn" title={t('chatwootModal.manageMerge')} onClick={() => setMergeProvider(p)}>
                        <Link2 size={13} />
                      </button>
                      <button className="st-icon-btn danger" title={t('inboxes.confirmDelete')} onClick={() => deleteProvider(p)}>
                        <Trash2 size={13} />
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

      {editingProvider && (
        <ChatwootEditModal
          provider={editingProvider}
          onClose={() => setEditingProvider(null)}
          onSaved={(updated) => setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
        />
      )}
    </div>
  );
}
