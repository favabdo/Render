import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, CalendarCheck } from 'lucide-react';
import { contactsApi } from '../../contacts/services/contacts.service';
import Avatar from '../../../components/ui/Avatar';
import useAuthStore from '../../../store/authStore';
import useToastStore from '../../../store/toastStore';
import useScheduledTasksStore from '../store/scheduledTasksStore';
import Modal from '../../../components/ui/Modal';

const todayLabel = () => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export default function AddTaskModal({ mode, conversation, onClose }) {
  const { t } = useTranslation('scheduledTasks');
  const { user } = useAuthStore();
  const showToast = useToastStore((s) => s.showToast);
  const addTask = useScheduledTasksStore((s) => s.addTask);

  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(mode === 'page');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState('');
  const [selectedContactName, setSelectedContactName] = useState('');

  const [taskText, setTaskText] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'page') return;
    contactsApi
      .list()
      .then((data) => setContacts(data))
      .catch((err) => console.error('[API] openScheduledTaskModalFromPage error:', err))
      .finally(() => setContactsLoading(false));
  }, [mode]);

  const filteredContacts = customerSearch
    ? contacts.filter((c) => (c.name || '').toLowerCase().includes(customerSearch.toLowerCase()))
    : contacts;

  function unnamedCustomer(id) {
    return t('addModal.unnamedCustomer', { id });
  }

  function selectContact(c) {
    setSelectedContactId(c.id);
    setSelectedContactName(c.name || unnamedCustomer(c.id));
    setCustomerSearch(c.name || unnamedCustomer(c.id));
    setPickerOpen(false);
  }

  function submit() {
    let contactId, customerName;
    if (mode === 'page') {
      contactId = selectedContactId;
      customerName = selectedContactName;
      if (!contactId) return showToast(t('addModal.selectCustomerFirst'), 'error');
    } else {
      if (!conversation?.contactId) return;
      contactId = conversation.contactId;
      customerName = conversation.name;
    }

    const text = taskText.trim();
    if (!text) return showToast(t('addModal.taskTextRequired'), 'error');
    if (!dueDate) return showToast(t('addModal.dueDateRequired'), 'error');
    if (saving) return;

    setSaving(true);
    // Optimistic: التاسك بتظهر فورًا في اللستة (شوف addTask في الـ store)،
    // فبنقفل المودال على طول من غير ما نستنى رد السيرفر
    onClose();
    addTask(contactId, text, dueDate, customerName)
      .then(() => showToast(t('addModal.addSuccess'), 'success'))
      .catch((err) => {
        console.error('[API] submitScheduledTask error:', err);
        showToast(err.response?.data?.error || t('addModal.addFailed'), 'error');
      });
  }

  return (
    <Modal onClose={onClose}>
      <div className="resolve-modal-header">
        <div className="resolve-modal-icon" style={{ background: 'rgba(108,92,231,0.12)', color: 'var(--primary)' }}>
          <CalendarPlus size={22} />
        </div>
        <div className="resolve-modal-title">{t('addModal.title')}</div>
      </div>
      <div className="resolve-modal-sub">{t('addModal.subtitle')}</div>

      <div className="st-modal-readonly-row">
        <div className="st-modal-readonly">
          <div className="st-modal-readonly-label">{t('addModal.customer')}</div>
          {mode === 'card' ? (
            <div className="st-modal-readonly-value">{conversation?.name || '-'}</div>
          ) : (
            <div className="agent-select-wrap" style={{ marginTop: 4 }}>
              <input
                type="text"
                className="iw-input"
                placeholder={contactsLoading ? t('addModal.loadingCustomers') : t('addModal.typeCustomerName')}
                autoComplete="off"
                style={{ padding: '6px 8px', fontSize: 12.5 }}
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setSelectedContactId('');
                  setPickerOpen(true);
                }}
                onFocus={() => setPickerOpen(true)}
              />
              <div className={`agent-dropdown${pickerOpen ? ' open' : ''}`}>
                <div className="agent-dropdown-list">
                  {filteredContacts.length === 0 ? (
                    <div className="agent-dropdown-empty">{contacts.length ? t('addModal.noMatchingCustomers') : t('addModal.loading')}</div>
                  ) : (
                    filteredContacts.map((c) => (
                      <div key={c.id} className="agent-option" onClick={() => selectContact(c)}>
                        <div className="agent-option-avatar">
                          <Avatar name={c.name || unnamedCustomer(c.id)} seed={`contact-${c.id}`} size={32} />
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name || unnamedCustomer(c.id)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="st-modal-readonly">
          <div className="st-modal-readonly-label">{t('addModal.agent')}</div>
          <div className="st-modal-readonly-value">{user?.display_name || user?.email || '-'}</div>
        </div>
        <div className="st-modal-readonly">
          <div className="st-modal-readonly-label">{t('addModal.addedOn')}</div>
          <div className="st-modal-readonly-value">{todayLabel()}</div>
        </div>
      </div>

      <div className="resolve-cats-label">{t('addModal.requestedTask')}</div>
      <textarea
        className="resolve-notes"
        placeholder={t('addModal.requestedTaskPlaceholder')}
        style={{ height: 80, marginBottom: 14 }}
        value={taskText}
        onChange={(e) => setTaskText(e.target.value)}
      />

      <div className="resolve-cats-label">{t('addModal.agreedDueDate')}</div>
      <input
        type="date"
        className="iw-input"
        style={{ marginBottom: 6 }}
        min={new Date().toISOString().slice(0, 10)}
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
      />

      <div className="resolve-modal-actions">
        <button className="resolve-cancel-btn" onClick={onClose}>
          {t('addModal.cancel')}
        </button>
        <button className="resolve-confirm-btn" disabled={saving} onClick={submit}>
          <CalendarCheck size={16} />
          {saving ? t('addModal.saving') : t('addModal.save')}
        </button>
      </div>
    </Modal>
  );
}
