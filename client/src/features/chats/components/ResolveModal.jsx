import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Check } from 'lucide-react';
import useToastStore from '../../../store/toastStore';
import { conversationsApi } from '../services/chats.service';
import Modal from '../../../components/ui/Modal';

export default function ResolveModal({ conversation, categories, onClose, onResolved }) {
  const { t } = useTranslation('chats');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const showToast = useToastStore((s) => s.showToast);

  function confirm() {
    if (!selectedCategory || saving) return;
    const cat = categories.find((x) => String(x.id) === String(selectedCategory));
    const catName = cat ? cat.name : selectedCategory;
    setSaving(true);

    // Optimistic: نسكّر المودال ونحدّث الحالة فورًا، ونستنى تأكيد السيرفر في الخلفية.
    // لو فشل، بنرجّع الحالة القديمة ونوريه Toast واضح إنه يحاول تاني.
    onResolved(catName);

    conversationsApi
      .resolve(conversation.id, catName, notes.trim())
      .then(() => {
        showToast(t('resolve.successToast', { category: catName }), 'success');
      })
      .catch((err) => {
        console.error('[API] confirmResolve error:', err);
        onResolved(null, { rollback: true });
        showToast(err.response?.data?.error || t('resolve.failedToast'), 'error');
      });
  }

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon">
          <CheckCircle2 size={22} />
        </div>
        <div className="resolve-modal-title">{t('resolve.title')}</div>
      </div>
      <div className="resolve-modal-sub">{t('resolve.subtitle')}</div>

      <div className="resolve-cats-label">{t('resolve.categoryLabel')}</div>
      <div className="resolve-cats-grid">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className={`resolve-cat-card${String(selectedCategory) === String(cat.id) ? ' selected' : ''}`}
            onClick={() => setSelectedCategory(cat.id)}
          >
            {cat.icon && <span style={{ fontSize: 18 }}>{cat.icon}</span>}
            <div style={{ fontWeight: 700, fontSize: 13 }}>{cat.name}</div>
            {cat.desc && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{cat.desc}</div>}
          </div>
        ))}
      </div>

      <div className="resolve-notes-label">{t('resolve.notesLabel')}</div>
      <textarea
        className="resolve-notes"
        placeholder={t('resolve.notesPlaceholder')}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>
          {t('resolve.cancel')}
        </button>
        <button className="resolve-confirm-btn" disabled={!selectedCategory || saving} onClick={confirm}>
          <Check size={16} />
          {saving ? t('resolve.saving') : t('resolve.confirm')}
        </button>
      </div>
    </Modal>
  );
}
