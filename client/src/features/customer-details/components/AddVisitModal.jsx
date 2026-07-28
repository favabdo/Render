import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Check } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { customerDetailsApi } from '../services/customerDetails.service';

export default function AddVisitModal({ contactId, contactName, onClose, onAdded }) {
  const { t } = useTranslation('customerDetails');
  const [visitDate, setVisitDate] = useState('');
  const [workDone, setWorkDone] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function submit() {
    setError('');
    if (!visitDate) return setError(t('addVisitModal.errors.dateRequired'));
    if (!workDone.trim()) return setError(t('addVisitModal.errors.workRequired'));
    if (saving) return;

    setSaving(true);
    const tempId = `temp_${Date.now()}`;
    const optimisticVisit = {
      id: tempId,
      visit_date: visitDate,
      work_done: workDone.trim(),
      arrival_time: arrivalTime || null,
      departure_time: departureTime || null,
      _pending: true,
    };
    // Optimistic: الزيارة الجديدة بتظهر فورًا في اللستة، والمودال بيتقفل على طول
    onAdded({ optimistic: true, tempVisit: optimisticVisit });

    customerDetailsApi
      .addVisit(contactId, {
        visitDate,
        workDone: workDone.trim(),
        arrivalTime: arrivalTime || null,
        departureTime: departureTime || null,
      })
      .then(() => onAdded({ confirmed: true, tempId }))
      .catch((err) => {
        console.error('[API] submitVisit error:', err);
        onAdded({ rollback: true, tempId, error: err.response?.data?.error || t('addVisitModal.errors.genericError') });
      });
  }

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary)' }}>
          <CalendarPlus size={22} />
        </div>
        <div className="resolve-modal-title">{t('addVisitModal.title')}</div>
      </div>

      <div className="resolve-cats-label">{t('addVisitModal.customer')}</div>
      <div className="st-modal-readonly-value" style={{ marginBottom: 14 }}>{contactName}</div>

      <div className="resolve-cats-label">{t('addVisitModal.visitDate')}</div>
      <input type="date" className="iw-input" style={{ marginBottom: 14 }} value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />

      <div className="resolve-cats-label">{t('addVisitModal.workDone')}</div>
      <textarea className="resolve-notes" style={{ marginBottom: 14 }} value={workDone} onChange={(e) => setWorkDone(e.target.value)} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 6 }}>
        <div>
          <div className="resolve-cats-label" style={{ marginTop: 0 }}>{t('addVisitModal.arrivalOptional')}</div>
          <input type="time" className="iw-input" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
        </div>
        <div>
          <div className="resolve-cats-label" style={{ marginTop: 0 }}>{t('addVisitModal.departureOptional')}</div>
          <input type="time" className="iw-input" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} />
        </div>
      </div>

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>{t('addVisitModal.cancel')}</button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={submit}>
          <Check size={16} /> {saving ? t('addVisitModal.saving') : t('addVisitModal.save')}
        </button>
      </div>
      {error && <div className="login-error" style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10, textAlign: 'center' }}>{error}</div>}
    </Modal>
  );
}
