import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  ArrowRight,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  PartyPopper,
  Check,
  Zap,
  Hash,
  Key,
  MessageCircle,
  Copy,
} from 'lucide-react';
import { iconKeyToComponent } from '../../../utils/iconMap';
import { inboxesApi, chatwootApi } from '../services/settings.service';
import useToastStore from '../../../store/toastStore';
import { roleLabel } from '../../../utils/roles';

const IW_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export default function InboxWizard({ onClose, onCreated }) {
  const { t } = useTranslation('settings');
  const showToast = useToastStore((s) => s.showToast);
  const [step, setStep] = useState(1);

  const STEPS = [
    { n: 1, label: t('inboxWizard.steps.1') },
    { n: 2, label: t('inboxWizard.steps.2') },
    { n: 3, label: t('inboxWizard.steps.3') },
    { n: 4, label: t('inboxWizard.steps.4') },
  ];

  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);

  const [inboxName, setInboxName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [authenticated, setAuthenticated] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createdInbox, setCreatedInbox] = useState(null);

  // حقول شات ووت (Chatwoot) — مختلفة عن حقول واتساب فوق
  const [cwBaseUrl, setCwBaseUrl] = useState('');
  const [cwAccountId, setCwAccountId] = useState('');
  const [cwInboxId, setCwInboxId] = useState('');
  const [cwToken, setCwToken] = useState('');
  const [createdProvider, setCreatedProvider] = useState(null);

  const [agents, setAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState(new Set());
  const [savingAgents, setSavingAgents] = useState(false);

  useEffect(() => {
    inboxesApi
      .channels()
      .then(setChannels)
      .catch((err) => {
        console.error('[InboxWizard] channels load error:', err);
        setChannels([]);
      });
  }, []);

  useEffect(() => {
    if (step === 3 && selectedChannel !== 'chatwoot') {
      setAgentsLoading(true);
      inboxesApi
        .availableAgents()
        .then(setAgents)
        .catch(() => setAgents([]))
        .finally(() => setAgentsLoading(false));
    }
  }, [step, selectedChannel]);

  const phoneValid = !phoneNumber || IW_PHONE_REGEX.test(phoneNumber);

  function selectChannel(c) {
    if (!c.available) {
      showToast(t('inboxWizard.channelSoon', { name: c.name }), 'info');
      return;
    }
    setSelectedChannel(c.key);
  }

  function resetAuth() {
    setAuthenticated(null);
    setAuthStatus(null);
  }

  async function authenticate() {
    if (!phoneNumber || !phoneNumberId || !accessToken) {
      showToast(t('inboxWizard.fillAllFieldsFirst'), 'error');
      return;
    }
    if (!IW_PHONE_REGEX.test(phoneNumber)) {
      showToast(t('inboxWizard.phoneMustStartWithPlus'), 'error');
      return;
    }
    setAuthStatus({ state: 'pending', text: t('inboxWizard.verifyingPending') });
    try {
      const data = await inboxesApi.authenticateWhatsapp({ phoneNumber, phoneNumberId, accessToken });
      setAuthenticated({
        phoneNumber,
        phoneNumberId,
        accessToken,
        verifiedName: data.verifiedName,
        displayPhoneNumber: data.displayPhoneNumber,
      });
      setAuthStatus({
        state: 'ok',
        text: t('inboxWizard.verifiedOk', { name: data.verifiedName || data.displayPhoneNumber || t('inboxWizard.workingAccount') }),
      });
    } catch (err) {
      setAuthenticated(null);
      setAuthStatus({ state: 'err', text: err.response?.data?.error || t('inboxWizard.verifyFailed') });
    }
  }

  function toggleAgent(id) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function goNext() {
    if (step === 1) {
      if (!selectedChannel) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      setCreating(true);
      try {
        if (selectedChannel === 'chatwoot') {
          const data = await chatwootApi.create({
            name: inboxName.trim() || 'chatwoot',
            baseUrl: cwBaseUrl.trim(),
            accountId: cwAccountId.trim(),
            inboxIdOnProvider: cwInboxId.trim() || undefined,
            apiAccessToken: cwToken.trim(),
          });
          setCreatedProvider(data);
          showToast(t('inboxWizard.inboxCreatedSuccess'), 'success');
          // شات ووت مالوش مفهوم "تعيين إيجنتس على الإنبوكس" زي واتساب — بنعدي
          // على طول لشاشة النجاح اللي فيها رابط الـ Webhook الجاهز للنسخ
          setStep(4);
        } else {
          const data = await inboxesApi.create({
            name: inboxName.trim(),
            channelType: 'whatsapp',
            phoneNumber: authenticated.phoneNumber,
            phoneNumberId: authenticated.phoneNumberId,
            accessToken: authenticated.accessToken,
          });
          setCreatedInbox(data.inbox);
          showToast(t('inboxWizard.inboxCreatedSuccess'), 'success');
          setStep(3);
        }
      } catch (err) {
        showToast(err.response?.data?.error || t('inboxWizard.inboxCreateFailed'), 'error');
      } finally {
        setCreating(false);
      }
      return;
    }
    if (step === 3) {
      setSavingAgents(true);
      try {
        await inboxesApi.setAgents(createdInbox.id, Array.from(selectedAgentIds).map(Number));
      } catch (err) {
        showToast(err.response?.data?.error || t('inboxWizard.addAgentsFailed'), 'error');
      } finally {
        setSavingAgents(false);
        setStep(4);
      }
      return;
    }
    if (step === 4) {
      onCreated();
    }
  }

  const step2Valid =
    selectedChannel === 'chatwoot'
      ? cwBaseUrl.trim() && cwAccountId.trim() && cwToken.trim()
      : inboxName.trim() && phoneNumber && phoneValid && authenticated;

  const groupedChannels = channels.reduce((acc, c) => {
    (acc[c.group] = acc[c.group] || []).push(c);
    return acc;
  }, {});

  return (
    <div className="iw-overlay show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="iw-modal" onClick={(e) => e.stopPropagation()}>
        <div className="iw-head">
          <div className="iw-head-title">{t('inboxWizard.title')}</div>
          <button className="iw-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="iw-steps">
          {STEPS.map((s) => (
            <div key={s.n} className={`iw-step${step === s.n ? ' active' : ''}${step > s.n ? ' done' : ''}`}>
              <div className="iw-step-num">{s.n}</div>
              <div className="iw-step-label">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="iw-body">
          {step === 1 && (
            <div className="iw-panel active">
              {channels.length === 0 ? (
                <div className="iw-empty">{t('inboxWizard.loadingChannels')}</div>
              ) : (
                <>
                  {Object.keys(groupedChannels).map((groupName) => (
                    <div key={groupName}>
                      <div className="iw-channel-group-title">{groupName}</div>
                      <div className="iw-channel-grid">
                        {groupedChannels[groupName].map((c) => {
                          const ChIcon = iconKeyToComponent(c.icon);
                          return (
                            <div
                              key={c.key}
                              className={`iw-channel-card${c.available ? '' : ' disabled'}${selectedChannel === c.key ? ' selected' : ''}`}
                              onClick={() => selectChannel(c)}
                            >
                              <span className={`iw-channel-badge${c.available ? '' : ' soon'}`}>
                                {c.available ? t('inboxWizard.available') : t('inboxWizard.soon')}
                              </span>
                              <div className="iw-channel-icon" style={{ background: c.color }}>
                                <ChIcon size={18} />
                              </div>
                              <div className="iw-channel-name">{c.name}</div>
                              <div className="iw-channel-desc">{c.description}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="iw-protocol-note">
                    <Zap size={16} />
                    <div>{t('inboxWizard.protocolNote')}</div>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 2 && selectedChannel === 'chatwoot' && (
            <div className="iw-panel active">
              <div className="iw-form-row">
                <div className="iw-form-label">{t('inboxWizard.inboxName')}</div>
                <input
                  type="text"
                  className="iw-input"
                  placeholder={t('chatwootFields.namePlaceholder')}
                  value={inboxName}
                  onChange={(e) => setInboxName(e.target.value)}
                />
              </div>
              <div className="iw-form-row">
                <div className="iw-form-label">{t('chatwootFields.baseUrl')}</div>
                <input
                  type="text"
                  className="iw-input"
                  placeholder={t('chatwootFields.baseUrlPlaceholder')}
                  value={cwBaseUrl}
                  onChange={(e) => setCwBaseUrl(e.target.value)}
                />
              </div>
              <div className="iw-form-row">
                <div className="iw-form-label">
                  <Hash size={13} /> {t('chatwootFields.accountId')}
                </div>
                <input
                  type="text"
                  className="iw-input"
                  placeholder={t('chatwootFields.accountIdPlaceholder')}
                  value={cwAccountId}
                  onChange={(e) => setCwAccountId(e.target.value)}
                />
              </div>
              <div className="iw-form-row">
                <div className="iw-form-label">
                  <Hash size={13} /> {t('chatwootFields.inboxId')}
                </div>
                <input
                  type="text"
                  className="iw-input"
                  placeholder={t('chatwootFields.inboxIdPlaceholder')}
                  value={cwInboxId}
                  onChange={(e) => setCwInboxId(e.target.value)}
                />
              </div>
              <div className="iw-form-row">
                <div className="iw-form-label">
                  <Key size={13} /> {t('chatwootFields.token')}
                </div>
                <input
                  type="password"
                  className="iw-input"
                  placeholder={t('chatwootFields.tokenPlaceholder')}
                  value={cwToken}
                  onChange={(e) => setCwToken(e.target.value)}
                />
                <div className="iw-form-hint">{t('chatwootFields.tokenHint')}</div>
              </div>
            </div>
          )}

          {step === 2 && selectedChannel !== 'chatwoot' && (
            <div className="iw-panel active">
              <div className="iw-form-row">
                <div className="iw-form-label">{t('inboxWizard.apiProvider')}</div>
                <select className="iw-input" defaultValue="whatsapp_cloud">
                  <option value="whatsapp_cloud">WhatsApp Cloud API (Meta)</option>
                  <option disabled>360Dialog — {t('inboxWizard.otherProviderSoon')}</option>
                  <option disabled>Baileys (Unofficial) — {t('inboxWizard.otherProviderSoon')}</option>
                </select>
              </div>
              <div className="iw-form-row">
                <div className="iw-form-label">{t('inboxWizard.inboxName')}</div>
                <input
                  type="text"
                  className="iw-input"
                  placeholder={t('inboxWizard.inboxNamePlaceholder')}
                  value={inboxName}
                  onChange={(e) => setInboxName(e.target.value)}
                />
              </div>
              <div className="iw-form-row">
                <div className="iw-form-label">{t('inboxWizard.phoneNumber')}</div>
                <input
                  type="text"
                  className="iw-input"
                  placeholder="+201001234567"
                  value={phoneNumber}
                  onChange={(e) => {
                    setPhoneNumber(e.target.value);
                    resetAuth();
                  }}
                />
                <div className="iw-form-hint" style={{ color: phoneValid ? 'var(--text-secondary)' : 'var(--danger)' }}>
                  {t('inboxWizard.phoneHint')}
                </div>
              </div>
              <div className="iw-form-row">
                <div className="iw-form-label">
                  <Hash size={13} /> {t('inboxWizard.phoneNumberId')}
                </div>
                <input
                  type="text"
                  className="iw-input"
                  placeholder={t('inboxWizard.phoneNumberIdPlaceholder')}
                  value={phoneNumberId}
                  onChange={(e) => {
                    setPhoneNumberId(e.target.value);
                    resetAuth();
                  }}
                />
              </div>
              <div className="iw-form-row">
                <div className="iw-form-label">
                  <Key size={13} /> {t('inboxWizard.apiKey')}
                </div>
                <input
                  type="password"
                  className="iw-input"
                  placeholder={t('inboxWizard.apiKeyPlaceholder')}
                  value={accessToken}
                  onChange={(e) => {
                    setAccessToken(e.target.value);
                    resetAuth();
                  }}
                />
                <div className="iw-form-hint">{t('inboxWizard.apiKeyHint')}</div>
              </div>
              <div className="iw-verify-row">
                <button className="iw-btn iw-btn-primary" style={{ flexShrink: 0 }} onClick={authenticate}>
                  <ShieldCheck size={14} /> {t('inboxWizard.authenticate')}
                </button>
                {authStatus && (
                  <div className={`iw-verify-status ${authStatus.state}`}>
                    {authStatus.state === 'pending' && <Loader2 size={14} style={{ animation: 'iw-spin .7s linear infinite' }} />}
                    {authStatus.state === 'ok' && <CheckCircle2 size={15} />}
                    {authStatus.state === 'err' && <XCircle size={15} />} {authStatus.text}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="iw-panel active">
              <div className="iw-form-label" style={{ marginBottom: 12 }}>
                {t('inboxWizard.chooseAgentsLabel')}
              </div>
              <div className="iw-agent-list">
                {agentsLoading ? (
                  <div className="iw-empty">{t('inboxWizard.loadingAgents')}</div>
                ) : agents.length === 0 ? (
                  <div className="iw-empty">{t('inboxWizard.noAgents')}</div>
                ) : (
                  agents.map((a) => {
                    const isSelected = selectedAgentIds.has(String(a.id));
                    return (
                      <div
                        key={a.id}
                        className={`iw-agent-row${isSelected ? ' selected' : ''}`}
                        onClick={() => toggleAgent(a.id)}
                      >
                        <div className="iw-agent-check">{isSelected && <Check size={12} />}</div>
                        <div className="iw-agent-name">{a.display_name || a.email}</div>
                        <div className="iw-agent-role">{roleLabel(a.role)}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="iw-panel active">
              <div className="iw-success">
                <div className="iw-success-icon">
                  <PartyPopper size={34} />
                </div>
                <div className="iw-success-title">{t('inboxWizard.successTitle')}</div>
                <div className="iw-success-desc">
                  {selectedChannel === 'chatwoot' ? t('chatwootFields.successDesc') : t('inboxWizard.successDesc')}
                </div>
                {createdInbox && (
                  <div className="iw-success-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <MessageCircle size={16} color="var(--success)" />
                      <b>{createdInbox.name}</b>
                    </div>
                    <div>
                      {t('inboxWizard.number')}{' '}
                      {createdInbox.phone_number || createdInbox.display_phone_number || createdInbox.phone_number_id || '—'}
                    </div>
                    <div>{t('inboxWizard.agentsAdded')} {selectedAgentIds.size}</div>
                  </div>
                )}
                {createdProvider && (
                  <div className="iw-success-card" style={{ textAlign: 'start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <MessageCircle size={16} color="var(--success)" />
                      <b>{createdProvider.provider?.name}</b>
                    </div>
                    <div className="iw-form-label" style={{ marginBottom: 6 }}>{t('chatwootFields.webhookUrlLabel')}</div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11.5,
                        background: 'rgba(0,0,0,0.05)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        wordBreak: 'break-all',
                      }}
                    >
                      <span style={{ flex: 1 }}>{createdProvider.webhookUrl}</span>
                      <button
                        className="st-icon-btn"
                        title={t('chatwootFields.copyUrl')}
                        onClick={() =>
                          navigator.clipboard
                            .writeText(createdProvider.webhookUrl)
                            .then(() => showToast(t('chatwootFields.urlCopied'), 'success'))
                        }
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                    <div className="iw-form-hint" style={{ marginTop: 8 }}>{t('chatwootFields.pasteHint')}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>


        <div className="iw-foot">
          <button
            className="iw-btn iw-btn-ghost"
            style={{ visibility: step === 1 ? 'hidden' : 'visible' }}
            onClick={() => setStep((s) => (selectedChannel === 'chatwoot' && s === 4 ? 2 : Math.max(1, s - 1)))}
          >
            <ArrowRight size={14} /> {t('inboxWizard.back')}
          </button>
          <button
            className="iw-btn iw-btn-primary"
            disabled={(step === 1 && !selectedChannel) || (step === 2 && (!step2Valid || creating)) || savingAgents}
            onClick={goNext}
          >
            {step === 2 && creating
              ? t('inboxWizard.creating')
              : step === 3 && savingAgents
                ? t('inboxWizard.saving')
                : step === 3
                  ? t('inboxWizard.addAgentsAndContinue')
                  : step === 4
                    ? t('inboxWizard.allDone')
                    : t('inboxWizard.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
