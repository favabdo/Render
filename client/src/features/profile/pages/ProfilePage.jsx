import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Upload, Lock, Eye, EyeOff, Copy, X } from 'lucide-react';
import Avatar from '../../../components/ui/Avatar';
import useAuthStore from '../../../store/authStore';
import useToastStore from '../../../store/toastStore';
import { roleLabel } from '../../../utils/roles';
import { meApi } from '../services/profile.service';
import EditableFieldRow from '../components/EditableFieldRow';
import NotifPrefsTable from '../components/NotifPrefsTable';
import ImageCropModal from '../components/ImageCropModal';

export default function ProfilePage() {
  const { t } = useTranslation('profile');
  const { user, setAuth, token } = useAuthStore();
  const showToast = useToastStore((s) => s.showToast);

  function getPushButtonState() {
    if (typeof window === 'undefined' || !('Notification' in window)) return { text: t('notSupported'), disabled: true };
    if (Notification.permission === 'granted') return { text: t('enabled'), disabled: true };
    if (Notification.permission === 'denied') return { text: t('blockedByBrowser'), disabled: true };
    return { text: t('enable'), disabled: false };
  }

  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [pushState, setPushState] = useState(getPushButtonState());
  const [notifPrefs, setNotifPrefs] = useState({});
  const [cropSrc, setCropSrc] = useState(null);

  useEffect(() => {
    meApi
      .get()
      .then((data) => setAuth(token, { ...user, ...data }))
      .catch((err) => console.error('[API] refreshCurrentUser error:', err));
    meApi
      .getNotificationPrefs()
      .then((prefs) => setNotifPrefs(prefs || {}))
      .catch((err) => console.error('[API] getNotificationPrefs error:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchUser(patch) {
    setAuth(token, { ...user, ...patch });
  }

  async function saveField(field, value) {
    const trimmed = (value || '').trim();
    if (field === 'display_name' && trimmed.length < 2) {
      showToast(t('errors.nameTooShort'), 'error');
      return false;
    }
    if (field === 'email' && !trimmed) {
      showToast(t('errors.emailRequired'), 'error');
      return false;
    }
    try {
      const data = await meApi.update({ [field]: trimmed });
      patchUser({ [field]: data.user[field] });
      showToast(t('success.updated'), 'success');
      return true;
    } catch (err) {
      console.error('[API] submitProfileFieldChange error:', err);
      showToast(err.response?.data?.error || t('failures.updateFailed'), 'error');
      return false;
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast(t('errors.invalidImage'), 'error');
    if (file.size > 5 * 1024 * 1024) return showToast(t('errors.imageTooLarge'), 'error');
    // بدل ما نرفع الملف زي ما هو، بنفتح مودال القص أولًا عشان الإيجنت يقدر
    // يتحكم في أبعاد وحجم الصورة (تكبير/تصغير وتحريك) قبل ما ترفع فعليًا
    setCropSrc(URL.createObjectURL(file));
  }

  function handleCropCancel() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }

  async function handleCropSave(blob) {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    try {
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      const data = await meApi.uploadAvatar(file);
      patchUser({ avatar_url: data.avatar_url });
      showToast(t('success.avatarUpdated'), 'success');
    } catch (err) {
      console.error('[API] handleProfileAvatarSelected error:', err);
      showToast(err.response?.data?.error || t('failures.avatarUploadFailed'), 'error');
    }
  }

  async function handleAvatarRemove() {
    if (!user.avatar_url) return showToast(t('errors.noAvatarYet'), 'info');
    try {
      await meApi.removeAvatar();
      patchUser({ avatar_url: null });
      showToast(t('success.avatarRemoved'), 'success');
    } catch (err) {
      console.error('[API] removeProfileAvatar error:', err);
      showToast(err.response?.data?.error || t('failures.avatarRemoveFailed'), 'error');
    }
  }

  async function submitPasswordChange() {
    if (!pwCurrent || !pwNew || !pwConfirm) return showToast(t('errors.fillAllPasswordFields'), 'error');
    if (pwNew.length < 6) return showToast(t('errors.passwordTooShort'), 'error');
    if (pwNew !== pwConfirm) return showToast(t('errors.passwordMismatch'), 'error');

    try {
      await meApi.changePassword(pwCurrent, pwNew);
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      showToast(t('success.passwordUpdated'), 'success');
    } catch (err) {
      console.error('[API] submitPasswordChange error:', err);
      showToast(err.response?.data?.error || t('failures.passwordUpdateFailed'), 'error');
    }
  }

  async function toggleNotifPref(key, channel, checked) {
    const prevPrefs = notifPrefs;
    const nextPrefs = { ...prevPrefs, [key]: { ...(prevPrefs[key] || {}), [channel]: checked } };
    setNotifPrefs(nextPrefs);
    try {
      const saved = await meApi.updateNotifPrefs(nextPrefs);
      setNotifPrefs(saved);
    } catch (err) {
      console.error('[API] toggleNotifPref error:', err);
      showToast(err.response?.data?.error || t('failures.notifPrefsSaveFailed'), 'error');
      setNotifPrefs(prevPrefs);
    }
  }

  async function requestPushPermission() {
    if (!('Notification' in window)) return showToast(t('errors.notificationsNotSupported'), 'error');
    try {
      const perm = await Notification.requestPermission();
      setPushState(getPushButtonState());
      if (perm === 'granted') {
        showToast(t('success.pushEnabled'), 'success');
        new Notification('NileChat', { body: t('success.pushNotifBody') });
      } else {
        showToast(t('errors.notificationsBlocked'), 'error');
      }
    } catch (err) {
      console.error('[Push] requestPushPermission error:', err);
    }
  }

  async function regenerateAccessToken() {
    if (user?.access_token && !window.confirm(t('confirmRegenerateToken'))) return;
    try {
      const data = await meApi.regenerateToken();
      patchUser({ access_token: data.access_token });
      setTokenVisible(true);
      showToast(t('success.tokenGenerated'), 'success');
    } catch (err) {
      console.error('[API] regenerateAccessToken error:', err);
      showToast(err.response?.data?.error || t('failures.tokenGenerateFailed'), 'error');
    }
  }

  function copyAccessToken() {
    if (!user?.access_token) return showToast(t('errors.regenerateFirst'), 'error');
    navigator.clipboard
      .writeText(user.access_token)
      .then(() => showToast(t('success.tokenCopied'), 'success'))
      .catch(() => showToast(t('errors.copyFailed'), 'error'));
  }

  if (!user) return null;
  const displayName = user.display_name || user.email;
  const tokenFieldValue =
    tokenVisible && user.access_token
      ? user.access_token
      : user.access_token
        ? '•'.repeat(28)
        : t('accessToken.noTokenYet');

  return (
    <div id="page-profile" className="page">
      <div
        className="page-content"
        style={{ maxWidth: 700, margin: '0 auto', padding: '32px 24px', overflowY: 'auto', width: '100%' }}
      >
        <div className="settings-top-row">
          <div>
            <h2>{t('pageTitle')}</h2>
            <div className="settings-top-desc">{t('pageSubtitle')}</div>
          </div>
        </div>

        <div className="settings-section">
          <h3>{t('profilePicture.title')}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 4, flexWrap: 'wrap', minWidth: 0 }}>
            <div
              style={{ position: 'relative', cursor: 'pointer' }}
              title={t('profilePicture.changeTitle')}
              aria-label={t('profilePicture.changeTitle')}
              onClick={() => document.getElementById('profile-avatar-input').click()}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: '3px solid var(--primary-light)',
                }}
              >
                <Avatar name={displayName} seed={`agent-${user.id}`} size={64} imageSrc={user.avatar_url || null} />
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'var(--primary)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid var(--surface)',
                }}
              >
                <Camera size={12} />
              </div>
            </div>
            <div style={{ minWidth: 0, flex: '1 1 auto', overflowWrap: 'anywhere' }}>
              <div style={{ fontWeight: 700, fontSize: 16, overflowWrap: 'anywhere' }}>{displayName}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{user.email}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  className="st-icon-btn"
                  style={{
                    width: 'auto',
                    padding: '4px 10px',
                    gap: 6,
                    display: 'inline-flex',
                    background: 'var(--bg)',
                    fontSize: 12,
                  }}
                  onClick={() => document.getElementById('profile-avatar-input').click()}
                >
                  <Upload size={13} /> {t('profilePicture.uploadPhoto')}
                </button>
                {user.avatar_url && (
                  <button
                    className="st-icon-btn"
                    style={{
                      width: 'auto',
                      padding: '4px 10px',
                      gap: 6,
                      display: 'inline-flex',
                      background: 'var(--bg)',
                      fontSize: 12,
                    }}
                    title={t('profilePicture.removePhoto')}
                    aria-label={t('profilePicture.removePhoto')}
                    onClick={handleAvatarRemove}
                  >
                    <X size={13} /> {t('profilePicture.remove')}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{t('profilePicture.formatsHint')}</div>
            </div>
            <input
              type="file"
              id="profile-avatar-input"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarChange}
            />
          </div>
        </div>

        <div className="settings-section">
          <h3>{t('personalInfo.title')}</h3>
          <EditableFieldRow
            label={t('personalInfo.fullName')}
            desc={t('personalInfo.fullNameDesc')}
            value={user.full_name}
            placeholder={t('personalInfo.fullNamePlaceholder')}
            onSave={(v) => saveField('full_name', v)}
          />
          <EditableFieldRow
            label={t('personalInfo.displayName')}
            desc={t('personalInfo.displayNameDesc')}
            value={displayName}
            onSave={(v) => saveField('display_name', v)}
          />
          <EditableFieldRow
            label={t('personalInfo.email')}
            desc={t('personalInfo.emailDesc')}
            value={user.email}
            type="email"
            onSave={(v) => saveField('email', v)}
          />
          <div className="setting-row">
            <div>
              <div className="setting-label">{t('personalInfo.role')}</div>
              <div className="setting-desc">{t('personalInfo.roleDesc')}</div>
            </div>
            <span style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 600 }}>{roleLabel(user.role)}</span>
          </div>
        </div>

        <div className="settings-section">
          <h3>{t('password.title')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="password"
              className="iw-input"
              placeholder={t('password.current')}
              autoComplete="current-password"
              value={pwCurrent}
              onChange={(e) => setPwCurrent(e.target.value)}
            />
            <input
              type="password"
              className="iw-input"
              placeholder={t('password.new')}
              autoComplete="new-password"
              value={pwNew}
              onChange={(e) => setPwNew(e.target.value)}
            />
            <input
              type="password"
              className="iw-input"
              placeholder={t('password.confirm')}
              autoComplete="new-password"
              value={pwConfirm}
              onChange={(e) => setPwConfirm(e.target.value)}
            />
            <button className="page-btn" style={{ alignSelf: 'flex-start' }} onClick={submitPasswordChange}>
              <Lock size={14} /> {t('password.update')}
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>{t('notifications.title')}</h3>
          <div className="setting-row" style={{ borderBottom: '1px solid var(--border)' }}>
            <div>
              <div className="setting-label">{t('notifications.enablePush')}</div>
              <div className="setting-desc">{t('notifications.enablePushDesc')}</div>
            </div>
            <button
              className="page-btn"
              style={{ padding: '8px 14px' }}
              disabled={pushState.disabled}
              onClick={requestPushPermission}
            >
              {pushState.text}
            </button>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <NotifPrefsTable prefs={notifPrefs} onToggle={toggleNotifPref} />
          </div>
        </div>

        <div className="settings-section">
          <h3>{t('accessToken.title')}</h3>
          <div className="setting-desc" style={{ marginBottom: 12 }}>
            {t('accessToken.desc')}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="iw-input readonly"
              value={tokenFieldValue}
            />
            <button
              className="st-icon-btn"
              style={{ background: 'var(--bg)' }}
              title={t('accessToken.showHide')}
              aria-label={t('accessToken.showHide')}
              onClick={() =>
                user.access_token ? setTokenVisible((v) => !v) : showToast(t('errors.regenerateFirst'), 'error')
              }
            >
              {tokenVisible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              className="st-icon-btn"
              style={{ background: 'var(--bg)' }}
              title={t('accessToken.copy')}
              aria-label={t('accessToken.copy')}
              onClick={copyAccessToken}
            >
              <Copy size={15} />
            </button>
            <button className="page-btn" style={{ background: 'var(--danger)' }} onClick={regenerateAccessToken}>
              {t('accessToken.regenerate')}
            </button>
          </div>
        </div>
      </div>
      {cropSrc && <ImageCropModal imageSrc={cropSrc} onCancel={handleCropCancel} onSave={handleCropSave} />}
    </div>
  );
}
