import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import { contactsApi } from '../../contacts/services/contacts.service';
import useChatsStore from '../store/chatsStore';
import useToastStore from '../../../store/toastStore';

// دمج رقم المحادثة الحالية مع كونتاكت موجود بالفعل (مثلاً العميل بعت من رقم
// جديد، والإيجنت عرفه إنه نفس عميل قديم). منفصل تمامًا عن "Add Phone" اللي
// بيضيف رقم جديد لنفس الكونتاكت الحالي.
export default function MergeContactSection({ conversation }) {
  const { t } = useTranslation('chats');
  const showToast = useToastStore((s) => s.showToast);
  const linkConversationContact = useChatsStore((s) => s.linkConversationContact);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState(null); // null = لسه متحملتش
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);

  const c = conversation;

  async function show() {
    setOpen(true);
    setSearch('');
    if (contacts === null) {
      setLoading(true);
      try {
        const rows = await contactsApi.list();
        setContacts(rows);
      } catch (err) {
        console.error('[API] loadAllContacts error:', err);
        setContacts([]);
      } finally {
        setLoading(false);
      }
    }
  }

  function hide() {
    setOpen(false);
  }

  async function confirmMerge(contactId) {
    setMerging(true);
    try {
      await linkConversationContact(c.id, contactId);
      setOpen(false);
      showToast(t('customerPanel.mergeSuccess'), 'success');
    } catch (err) {
      console.error('[API] confirmMergeContact error:', err);
      showToast(err.response?.data?.error || t('customerPanel.mergeFailed'), 'error');
    } finally {
      setMerging(false);
    }
  }

  const q = search.trim().toLowerCase();
  const candidates = (contacts || [])
    .filter((ct) => {
      if (c && String(ct.id) === String(c.contactId)) return false; // متستخبلش تدمج الكونتاكت في نفسه
      if (!q) return true;
      const haystack = `${ct.name || ''} ${(ct.phones || []).map((p) => p.phone_number || '').join(' ')}`.toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, 25);

  if (!open) {
    return (
      <button className="add-btn" id="merge-contact-btn" onClick={show}>
        <Link2 size={16} /> {t('customerPanel.mergeButton')}
      </button>
    );
  }

  return (
    <div className="add-form show" id="merge-contact-form">
      <input
        type="text"
        id="merge-contact-search"
        placeholder={t('customerPanel.mergeSearchPlaceholder')}
        value={search}
        autoFocus
        onChange={(e) => setSearch(e.target.value)}
      />
      <div id="merge-contact-results" style={{ maxHeight: 180, overflow: 'auto', marginTop: 6 }}>
        {loading && (
          <div className="iw-empty" style={{ padding: '8px 0', textAlign: 'center', fontSize: 13 }}>
            {t('customerPanel.mergeLoading')}
          </div>
        )}
        {!loading && candidates.length === 0 && (
          <div className="iw-empty" style={{ padding: '8px 0', textAlign: 'center', fontSize: 13 }}>
            {t('customerPanel.mergeNoResults')}
          </div>
        )}
        {!loading &&
          candidates.map((ct) => (
            <div
              key={ct.id}
              onClick={() => !merging && confirmMerge(ct.id)}
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
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{ct.name || t('customerPanel.mergeNoName')}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{(ct.phones || [])[0]?.phone_number || ''}</span>
            </div>
          ))}
      </div>
      <div className="add-form-actions">
        <button className="add-cancel" onClick={hide}>
          {t('customerPanel.mergeCancel')}
        </button>
      </div>
    </div>
  );
}
