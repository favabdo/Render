import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { contactsApi } from '../../contacts/services/contacts.service';
import { customerDetailsApi } from '../services/customerDetails.service';
import useToastStore from '../../../store/toastStore';

// دمج كارت العميل اللي فاتحين صفحته دلوقتي (contactId) جوه كارت عميل تاني —
// المستخدم بيدوّر على الكونتاكت المستهدف (زي دمج الكونتاكت في كارت المحادثة
// MergeContactSection بالظبط)، لكن هنا الاتجاه معكوس: العميل الحالي هو
// المصدر اللي هيتشال، وكل أرقامه ومحادثاته بتتنقل للعميل المختار (الهدف).
// عمدًا مفيش خطوة "اختار رقم" هنا؛ الدمج بيبقى على مستوى الكارت كله مش رقم
// واحد بس
export default function MergeNumberModal({ contactId, onClose, onMerged }) {
  const { t } = useTranslation('customerDetails');
  const showToast = useToastStore((s) => s.showToast);

  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    contactsApi
      .list()
      .then(setContacts)
      .catch((err) => {
        console.error('[API] loadAllContactsForMerge error:', err);
        setContacts([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const q = search.trim().toLowerCase();
  const candidates = (contacts || [])
    .filter((ct) => {
      if (String(ct.id) === String(contactId)) return false; // مينفعش تدمج العميل في نفسه
      if (!q) return true;
      const haystack = `${ct.name || ''} ${(ct.phones || []).map((p) => p.phone_number || '').join(' ')}`.toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, 25);

  async function pickCandidate(ct) {
    if (merging) return;
    setMerging(true);
    try {
      const merged = await customerDetailsApi.mergeIntoContact(contactId, ct.id);
      showToast(t('mergeModal.mergeSuccess'), 'success');
      onMerged(merged.id);
    } catch (err) {
      console.error('[API] mergeContact error:', err);
      showToast(err.response?.data?.error || t('mergeModal.mergeFailed'), 'error');
    } finally {
      setMerging(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary)' }}>
          <Link2 size={22} />
        </div>
        <div className="resolve-modal-title">{t('mergeModal.title')}</div>
      </div>
      <div className="resolve-modal-sub">{t('mergeModal.subtitle')}</div>

      <input
        type="text"
        className="iw-input"
        style={{ marginTop: 10, marginBottom: 10 }}
        placeholder={t('mergeModal.searchPlaceholder')}
        value={search}
        autoFocus
        onChange={(e) => setSearch(e.target.value)}
      />
      <div style={{ maxHeight: 280, overflow: 'auto' }}>
        {loading && (
          <div className="iw-empty" style={{ padding: '8px 0', textAlign: 'center', fontSize: 13 }}>
            {t('mergeModal.loading')}
          </div>
        )}
        {!loading && candidates.length === 0 && (
          <div className="iw-empty" style={{ padding: '8px 0', textAlign: 'center', fontSize: 13 }}>
            {t('mergeModal.noResults')}
          </div>
        )}
        {!loading &&
          candidates.map((ct) => (
            <div
              key={ct.id}
              onClick={() => pickCandidate(ct)}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                cursor: merging ? 'default' : 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                opacity: merging ? 0.6 : 1,
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{ct.name || t('mergeModal.noName')}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {(ct.phones || []).length > 1
                  ? `${ct.phones[0]?.phone_number || ''} +${ct.phones.length - 1}`
                  : (ct.phones || [])[0]?.phone_number || ''}
              </span>
            </div>
          ))}
      </div>

      <div className="add-form-actions" style={{ marginTop: 12 }}>
        <button className="add-cancel" onClick={onClose} disabled={merging}>
          {t('mergeModal.cancel')}
        </button>
      </div>
    </Modal>
  );
}
