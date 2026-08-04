import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { companyApi } from '../services/settings.service';
import useAuthStore from '../../../store/authStore';
import useToastStore from '../../../store/toastStore';

const isOwnerOrAdmin = (user) => (user?.role ?? 2) <= 1;

export default function GeneralSection() {
  const { t, i18n } = useTranslation('settings');
  const { user } = useAuthStore();
  const showToast = useToastStore((s) => s.showToast);
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [autoResolveDays, setAutoResolveDays] = useState('');
  const canEdit = isOwnerOrAdmin(user);

  function autoResolveLabel(days) {
    if (!days) return t('general.disabled');
    return `${days} ${Number(days) === 1 ? t('general.day') : t('general.days')}`;
  }

  useEffect(() => {
    companyApi
      .getSettings()
      .then((data) => {
        setSettings(data);
        setName(data.name || '');
        setAutoResolveDays(data.auto_resolve_days ? String(data.auto_resolve_days) : '');
      })
      .catch((err) => console.error('[API] loadAccountSettings error:', err));
  }, []);

  function startOrSave() {
    if (!canEdit) return;
    if (!editing) {
      setEditing(true);
      return;
    }
    save();
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) {
      showToast(t('general.nameTooShort'), 'error');
      return;
    }
    try {
      const data = await companyApi.updateSettings({
        name: trimmed,
        auto_resolve_days: autoResolveDays ? Number(autoResolveDays) : null,
      });
      setSettings(data);
      setEditing(false);
      showToast(t('general.updateSuccess'), 'success');
    } catch (err) {
      console.error('[API] saveAccountSettings error:', err);
      showToast(err.response?.data?.error || t('general.saveFailed'), 'error');
    }
  }

  if (!settings) {
    return (
      <div className="settings-content-section active" id="settings-sec-general">
        <div className="page-content">
          <div className="settings-top-row">
            <div>
              <h2>{t('general.title')}</h2>
            </div>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('general.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-content-section active" id="settings-sec-general">
      <div className="page-content">
        <div className="settings-top-row">
          <div>
            <h2>{t('general.title')}</h2>
            <div className="settings-top-desc">{t('general.subtitle')}</div>
          </div>
          {canEdit && (
            <button className="page-btn" onClick={startOrSave}>
              {editing ? t('general.saveChanges') : t('general.updateSettings')}
            </button>
          )}
        </div>
        <div className="settings-section">
          <h3>{t('general.sectionTitle')}</h3>
          <div className="setting-row">
            <div>
              <div className="setting-label">{t('general.accountName')}</div>
              <div className="setting-desc">{t('general.accountNameDesc')}</div>
            </div>
            {!editing ? (
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{settings.name}</span>
            ) : (
              <input
                type="text"
                className="iw-input"
                style={{ maxWidth: 260, width: 'auto' }}
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            )}
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">{t('general.siteLanguage')}</div>
              <div className="setting-desc">{t('general.siteLanguageDesc')}</div>
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              {i18n.language === 'ar' ? t('general.languageArabic') : t('general.languageEnglish')}
            </span>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">{t('general.emailContinuity')}</div>
              <div className="setting-desc">{t('general.emailContinuityDesc')}</div>
            </div>
            <span
              style={{
                fontSize: 13,
                color: 'var(--success)',
                fontWeight: 600,
                background: 'rgba(16,185,129,0.1)',
                padding: '4px 10px',
                borderRadius: 8,
              }}
            >
              {t('general.enabled')}
            </span>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">{t('general.autoResolve')}</div>
              <div className="setting-desc">{t('general.autoResolveDesc')}</div>
            </div>
            {!editing ? (
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{autoResolveLabel(settings.auto_resolve_days)}</span>
            ) : (
              <select
                className="iw-input"
                style={{ maxWidth: 180, width: 'auto' }}
                value={autoResolveDays}
                onChange={(e) => setAutoResolveDays(e.target.value)}
              >
                <option value="">{t('general.disabled')}</option>
                {[1, 2, 3, 5, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} {d === 1 ? t('general.day') : t('general.days')}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">{t('general.accountId')}</div>
              <div className="setting-desc">{t('general.accountIdDesc')}</div>
            </div>
            <span
              style={{
                fontSize: 13,
                color: 'var(--primary)',
                fontWeight: 600,
                background: 'rgba(var(--primary-rgb),0.08)',
                padding: '4px 10px',
                borderRadius: 8,
              }}
            >
              #{settings.id}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
