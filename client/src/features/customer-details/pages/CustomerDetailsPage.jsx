import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Building2, Phone, User, CalendarClock, Layers, CalendarPlus, FilePlus2, Briefcase, Pencil, Tag, Unlink, Crown, UserX, Link2, UserCog } from 'lucide-react';
import { customerDetailsApi } from '../services/customerDetails.service';
import { contactsApi } from '../../contacts/services/contacts.service';
import { formatSchedDate, formatDurationDays } from '../../../utils/dateFormat';
import i18n from '../../../i18n';
import useChatsStore from '../../chats/store/chatsStore';
import useAuthStore from '../../../store/authStore';
import useToastStore from '../../../store/toastStore';
import AddPhoneForm from '../../chats/components/AddPhoneForm';
import VisitCard from '../components/VisitCard';
import MaintenanceContractCard from '../components/MaintenanceContractCard';
import AddVisitModal from '../components/AddVisitModal';
import AddMaintenanceContractModal from '../components/AddMaintenanceContractModal';
import UnlinkPhoneModal from '../components/UnlinkPhoneModal';
import MergeNumberModal from '../components/MergeNumberModal';
import ChooseConversationModal from '../components/ChooseConversationModal';
import CustomerCardModal from '../../contacts/components/CustomerCardModal';

const isOwnerOrAdmin = (user) => (user?.role ?? 2) <= 1;

