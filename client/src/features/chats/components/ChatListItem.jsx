import { useTranslation } from 'react-i18next';
import { useRef } from 'react';
import { UserRound, Crown } from 'lucide-react';
import Avatar from '../../../components/ui/Avatar';
import { hexToRgba } from '../utils/mappers';

const LONG_PRESS_MS = 500;
const TOUCH_MOVE_CANCEL_PX = 10; // لو الإصبع اتحرك أكتر من كده، يبقى ده سكرول مش دوسة مطولة

export default function ChatListItem({ c, active, onClick, onContextMenu }) {
  const { t } = useTranslation('chats');
  const touchTimerRef = useRef(null);
  const touchStartRef = useRef(null);
  const longPressFiredRef = useRef(false);

  function clearLongPressTimer() {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }

  // نفس فكرة right-click بالظبط بس على الموبايل: دوسة مطولة (نص ثانية) بتفتح
  // نفس منيو "Assign from outside" اللي بتفتح بالكليك يمين على الديسكتوب
  function handleTouchStart(e) {
    if (!onContextMenu) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    longPressFiredRef.current = false;
    clearLongPressTimer();
    touchTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      touchTimerRef.current = null;
      if (navigator.vibrate) navigator.vibrate(15); // اهتزاز خفيف بيأكد للمستخدم إن المنيو فتحت
      onContextMenu({ clientX: touch.clientX, clientY: touch.clientY, preventDefault() {} }, c);
    }, LONG_PRESS_MS);
  }

  function handleTouchMove(e) {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (dx > TOUCH_MOVE_CANCEL_PX || dy > TOUCH_MOVE_CANCEL_PX) clearLongPressTimer();
  }

  function handleTouchEnd() {
    clearLongPressTimer();
    touchStartRef.current = null;
  }

  return (
    <div
      className={`chat-item${active ? ' active' : ''}`}
      onClick={(e) => {
        // لو الدوسة المطولة فتحت المنيو خلاص، منسيبش نفس اللمسة تفتح المحادثة
        // كمان (الـ click اللي بيجي بعد touchend على الموبايل)
        if (longPressFiredRef.current) {
          longPressFiredRef.current = false;
          return;
        }
        onClick(e);
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu(e, c);
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
    >
      <div className="chat-item-avatar">
        <Avatar name={c.name} seed={c.avatar} size={48} />
        <div className={`status-dot ${c.status}`}></div>
      </div>
      <div className="chat-item-info">
        <div className="chat-item-name">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {c.name}
            {c.isVip && (
              <span
                title={t('list.vipCustomer')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  background: 'rgba(245,166,35,0.15)',
                  color: '#f5a623',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 20,
                }}
              >
                <Crown size={10} /> VIP
              </span>
            )}
          </span>
          <span>{c.time}</span>
        </div>
        <div className="chat-item-msg">
          <span>{c.lastMsg}</span>
          {c.unread > 0 && <span className="unread-badge">{c.unread}</span>}
        </div>
        <div className={`chat-item-agent${c.assignedTo ? '' : ' unassigned'}`}>
          <UserRound size={11} />
          {c.assignedTo || t('list.unassigned')}
        </div>
        {((c.labels && c.labels.length > 0) || (c.teams && c.teams.length > 0)) && (
          <div className="chat-item-labels">
            {(c.labels || []).map((l) => (
              <span
                key={`l${l.id}`}
                className="chat-item-label-chip"
                style={{ background: hexToRgba(l.color, 0.12), color: l.color || '#6C5CE7' }}
              >
                <span className="chat-item-label-dot" style={{ background: l.color || '#6C5CE7' }}></span>
                {l.name}
              </span>
            ))}
            {(c.teams || []).map((t) => (
              <span
                key={`t${t.id}`}
                className="chat-item-label-chip"
                style={{ background: hexToRgba(t.color, 0.12), color: t.color || '#6C5CE7' }}
              >
                <span className="chat-item-label-dot" style={{ background: t.color || '#6C5CE7' }}></span>
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
