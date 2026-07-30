import { formatTime, formatMessageTimestamp, formatDateTimeLabel, daysAgoLabel } from '../../../utils/dateFormat';
import i18n from '../../../i18n';

export function parseLabelsJson(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapApiConversation(row) {
  return {
    id: row.id,
    contactId: row.contact_id || null,
    name: row.contact_resolved_name || row.contact_name || row.contact_number,
    avatar: 'wa-' + row.contact_number,
    phone: row.contact_number,
    status: row.status === 'closed' ? 'resolved' : 'open',
    rawStatus: row.status,
    assignedTo: row.assigned_agent_name || null,
    lastMsg: row.last_message_text || (row.last_message_type && row.last_message_type !== 'text' ? mediaKindLabel(row.last_message_type) : ''),
    time: row.created_at ? formatTime(row.created_at) : '',
    unread: 0,
    messages: [],
    phones: [{ number: row.contact_number, label: null }],
    devices: [],
    prevConvs: [],
    labels: parseLabelsJson(row.labels_json),
    _labelsLoaded: true,
    teams: parseLabelsJson(row.teams_json),
    _teamsLoaded: true,
    // فروع العميل (كل فرع اسمه ومكانه) — لو الكونتاكت معندوش فروع متعددة مسجلة
    // بيرجع مصفوفة فاضية، والفرونت إند وقتها بيرجع لعمود location القديم بتاع
    // الكونتاكت (contact_location) كـ fallback واحد بس يتعرض مكان الفروع
    branches: parseLabelsJson(row.branches_json),
    location: row.contact_location || null,
    // العميل ده VIP؟ — بتتعرض علامة تاجية جمب اسمه في كارت المحادثة بره الشات
    isVip: row.contact_is_vip === 1,
    _messagesLoaded: false,
    _contactLoaded: false,
    _lastMessageAtRaw: row.last_message_at || null,
    _lastMessageDirection: row.last_message_direction || null,
    // تاريخ انتهاء عقد الصيانة بتاع العميل ده (لو مسجل كـ "كارت عميل صيانة") —
    // بيستخدم عشان نعرض شريط تحذير أحمر فوق الشات لو العقد منتهي (شوف
    // MaintenanceBanner.jsx) — السيرفر بيبعتها دايمًا، كانت بس مش متربطة هنا
    maintenanceEndDate: row.contact_maintenance_end_date || null,
  };
}

export function mapApiMessage(m) {
  if (m.direction === 'note') {
    return {
      id: m.id,
      from: 'note',
      text: m.message_text || '',
      time: formatMessageTimestamp(m.created_at),
      rawTime: m.created_at,
      senderName: m.sent_by_name || null,
      isNote: true,
    };
  }
  if (m.direction === 'system') {
    return {
      id: m.id,
      from: 'system',
      text: m.message_text || '',
      time: formatMessageTimestamp(m.created_at),
      rawTime: m.created_at,
    };
  }
  return {
    id: m.id,
    from: m.direction === 'out' ? 'agent' : 'customer',
    text: m.message_text || '',
    time: formatMessageTimestamp(m.created_at),
    rawTime: m.created_at,
    senderName: m.sent_by_name || null,
    phone: m.from_number || null,
    type: m.message_type && m.message_type !== 'text' ? m.message_type : null,
    mediaUrl: m.media_url || null,
    mediaMime: m.media_mime || null,
    fileName: m.media_filename || null,
    status: m.status || null,
    failed: m.status === 'failed',
  };
}

export function mediaKindLabel(type) {
  if (type === 'image' || type === 'sticker') return i18n.t('mediaKind.photo', { ns: 'chats' });
  if (type === 'video') return i18n.t('mediaKind.video', { ns: 'chats' });
  if (type === 'audio') return i18n.t('mediaKind.voice', { ns: 'chats' });
  return i18n.t('mediaKind.document', { ns: 'chats' });
}

export function docKindLabel(mimeType, fileName) {
  const name = (fileName || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'PDF';
  if (mime.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) return 'Word';
  if (mime.includes('sheet') || mime.includes('excel') || name.endsWith('.xls') || name.endsWith('.xlsx')) return 'Excel';
  if (mime.includes('zip') || name.endsWith('.zip')) return 'ZIP';
  return i18n.t('docKind.file', { ns: 'chats' });
}

export function hexToRgba(hex, alpha) {
  const h = (hex || '#6C5CE7').replace('#', '');
  const bigint = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((x) => x + x)
          .join('')
      : h,
    16
  );
  const r = (bigint >> 16) & 255,
    g = (bigint >> 8) & 255,
    b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function dayKeyFor(isoString) {
  if (!isoString) return 'unknown';
  return new Date(isoString).toDateString();
}

export function dayDividerLabel(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return i18n.t('dayDivider.today', { ns: 'chats' });
  if (diffDays === 1) return i18n.t('dayDivider.yesterday', { ns: 'chats' });
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function findPhoneLabel(c, number) {
  if (!c || !number) return null;
  const match = (c.phones || []).find((p) => p.number === number);
  return match ? match.label : null;
}

// كل المحادثات السابقة لنفس الكونتاكت (حتى لو من رقم مختلف)، بتتعرض في تبويب
// "Previous Conversations" جوه لوحة العميل — نفس منطق loadContactDetails الأصلي
export function mapPrevConversation(row) {
  return {
    id: row.id,
    date: row.last_message_at ? formatDateTimeLabel(row.last_message_at) : '',
    daysAgo: row.last_message_at ? daysAgoLabel(row.last_message_at) : '',
    preview: row.last_message_text || i18n.t('mapper.noMessages', { ns: 'chats' }),
    count: row.message_count || 0,
    phone: row.contact_number || '',
    handledBy: row.assigned_agent_name || null,
  };
}
