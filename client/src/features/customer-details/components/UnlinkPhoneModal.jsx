import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Unlink, Check } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { contactsApi } from '../../contacts/services/contacts.service';

// فصل رقم تليفون من عميل عنده أكتر من رقم — بيتحول الرقم لكارت عميل جديد
// منفصل (بنفس الاسم افتراضيًا)، والمحادثات القديمة بتاعة الرقم ده بتتبع
// الكارت الجديد بدل القديم. نفس بالظبط لوجيك render.
export default function UnlinkPhoneModal({ contactId, phone, defaultName, onClose, onUnlinked }) {
  const { t } = useTranslation('customerDetails');
  const [newName, setNewName] = useState(defaultName || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError('');
    setSaving(true);
    try {
      await contactsApi.unlinkPhone(contactId, phone, newName.trim() || undefined);
      onUnlinked();
    } catch (err) {
      console.error('[API] confirmUnlinkPhone error:', err);
      setError(err.response?.data?.error || t('unlinkModal.genericError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(214,69,69,0.12)', color: 'var(--danger)' }}>
          <Unlink size={22} />
        </div>
        <div className="resolve-modal-title">{t('unlinkModal.title')}</div>
      </div>
      <div className="resolve-modal-sub">
        {t('unlinkModal.subtitle', { phone })}
      </div>

      <div className="resolve-cats-label">{t('unlinkModal.newCustomerName')}</div>
      <input
        type="text"
        className="iw-input"
        placeholder={t('unlinkModal.newCustomerNamePlaceholder')}
        style={{ marginBottom: 6 }}
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
      />

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>{t('unlinkModal.cancel')}</button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={submit}>
          <Check size={16} /> {saving ? t('unlinkModal.unlinking') : t('unlinkModal.confirm')}
        </button>
      </div>
      {error && <div className="login-error" style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>{error}</div>}
    </Modal>
  );
}
