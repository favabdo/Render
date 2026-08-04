import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Pencil, CalendarPlus, Phone, Tag } from 'lucide-react';
import Avatar from '../../../components/ui/Avatar';
import AssignSection from './AssignSection';
import LabelsSection from './LabelsSection';
import TeamsSection from './TeamsSection';
import useChatsStore from '../store/chatsStore';
import useScheduledTasksStore from '../../scheduled-tasks/store/scheduledTasksStore';
import AddTaskModal from '../../scheduled-tasks/components/AddTaskModal';
import DevicesSection from './DevicesSection';
import AddPhoneForm from './AddPhoneForm';
import MergeContactSection from './MergeContactSection';
import PrevConversationCard from './PrevConversationCard';
import useToastStore from '../../../store/toastStore';
import useAuthStore from '../../../store/authStore';
import { contactsApi } from '../../contacts/services/contacts.service';
import i18n from '../../../i18n';

export default function CustomerPanel({ conversation, currentAgentName, onClose }) {
  const { t } = useTranslation('chats');
  const [tab, setTab] = useState('card');
  const { conversations, agents, allLabels, teams, patchConversation, refreshLabels, selectChat } = useChatsStore();
  const { modalOpen, modalMode, openModal, closeModal } = useScheduledTasksStore();
  const showToast = useToastStore((s) => s.showToast);
  const { user } = useAuthStore();
  const isOwnerOrAdmin = (user?.role ?? 2) <= 1;

  const c = conversation;

  // المكان المعروض تحت اسم العميل: لو عنده فروع متعددة مسجلة بنجمع أسماءها،
  // ولو معندوش فروع (كونتاكت قديم مثلاً) بنستخدم عمود location بتاعه كأنه
  // هو الفرع نفسه، وآخر حل (لو مفيش حتى location) بنرجع للرقم عشان المكان
  // ده متفضلش فاضية خالص
  const branchNames = (c.branches || []).map((b) => b.name || b.location).filter(Boolean);
  const branchDisplay = branchNames.length > 0 ? branchNames.join(i18n.t('listSeparator', { ns: 'common' })) : c.location || c.phone;

  // نفس فكرة editPhoneLabel الأصلية بالظبط: prompt بسيط لكتابة/تعديل اسم ثانوي للرقم
  // — بس دلوقتي optimistic: التعديل بيظهر فورًا في اللستة قبل ما السيرفر يرد،
  // ولو فشل بنرجّع القايمة القديمة تاني
  async function editPhoneLabel(idx) {
    if (!c.contactId) return showToast(t('customerPanel.linkPhoneFirst'), 'error');
    const p = c.phones[idx];
    if (!p) return;
    const newLabel = window.prompt(t('customerPanel.promptSecondaryLabel'), p.label || '');
    if (newLabel === null) return;

    const previousPhones = c.phones;
    const trimmedLabel = newLabel.trim();
    patchConversation(c.id, {
      phones: previousPhones.map((ph, i) => (i === idx ? { ...ph, label: trimmedLabel || null } : ph)),
    });

    try {
      const data = await contactsApi.updatePhoneLabel(c.contactId, p.number, trimmedLabel);
      patchConversation(c.id, { phones: data.contact.phones.map((ph) => ({ number: ph.phone_number, label: ph.label || null })) });
      showToast(t('customerPanel.labelSavedSuccess'), 'success');
    } catch (err) {
      console.error('[API] editPhoneLabel error:', err);
      patchConversation(c.id, { phones: previousPhones });
      showToast(err.response?.data?.error || t('customerPanel.labelSaveFailed'), 'error');
    }
  }

  return (
    <div id="customer-panel">
      <div className="cp-header">
        <h3>{t('customerPanel.title')}</h3>
        <button className="cp-close-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="cp-profile">
        <div className="cp-avatar">
          <Avatar name={c.name} seed={c.avatar} size={72} />
        </div>
        <div className="cp-name-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div className="cp-name">{c.name}</div>
          <button className="st-icon-btn" title={t('customerPanel.editName')} aria-label={t('customerPanel.editName')} style={{ width: 22, height: 22 }}>
            <Pencil size={12} />
          </button>
        </div>
        <div className="cp-phone">{branchDisplay}</div>
      </div>

      <div className="cp-tabs">
        <button className={`cp-tab${tab === 'card' ? ' active' : ''}`} onClick={() => setTab('card')}>
          {t('customerPanel.cardTab')}
        </button>
        <button className={`cp-tab${tab === 'info' ? ' active' : ''}`} onClick={() => setTab('info')}>
          {t('customerPanel.infoTab')}
        </button>
      </div>

      {tab === 'card' && (
        <div className="cp-tab-content active">
          <AssignSection
            conversation={c}
            agents={agents}
            currentAgentName={currentAgentName}
            onAssigned={(patch) => patchConversation(c.id, patch)}
          />

          <div className="cp-section" id="cp-section-sched">
            <div className="cp-section-header">
              <div className="cp-section-title">{t('customerPanel.scheduledTasksTitle')}</div>
            </div>
            <div className="cp-section-body">
              <button
                className="add-btn"
                id="sched-add-btn"
                disabled={!c.contactId}
                title={c.contactId ? '' : t('customerPanel.linkCustomerFirst')}
                onClick={() => c.contactId && openModal('card')}
              >
                <CalendarPlus size={16} /> {t('customerPanel.addingScheduledTask')}
              </button>
            </div>
          </div>

          <LabelsSection
            conversation={c}
            allLabels={allLabels}
            onLabelsChange={(labels) => patchConversation(c.id, { labels })}
            onRefreshAllLabels={refreshLabels}
          />

          <TeamsSection conversation={c} teams={teams} onTeamsChange={(teams) => patchConversation(c.id, { teams })} />

          <div className="cp-section" id="cp-section-prevconv">
            <div className="cp-section-header">
              <div className="cp-section-title">{t('customerPanel.previousConversationsTitle')}</div>
            </div>
            <div className="cp-section-body">
              <div className="prev-conv-list">
                {!c.prevConvs || c.prevConvs.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: 12 }}>{t('customerPanel.noPreviousConversations')}</div>
                ) : (
                  c.prevConvs.map((p) => (
                    <PrevConversationCard
                      key={p.id}
                      p={p}
                      onClick={() => {
                        const target = conversations.find((x) => x.id === p.id);
                        if (!target) return showToast(t('customerPanel.conversationNotFound'), 'error');
                        selectChat(target.id);
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'info' && (
        <div className="cp-tab-content active">
          <div className="cp-section">
            <div className="cp-section-title">{t('customerPanel.phoneNumbersTitle')}</div>
            <div className="info-list" id="phone-list">
              {(c.phones || []).map((p, i) => (
                <div key={p.number} className={`info-item${p._pending ? ' opt-pending' : ''}`}>
                  <div className="info-item-text">
                    <Phone size={16} />
                    <span>{p.number}</span>
                    {p.label && (
                      <span className="label-chip" style={{ background: 'rgba(var(--primary-rgb),0.1)', color: 'var(--primary)', padding: '2px 9px', fontSize: 11 }}>
                        {p.label}
                      </span>
                    )}
                  </div>
                  {isOwnerOrAdmin && !p._pending && (
                    <button className="info-item-del" title={t('customerPanel.editSecondaryLabel')} aria-label={t('customerPanel.editSecondaryLabel')} onClick={() => editPhoneLabel(i)}>
                      <Tag size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <AddPhoneForm contactId={c.contactId} phones={c.phones} onAdded={(phones) => patchConversation(c.id, { phones })} />
            {isOwnerOrAdmin && <MergeContactSection conversation={c} />}
          </div>
          <div className="cp-section">
            <div className="cp-section-title">{t('customerPanel.devicesTitle')}</div>
            <DevicesSection contactId={c.contactId} />
          </div>
        </div>
      )}
      {modalOpen && modalMode === 'card' && <AddTaskModal mode="card" conversation={c} onClose={closeModal} />}
    </div>
  );
}
