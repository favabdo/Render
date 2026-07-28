import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus2, Check } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import ContractDurationPicker from '../../../components/shared/ContractDurationPicker';
import { customerDetailsApi } from '../services/customerDetails.service';

export default function AddMaintenanceContractModal({ contactId, contactName, onClose, onAdded }) {
  const { t } = useTranslation('customerDetails');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function submit() {
    setError('');
    if (!startDate) return setError(t('addContractModal.errors.startRequired'));
    if (!endDate) return setError(t('addContractModal.errors.endRequired'));
    if (new Date(endDate) < new Date(startDate)) return setError(t('addContractModal.errors.endBeforeStart'));
    if (saving) return;

    setSaving(true);
    const tempId = `temp_${Date.now()}`;
    const optimisticContract = {
      id: tempId,
      start_date: startDate,
      end_date: endDate,
      notes: notes.trim() || null,
      status: 'active',
      _pending: true,
    };
    // Optimistic: العقد الجديد بيظهر فورًا في اللستة (بحالة pending)، والمودال
    // بيتقفل على طول من غير ما نستنى رد السيرفر
    onAdded({ optimistic: true, tempContract: optimisticContract });

    customerDetailsApi
      .addMaintenanceContract(contactId, { startDate, endDate, notes: notes.trim() || undefined })
      .then((data) => onAdded({ confirmed: true, tempId, data: data.contact }))
      .catch((err) => {
        console.error('[API] submitMaintenanceContract error:', err);
        onAdded({ rollback: true, tempId, error: err.response?.data?.error || t('addContractModal.errors.genericError') });
      });
  }

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary)' }}>
          <FilePlus2 size={22} />
        </div>
        <div className="resolve-modal-title">{t('addContractModal.title')}</div>
      </div>

      <div className="resolve-cats-label">{t('addContractModal.customer')}</div>
      <div className="st-modal-readonly-value" style={{ marginBottom: 14 }}>{contactName}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div>
          <div className="resolve-cats-label" style={{ marginTop: 0 }}>{t('addContractModal.startDate')}</div>
          <input type="date" className="iw-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <div className="resolve-cats-label" style={{ marginTop: 0 }}>{t('addContractModal.endDate')}</div>
          <input type="date" className="iw-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="resolve-cats-label" style={{ marginTop: 4 }}>{t('addContractModal.durationOptional')}</div>
      <ContractDurationPicker startDate={startDate} onEndDateChange={setEndDate} />
      <div className="iw-form-hint" style={{ marginTop: -2, marginBottom: 14 }}>
        {t('addContractModal.durationHint')}
      </div>

      <div className="resolve-cats-label">{t('addContractModal.notesOptional')}</div>
      <textarea className="resolve-notes" style={{ marginBottom: 6 }} value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>{t('addContractModal.cancel')}</button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={submit}>
          <Check size={16} /> {saving ? t('addContractModal.saving') : t('addContractModal.save')}
        </button>
      </div>
      {error && <div className="login-error" style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10, textAlign: 'center' }}>{error}</div>}
    </Modal>
  );
}
