import { useTranslation } from 'react-i18next';
import { Phone } from 'lucide-react';
import Modal from '../../../components/ui/Modal';

// بيظهر لو العميل عنده أكتر من رقم مرتبط بيه (أكتر من محادثة)، عشان المستخدم
// يختار بالظبط أنهي رقم عايز يفتح محادثته بدل ما نفتحله أول واحد بالصدفة
export default function ChooseConversationModal({ conversations, onChoose, onClose }) {
  const { t } = useTranslation('customerDetails');

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(var(--primary-rgb),0.12)', color: 'var(--primary)' }}>
          <Phone size={22} />
        </div>
        <div className="resolve-modal-title">{t('chooseConversationModal.title')}</div>
      </div>
      <div className="resolve-modal-sub">{t('chooseConversationModal.subtitle')}</div>

      <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 10 }}>
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => onChoose(c)}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              border: '1px solid var(--border)',
              marginBottom: 6,
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Phone size={13} /> {c.phone}
            </span>
            {c.phoneLabel && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.phoneLabel}</span>}
          </div>
        ))}
      </div>

      <div className="add-form-actions" style={{ marginTop: 12 }}>
        <button className="add-cancel" onClick={onClose}>
          {t('chooseConversationModal.cancel')}
        </button>
      </div>
    </Modal>
  );
}
