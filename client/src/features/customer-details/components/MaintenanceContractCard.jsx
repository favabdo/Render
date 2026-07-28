import { useTranslation } from 'react-i18next';
import { UserRound, CircleSlash, Clock, AlertTriangle, ShieldCheck, OctagonPause, Trash2 } from 'lucide-react';
import { formatSchedDate } from '../../../utils/dateFormat';
import { customerDetailsApi } from '../services/customerDetails.service';
import useToastStore from '../../../store/toastStore';
import useAuthStore from '../../../store/authStore';

function contractStatus(contract, t) {
  if (contract.status === 'stopped') {
    return { label: t('contractStatus.stopped'), color: 'var(--text-secondary)', Icon: CircleSlash };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(contract.start_date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(contract.end_date);
  end.setHours(0, 0, 0, 0);
  if (today < start) return { label: t('contractStatus.upcoming'), color: 'var(--text-secondary)', Icon: Clock };
  if (today > end) return { label: t('contractStatus.expired'), color: 'var(--danger)', Icon: AlertTriangle };
  return { label: t('contractStatus.active'), color: 'var(--success)', Icon: ShieldCheck };
}

const isOwnerOrAdmin = (user) => (user?.role ?? 2) <= 1;

export default function MaintenanceContractCard({ contract, contactId, onPatch, onRemove, onRestore, onReload }) {
  const { t } = useTranslation('customerDetails');
  const status = contractStatus(contract, t);
  const showToast = useToastStore((s) => s.showToast);
  const { user } = useAuthStore();
  const canManage = isOwnerOrAdmin(user);

  function handleStop() {
    if (!window.confirm(t('contractCard.confirmStop'))) return;
    // Optimistic: حالة العقد بتتغير لـ "متوقف" فورًا على الكارت
    onPatch({ status: 'stopped' });
    customerDetailsApi
      .stopMaintenanceContract(contactId, contract.id)
      .then(() => {
        showToast(t('contractCard.stopSuccess'), 'success');
        onReload(); // عشان أي ملخص مبني على العقد (زي remainingLabel) يتزامن مع السيرفر
      })
      .catch((err) => {
        console.error('[API] stopMaintenanceContract error:', err);
        onReload(); // رجّع الحالة الحقيقية بدل ما نخمّن رجوعها يدويًا
        showToast(err.response?.data?.error || t('contractCard.stopFailed'), 'error');
      });
  }

  function handleDelete() {
    if (!window.confirm(t('contractCard.confirmDelete'))) return;
    // Optimistic: العقد بيتشال من اللستة فورًا، ولو الحذف فشل بنرجّعه تاني
    onRemove();
    customerDetailsApi
      .deleteMaintenanceContract(contactId, contract.id)
      .then(() => showToast(t('contractCard.deleteSuccess'), 'success'))
      .catch((err) => {
        console.error('[API] deleteMaintenanceContract error:', err);
        onRestore(contract);
        showToast(err.response?.data?.error || t('contractCard.deleteFailed'), 'error');
      });
  }
  return (
    <div className={`sched-task-card${contract._pending ? ' opt-pending' : ''}`}>
      <div className="sched-task-subrow">
        <span style={{ fontWeight: 700, color: status.color }}>
          <status.Icon size={13} />
          {status.label}
        </span>
        {contract.created_by_name && (
          <span>
            <UserRound size={13} />
            {contract.created_by_name}
          </span>
        )}
      </div>
      <div className="st-modal-readonly-row" style={{ marginTop: 8 }}>
        <div className="st-modal-readonly">
          <div className="st-modal-readonly-label">{t('contractCard.startDate')}</div>
          <div className="st-modal-readonly-value">{formatSchedDate(contract.start_date)}</div>
        </div>
        <div className="st-modal-readonly">
          <div className="st-modal-readonly-label">{t('contractCard.endDate')}</div>
          <div className="st-modal-readonly-value">{formatSchedDate(contract.end_date)}</div>
        </div>
      </div>
      {contract.notes && (
        <div className="sched-task-text" style={{ marginTop: 8 }}>
          {contract.notes}
        </div>
      )}
      {canManage && (
        <div className="sched-task-actions">
          {contract.status !== 'stopped' && (
            <button className="sched-end-btn" disabled={contract._pending} onClick={handleStop}>
              <OctagonPause size={13} /> {t('contractCard.stopContract')}
            </button>
          )}
          <button className="sched-end-btn" style={{ background: 'var(--danger)', marginInlineStart: 8 }} disabled={contract._pending} onClick={handleDelete}>
            <Trash2 size={13} /> {t('contractCard.delete')}
          </button>
        </div>
      )}
    </div>
  );
}
