import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, ArrowRight, Phone } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { contactsApi } from '../../contacts/services/contacts.service';
import { customerDetailsApi } from '../services/customerDetails.service';
import useToastStore from '../../../store/toastStore';

// دمج رقم (عميل مسجل أو رقم غير مسجل) مع العميل اللي فاتحين صفحة تفاصيله دلوقتي.
// نفس بالظبط فانكشن الدمج المستخدمة من كارت المحادثة (MergeContactSection):
// بتنادي POST /api/conversations/:id/contact { mode:'link', contactId } — الفرق
// الوحيد إن هنا العميل المستهدف (target) ثابت (هو صاحب الصفحة)، والمصدر (اللي
// هيتدمج فيه) هو اللي بيدوّر عليه المستخدم من قايمة كل الكونتاكتس
export default function MergeNumberModal({ contactId, onClose, onMerged }) {
  const { t } = useTranslation('customerDetails');
  const showToast = useToastStore((s) => s.showToast);

  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  // لو الكونتاكت المختار عنده أكتر من رقم واحد، بنعرض خطوة تانية يختار فيها
  // بالظبط أنهي رقم من أرقامه عايز يدمجه
  const [phoneChoice, setPhoneChoice] = useState(null); // { contact, conversations }

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
    // كونتاكت برقم واحد بس -> ندمج على طول من غير خطوة اختيار زيادة
    if ((ct.phones || []).length <= 1) {
      return mergeByPhone(ct, (ct.phones || [])[0]?.phone_number);
    }
    setLoading(true);
    try {
      const conversations = await customerDetailsApi.getContactConversations(ct.id);
      setPhoneChoice({ contact: ct, conversations });
    } catch (err) {
      console.error('[API] loadContactConversationsForMerge error:', err);
      showToast(t('mergeModal.mergeFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function mergeByPhone(ct, phoneNumber) {
    if (!phoneNumber || merging) return;
    setMerging(true);
    try {
      // endpoint الدمج شغال على مستوى المحادثة، فلازم نلاقي المحادثة المرتبطة
      // بالرقم ده الأول (زي بالظبط اللي بيحصل جوه المحادثة نفسها)
      const conversations =
        phoneChoice && phoneChoice.contact.id === ct.id
          ? phoneChoice.conversations
          : await customerDetailsApi.getContactConversations(ct.id);
      const conv = conversations.find((c) => c.contact_number === phoneNumber);
      if (!conv) {
        showToast(t('mergeModal.noConversation'), 'error');
        return;
      }
      await customerDetailsApi.mergeConversationIntoContact(conv.id, contactId);
      showToast(t('mergeModal.mergeSuccess'), 'success');
      onMerged();
    } catch (err) {
      console.error('[API] mergeNumber error:', err);
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

      {!phoneChoice ? (
        <>
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
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0 8px', fontSize: 13, fontWeight: 600 }}>
            <button className="st-icon-btn" onClick={() => setPhoneChoice(null)} title={t('mergeModal.back')} disabled={merging}>
              <ArrowRight size={14} />
            </button>
            {t('mergeModal.chooseNumberTitle')}
          </div>
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            {phoneChoice.contact.phones.map((p) => (
              <div
                key={p.phone_number}
                onClick={() => mergeByPhone(phoneChoice.contact, p.phone_number)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  cursor: merging ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  opacity: merging ? 0.6 : 1,
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Phone size={13} />
                <span style={{ fontSize: 13.5 }}>{p.phone_number}</span>
                {p.label && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>({p.label})</span>}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="add-form-actions" style={{ marginTop: 12 }}>
        <button className="add-cancel" onClick={onClose} disabled={merging}>
          {t('mergeModal.cancel')}
        </button>
      </div>
    </Modal>
  );
}
