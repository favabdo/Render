import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Send } from 'lucide-react';
import { agentsSettingsApi } from '../services/settings.service';
import useToastStore from '../../../store/toastStore';
import Modal from '../../../components/ui/Modal';

export default function AddAgentModal({ onClose, onAdded }) {
  const { t } = useTranslation('settings');
  const showToast = useToastStore((s) => s.showToast);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('2');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return showToast(t('addAgentModal.emailRequired'), 'error');

    setSaving(true);
    try {
      const data = await agentsSettingsApi.create({ email: trimmedEmail, role: Number(role) });
      if (name.trim() && data.user?.id) {
        try {
          await agentsSettingsApi.update(data.user.id, { display_name: name.trim() });
        } catch (nameErr) {
          console.error('[API] set new agent display_name error:', nameErr);
        }
      }
      if (data.email_sent) {
        showToast(t('addAgentModal.inviteSent'), 'success');
      } else {
        showToast(t('addAgentModal.inviteEmailFailed'), 'error');
      }
      onAdded(data);
    } catch (err) {
      console.error('[API] submitAddAgent error:', err);
      showToast(err.response?.data?.error || t('addAgentModal.addFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary)' }}>
          <UserPlus size={22} />
        </div>
        <div className="resolve-modal-title">{t('addAgentModal.title')}</div>
      </div>
      <div className="resolve-modal-sub">{t('addAgentModal.subtitle')}</div>

      <div className="resolve-cats-label">{t('addAgentModal.nameOptional')}</div>
      <input
        type="text"
        className="iw-input"
        placeholder={t('addAgentModal.namePlaceholder')}
        style={{ marginBottom: 14 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="resolve-cats-label">{t('addAgentModal.email')}</div>
      <input
        type="email"
        className="iw-input"
        placeholder="agent@example.com"
        style={{ marginBottom: 14 }}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <div className="resolve-cats-label">{t('addAgentModal.role')}</div>
      <select className="iw-input" style={{ marginBottom: 6 }} value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="2">{t('addAgentModal.roleAgent')}</option>
        <option value="3">{t('addAgentModal.roleCrmAgent')}</option>
        <option value="1">{t('addAgentModal.roleAdmin')}</option>
        <option value="0">{t('addAgentModal.roleOwner')}</option>
      </select>

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>
          {t('addAgentModal.cancel')}
        </button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={submit}>
          <Send size={16} /> {saving ? t('addAgentModal.sending') : t('addAgentModal.sendInvite')}
        </button>
      </div>
    </Modal>
  );
}
