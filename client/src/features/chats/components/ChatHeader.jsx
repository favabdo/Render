import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Search, CheckCircle, RotateCcw, User, X, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import Avatar from '../../../components/ui/Avatar';

// نفس المنطق المستخدم في MessageInput.jsx لتحديد لو إحنا في لاي أوت الموبايل
function isMobileLayout() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width:860px)').matches;
}

// أول كلمتين بس من رسالة تحذير عقد الصيانة — مستخدمة في الشكل المنكمش على
// الموبايل (شوف maintenanceBannerText تحت) عشان مساحة الشات ميبقاش صغير أوي
function firstTwoWords(text) {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  return words.length <= 2 ? text : `${words.slice(0, 2).join(' ')}…`;
}

export default function ChatHeader({
  conversation,
  typingNames,
  onBack,
  onToggleSearch,
  searchOpen,
  searchQuery,
  onSearchChange,
  matchCount,
  matchIndex,
  onNextMatch,
  onPrevMatch,
  onResolveClick,
  onCustomerPanelToggle,
}) {
  const { t } = useTranslation('chats');
  const c = conversation;

  // على الموبايل، رسالة تحذير عقد الصيانة بتيجي منكمشة (أول كلمتين بس) عشان
  // مساحة الشات ميبقاش صغير أوي — وبتتفتح كاملة لو داس على السهم. على الديسكتوب
  // بتفضل ظاهرة كاملة زي الأول عادي. بنرجّع الحالة لمنكمشة تاني كل ما نفتح
  // محادثة تانية (بدل ما تفضل متفتحة من محادثة سابقة)
  const [bannerExpanded, setBannerExpanded] = useState(() => !isMobileLayout());
  useEffect(() => {
    setBannerExpanded(!isMobileLayout());
  }, [c.id]);
  const statusText =
    typingNames.length > 0
      ? typingNames.length === 1
        ? t('header.typingOne', { name: typingNames[0] })
        : t('header.typingMany', { names: typingNames.join(', ') })
      : c.status === 'open'
        ? t('header.online')
        : c.status === 'pending'
          ? t('header.pending')
          : t('header.resolved');
  const statusColor =
    typingNames.length > 0
      ? 'var(--primary)'
      : c.status === 'open'
        ? 'var(--success)'
        : c.status === 'pending'
          ? 'var(--warning)'
          : 'var(--text-secondary)';

  const activeLabel = c.labels && c.labels.length > 0 ? c.labels[0] : null;

  // لو العميل ده كارت "عميل صيانة" (له maintenanceEndDate) وعقد الصيانة بتاعه
  // عدى معاده، بنوري شريط تحذير أحمر فوق الشات عشان الإيجنت ياخد باله ومايكملش
  // معاه عادي من غير ما يعرف إن العقد منتهي (نفس منطق applyMaintenanceBanner
  // في النسخة القديمة قبل React، اللي وقع سهوًا وقت النقل)
  let maintenanceBannerText = null;
  if (c.maintenanceEndDate) {
    const endDate = new Date(c.maintenanceEndDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today - endDate) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      const endDateStr = endDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      maintenanceBannerText = t('header.maintenanceExpired', { days: diffDays, date: endDateStr });
    }
  }

  return (
    <>
      <div className="chat-header">
        <div className="chat-header-left">
          <button className="mobile-back-btn" title={t('header.backToAll')} aria-label={t('header.backToAll')} onClick={onBack}>
            <ArrowLeft size={18} />
          </button>
          <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
            <Avatar name={c.name} seed={c.avatar} size={40} />
          </div>
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <div className="chat-header-name">{c.name}</div>
            <div className="chat-header-status" style={{ color: statusColor }}>
              {statusText}
            </div>
          </div>
        </div>
        <div className="chat-header-actions">
          <button className="ch-action-btn" title={t('header.searchInChat')} aria-label={t('header.searchInChat')} onClick={onToggleSearch}>
            <Search size={18} />
          </button>
          <button
            className={`resolve-btn${c.status === 'resolved' ? ' resolved-state' : ''}`}
            title={c.status === 'resolved' ? t('header.reopenConversation') : t('header.resolveConversation')}
            onClick={onResolveClick}
          >
            {c.status === 'resolved' ? <RotateCcw size={15} /> : <CheckCircle size={15} />}
            <span>{c.status === 'resolved' ? t('header.reopen') : t('header.resolve')}</span>
          </button>
          <button className="ch-action-btn" title={t('header.customerInfo')} aria-label={t('header.customerInfo')} onClick={onCustomerPanelToggle}>
            <User size={18} />
          </button>
        </div>
      </div>

      {activeLabel && activeLabel.description && (
        <div className="chat-header-labels show" style={{ borderRightColor: activeLabel.color || '#6C5CE7' }}>
          <span className="chlbl-dot" style={{ background: activeLabel.color || '#6C5CE7' }}></span>
          <span className="chlbl-name">{activeLabel.name}:</span>
          <span className="chlbl-desc">{activeLabel.description}</span>
        </div>
      )}

      {maintenanceBannerText && (
        <div className="chat-maintenance-banner show">
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span className="chat-maintenance-banner-text">
            {bannerExpanded ? maintenanceBannerText : firstTwoWords(maintenanceBannerText)}
          </span>
          <button
            type="button"
            className="chat-maintenance-banner-toggle"
            onClick={() => setBannerExpanded((v) => !v)}
            title={bannerExpanded ? t('header.maintenanceCollapse') : t('header.maintenanceExpand')}
            aria-label={bannerExpanded ? t('header.maintenanceCollapse') : t('header.maintenanceExpand')}
          >
            {bannerExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      )}

      <div className={`chat-search-bar${searchOpen ? ' show' : ''}`}>
        <Search size={15} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
        <input
          id="chat-search-input"
          type="text"
          placeholder={t('header.searchMessagesPlaceholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) onPrevMatch();
              else onNextMatch();
            } else if (e.key === 'Escape') {
              onToggleSearch();
            }
          }}
        />
        <span className="chat-search-counter">{matchCount ? `${matchIndex + 1}/${matchCount}` : searchQuery ? '0/0' : ''}</span>
        <button className="ch-action-btn" title={t('header.prev')} aria-label={t('header.prev')} onClick={onPrevMatch}>
          <ChevronUp size={16} />
        </button>
        <button className="ch-action-btn" title={t('header.next')} aria-label={t('header.next')} onClick={onNextMatch}>
          <ChevronDown size={16} />
        </button>
        <button className="ch-action-btn" title={t('header.close')} aria-label={t('header.close')} onClick={onToggleSearch}>
          <X size={16} />
        </button>
      </div>
    </>
  );
}