export default function CustomerDetailsPage() {
  const { t } = useTranslation('customerDetails');
  const { contactId } = useParams();
  const navigate = useNavigate();
  const showToast = useToastStore((s) => s.showToast);
  const { conversations, selectChat } = useChatsStore();
  const { user } = useAuthStore();
  const canManage = isOwnerOrAdmin(user);

  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('visits');
  const [editOpen, setEditOpen] = useState(false);

  const [visits, setVisits] = useState([]);
  const [visitsLoading, setVisitsLoading] = useState(true);
  const [contracts, setContracts] = useState([]);
  const [contractsLoading, setContractsLoading] = useState(true);

  const [addVisitOpen, setAddVisitOpen] = useState(false);
  const [addContractOpen, setAddContractOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [chooseConvOpen, setChooseConvOpen] = useState(false);

  function loadContact() {
    setLoading(true);
    customerDetailsApi
      .getContact(contactId)
      .then(setContact)
      .catch((err) => console.error('[API] loadCustomerDetails error:', err))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadContact();
    setVisitsLoading(true);
    customerDetailsApi
      .listVisits(contactId)
      .then(setVisits)
      .catch((err) => console.error('[API] loadCustomerVisits error:', err))
      .finally(() => setVisitsLoading(false));
    setContractsLoading(true);
    customerDetailsApi
      .listMaintenanceContracts(contactId)
      .then(setContracts)
      .catch((err) => console.error('[API] loadCustomerMaintenanceContracts error:', err))
      .finally(() => setContractsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  // العميل ممكن يبقى عنده أكتر من رقم مرتبط بيه (كل رقم = محادثة منفصلة، خصوصًا
  // بعد أي عملية دمج)، وممكن كمان يبقى عند نفس الرقم أكتر من محادثة قديمة
  // (اتقفلت واتفتحت تاني). إحنا عايزين بس آخر محادثة واحدة لكل رقم — الليستة
  // جاية من الـ store مرتبة أصلاً بـ last_message_at تنازليًا، فبناخد أول ظهور
  // لكل رقم بس (ده هو الأحدث تلقائيًا) ونتجاهل أي تكرار تاني لنفس الرقم
  function getLatestConversationsForContact() {
    const seenPhones = new Set();
    const latest = [];
    for (const c of conversations) {
      if (String(c.contactId) !== String(contactId)) continue;
      if (seenPhones.has(c.phone)) continue;
      seenPhones.add(c.phone);
      latest.push(c);
    }
    return latest;
  }

  // لو عنده رقم واحد بس ليه محادثات، بنفتح محادثته على طول زي الأول، ولو
  // عنده أكتر من رقم بنعرضله يختار أنهي رقم عايز يفتح آخر محادثة ليه
  function openConversation() {
    const convs = getLatestConversationsForContact();
    if (convs.length === 0) return showToast(t('noConversationYet'), 'info');
    if (convs.length === 1) {
      navigate('/dashboard/chats');
      selectChat(convs[0].id);
      return;
    }
    setChooseConvOpen(true);
  }

  function chooseConversation(conv) {
    setChooseConvOpen(false);
    navigate('/dashboard/chats');
    selectChat(conv.id);
  }

  // نفس بالظبط لوجيك editCustomerDetailsPhoneLabel الأصلية — prompt بسيط
  // لكتابة/تعديل اسم ثانوي للرقم، بيشتغل هنا على contact مباشرة (بدل ما
  // يبقى محتاج محادثة مفتوحة أصلًا)
  async function editPhoneLabel(phoneNumber) {
    if (!contact) return;
    const p = (contact.phones || []).find((ph) => ph.phone_number === phoneNumber);
    const newLabel = window.prompt(t('phoneNumbers.promptLabel'), (p && p.label) || '');
    if (newLabel === null) return;
    try {
      await contactsApi.updatePhoneLabel(contactId, phoneNumber, newLabel.trim());
      loadContact();
      showToast(t('phoneNumbers.labelSaved'), 'success');
    } catch (err) {
      console.error('[API] editPhoneLabel error:', err);
      showToast(err.response?.data?.error || t('phoneNumbers.labelSaveFailed'), 'error');
    }
  }

  if (loading) {
    return (
      <div id="page-customer-details" className="page">
        <div className="page-content" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('loading')}</div>
      </div>
    );
  }
  if (!contact) {
    return (
      <div id="page-customer-details" className="page">
        <div className="page-content" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('loadFailed')}</div>
      </div>
    );
  }

  const currentContract = contracts.find((c) => c.status !== 'stopped');
  const remainingLabel = currentContract ? formatDurationDays(new Date().toISOString(), currentContract.end_date) : null;
  // لو مفيش فروع متعددة مسجلة، بنرجع لعمود location القديم بتاع العميل
  // كأنه هو عنوان فرع واحد، عشان العرض يفضل شغال حتى للعملاء القدام اللي
  // معندهمش صفوف في جدول الفروع
  const branchList = (contact.branches && contact.branches.length > 0)
    ? contact.branches
    : (contact.location ? [{ name: null, location: contact.location }] : []);
  // تحت اسم العميل: عناوين كل الفروع بس (من غير أسماء الفروع)
  const branchAddresses = branchList.map((b) => b.location).filter(Boolean);
  const branchAddressesDisplay = branchAddresses.join(i18n.t('listSeparator', { ns: 'common' }));

  return (

    <div id="page-customer-details" className="page">
      <div className="page-content">
        <div className="page-header">
          <div className="customer-header-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="mobile-back-btn contacts-back-btn" title={t('back')} aria-label={t('back')} onClick={() => navigate('/dashboard/contacts')}>
              <ArrowLeft size={18} />
            </button>
            <div>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                {contact.name || t('noName')}
                {contact.is_vip === 1 && (
                  <span className="label-chip" style={{ background: 'rgba(245,166,35,0.15)', color: '#f5a623', fontSize: 11.5 }}>
                    <Crown size={12} style={{ verticalAlign: -2 }} /> VIP
                  </span>
                )}
                {contact.is_inactive === 1 && (
                  <span className="label-chip" style={{ background: 'rgba(148,163,184,0.18)', color: 'var(--text-secondary)', fontSize: 11.5 }}>
                    <UserX size={12} style={{ verticalAlign: -2 }} /> {t('inactive')}
                  </span>
                )}
              </h2>
              {branchAddresses.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{branchAddressesDisplay}</div>}
            </div>
          </div>
          <div className="customer-header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canManage && (
              <button className="page-btn" style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }} onClick={() => setEditOpen(true)}>
                <Pencil size={15} /> {t('edit')}
              </button>
            )}
            {canManage && (
              <button className="page-btn" style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }} onClick={() => setMergeOpen(true)}>
                <Link2 size={15} /> {t('mergeNumber')}
              </button>
            )}
            <button className="page-btn" onClick={openConversation}>{t('openConversation')}</button>
          </div>
        </div>

        <div className="settings-section">
          <h3>{t('customerInfo.title')}</h3>
          <div className="setting-row">
            <div><div className="setting-label"><Briefcase size={13} style={{ verticalAlign: -2 }} /> {t('customerInfo.manager')}</div></div>
            <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
              {contact.manager_name || '-'}{contact.manager_phone ? ` · ${contact.manager_phone}` : ''}
            </span>
          </div>
          {contact.responsible_person && (
            <div className="setting-row">
              <div><div className="setting-label"><UserCog size={13} style={{ verticalAlign: -2 }} /> {t('customerInfo.responsiblePerson')}</div></div>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{contact.responsible_person}</span>
            </div>
          )}
          <div className="setting-row">
            <div><div className="setting-label"><CalendarClock size={13} style={{ verticalAlign: -2 }} /> {t('customerInfo.contractDate')}</div></div>
            <div style={{ textAlign: 'left' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{formatSchedDate(contact.contract_date)}</span>
              {contact.created_by && (
                <div style={{ opacity: 0.65, fontSize: 12, marginTop: 2 }}>
                  {t('customerInfo.addedBy')}: {contact.created_by_name || t('customerInfo.agentId', { id: contact.created_by })}
                </div>
              )}
            </div>
          </div>
          {currentContract && (
            <div className="setting-row">
              <div><div className="setting-label"><CalendarClock size={13} style={{ verticalAlign: -2 }} /> {t('customerInfo.currentMaintenanceContract')}</div></div>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                {formatSchedDate(currentContract.start_date)} → {formatSchedDate(currentContract.end_date)} ({remainingLabel})
              </span>
            </div>
          )}
          <div className="setting-row" style={{ alignItems: branchList.length > 1 ? 'flex-start' : 'center' }}>
            <div><div className="setting-label"><Building2 size={13} style={{ verticalAlign: -2 }} /> {t('customerInfo.branches')}</div></div>
            {branchList.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                {branchList.map((b, idx) => (
                  <span key={idx} style={{ fontSize: 13.5, color: 'var(--text-secondary)', textAlign: 'left' }}>
                    {b.name || '-'} — {b.location || '-'}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>-</span>
            )}
          </div>
          {contact.modules && contact.modules.length > 0 && (
            <div style={{ padding: '12px 0 4px' }}>
              <div className="setting-label" style={{ marginBottom: 8 }}><Layers size={13} style={{ verticalAlign: -2 }} /> {t('customerInfo.subscribedModules')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {contact.modules.map((m) => (
                  <span key={m.name || m} className="label-chip" style={{ background: 'rgba(108,92,231,0.1)', color: 'var(--primary)' }}>
                    {m.name || m}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="settings-section">
          <h3>{t('phoneNumbers.title')}</h3>
          <div className="info-list" style={{ marginBottom: 10 }}>
            {(contact.phones || []).map((p) => (
              <div key={p.phone_number} className="info-item">
                <div className="info-item-text">
                  <Phone size={14} />
                  <span>{p.phone_number}</span>
                  {p.label && <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>({p.label})</span>}
                </div>
                <div className="info-item-actions">
                  {canManage && (
                    <button
                      className="resolve-cancel-btn"
                      style={{ padding: '4px 9px', fontSize: 11.5 }}
                      title={t('phoneNumbers.editLabel')}
                      onClick={() => editPhoneLabel(p.phone_number)}
                    >
                      <Tag size={12} /> {t('phoneNumbers.secondaryName')}
                    </button>
                  )}
                  {canManage && (contact.phones || []).length > 1 && (
                    <button
                      className="resolve-cancel-btn"
                      style={{ padding: '4px 9px', fontSize: 11.5 }}
                      onClick={() => setUnlinkTarget(p.phone_number)}
                    >
                      <Unlink size={12} /> {t('phoneNumbers.unlink')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <AddPhoneForm contactId={contactId} onAdded={() => loadContact()} />
        </div>

        <div className="sched-page-tabs">
          <button className={`sched-page-tab${tab === 'visits' ? ' active' : ''}`} onClick={() => setTab('visits')}>
            <User size={14} /> {t('tabs.visits')} <span className="sched-subhead-count">({visits.length})</span>
          </button>
          <button className={`sched-page-tab${tab === 'contracts' ? ' active' : ''}`} onClick={() => setTab('contracts')}>
            <FilePlus2 size={14} /> {t('tabs.maintenanceHistory')} <span className="sched-subhead-count">({contracts.length})</span>
          </button>
        </div>

        {tab === 'visits' && (
          <div>
            <button className="page-btn" style={{ marginBottom: 12 }} onClick={() => setAddVisitOpen(true)}>
              <CalendarPlus size={16} /> {t('visits.add')}
            </button>
            <div className="sched-tasks-grid">
              {visitsLoading ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('visits.loading')}</div>
              ) : visits.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('visits.empty')}</div>
              ) : (
                visits.map((v) => <VisitCard key={v.id} v={v} />)
              )}
            </div>
          </div>
        )}

        {tab === 'contracts' && (
          <div>
            {canManage && (
              <button className="page-btn" style={{ marginBottom: 12 }} onClick={() => setAddContractOpen(true)}>
                <FilePlus2 size={16} /> {t('contracts.add')}
              </button>
            )}
            <div className="sched-tasks-grid">
              {contractsLoading ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('contracts.loading')}</div>
              ) : contracts.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('contracts.empty')}</div>
              ) : (
                contracts.map((c) => (
                  <MaintenanceContractCard
                    key={c.id}
                    contract={c}
                    contactId={contactId}
                    onPatch={(patch) => setContracts((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))}
                    onRemove={() => setContracts((prev) => prev.filter((x) => x.id !== c.id))}
                    onRestore={(snapshot) => setContracts((prev) => (prev.some((x) => x.id === snapshot.id) ? prev : [...prev, snapshot]))}
                    onReload={() => {
                      customerDetailsApi.listMaintenanceContracts(contactId).then(setContracts);
                      loadContact();
                    }}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {addVisitOpen && (
        <AddVisitModal
          contactId={contactId}
          contactName={contact.name}
          onClose={() => setAddVisitOpen(false)}
          onAdded={(result) => {
            if (result?.optimistic) {
              setAddVisitOpen(false);
              setVisits((prev) => [result.tempVisit, ...prev]);
              return;
            }
            if (result?.rollback) {
              setVisits((prev) => prev.filter((v) => v.id !== result.tempId));
              showToast(result.error || t('visits.addFailed'), 'error');
              return;
            }
            showToast(t('visits.addedSuccess'), 'success');
            customerDetailsApi.listVisits(contactId).then(setVisits);
          }}
        />
      )}
      {addContractOpen && (
        <AddMaintenanceContractModal
          contactId={contactId}
          contactName={contact.name}
          onClose={() => setAddContractOpen(false)}
          onAdded={(result) => {
            if (result?.optimistic) {
              setAddContractOpen(false);
              setContracts((prev) => [result.tempContract, ...prev]);
              return;
            }
            if (result?.rollback) {
              setContracts((prev) => prev.filter((c) => c.id !== result.tempId));
              showToast(result.error || t('contracts.addFailed'), 'error');
              return;
            }
            showToast(t('contracts.addedSuccess'), 'success');
            customerDetailsApi.listMaintenanceContracts(contactId).then(setContracts);
            loadContact();
          }}
        />
      )}
      {editOpen && (
        <CustomerCardModal
          mode="edit"
          contact={contact}
          onClose={() => setEditOpen(false)}
          onSaved={(result) => {
            if (result?.optimistic) {
              // Optimistic: التعديلات بتظهر فورًا على الصفحة، والمودال بيتقفل على طول
              setContact((prev) => (prev ? { ...prev, ...result.patch } : prev));
              setEditOpen(false);
              return;
            }
            if (result?.rollback) {
              // فشل التحديث بالسيرفر — بنرجع نجيب البيانات الحقيقية بدل ما نخمّن حالة الرجوع يدويًا
              showToast(result.error || t('customerUpdateFailed'), 'error');
              loadContact();
              return;
            }
            showToast(t('customerUpdatedSuccess'), 'success');
            loadContact();
          }}
        />
      )}
      {unlinkTarget && (
        <UnlinkPhoneModal
          contactId={contactId}
          phone={unlinkTarget}
          defaultName={contact.name}
          onClose={() => setUnlinkTarget(null)}
          onUnlinked={() => {
            setUnlinkTarget(null);
            showToast(t('phoneUnlinkedSuccess'), 'success');
            loadContact();
          }}
        />
      )}
      {mergeOpen && (
        <MergeNumberModal
          contactId={contactId}
          onClose={() => setMergeOpen(false)}
          onMerged={(targetContactId) => {
            setMergeOpen(false);
            showToast(t('mergedRedirecting'), 'success');
            // لازم نحدّث قايمة المحادثات عشان كل الأرقام اللي اندمجت تبقى تابعة
            // للعميل الجديد فورًا، وبعدين نتنقل لكارته هو (الكارت الحالي
            // اتمسح لأنه بقى من غير أرقام بعد الدمج)
            useChatsStore.getState().loadConversations();
            navigate(`/dashboard/contacts/${targetContactId}`, { replace: true });
          }}
        />
      )}
      {chooseConvOpen && (
        <ChooseConversationModal
          conversations={getLatestConversationsForContact().map((c) => ({
            id: c.id,
            phone: c.phone,
            phoneLabel: (contact.phones || []).find((p) => p.phone_number === c.phone)?.label || null,
          }))}
          onChoose={chooseConversation}
          onClose={() => setChooseConvOpen(false)}
        />
      )}
    </div>
  );
}
