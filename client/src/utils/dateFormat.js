// نفس الدوال بالظبط من dashboard.html (formatTime / formatDateTimeLabel / formatMessageTimestamp / daysAgoLabel)

export function formatTime(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

// لو المحادثة النهارده بيرجع الوقت بس، لو مش النهارده بيرجع التاريخ والوقت مع بعض
export function formatDateTimeLabel(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return timeStr;
  const dateStr = d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
  return `${dateStr} • ${timeStr}`;
}

// التاريخ + الوقت مع بعض دايمًا (من غير اختصار Today/Yesterday)
export function formatMessageTimestamp(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateStr = d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
  return `${dateStr} • ${timeStr}`;
}

export function daysAgoLabel(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

// نفس formatSchedDate() الأصلية — مستخدمة في Scheduled Tasks و Customer Details (زيارات وعقود صيانة)
import i18n from '../i18n';

export function formatSchedDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// فرق الأيام بين تاريخين، بصيغة "X يوم (~Y شهر)" — مستخدمة في إحصائيات عقد الصيانة
export function formatDurationDays(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  const days = Math.round((to - from) / (1000 * 60 * 60 * 24));
  if (isNaN(days)) return '-';
  const months = Math.round(days / 30.44);
  return i18n.t('durationPicker.daysMonthsLabel', { ns: 'common', days, months });
}

// بتضيف شهور على تاريخ (بتاخد بالها من عدد أيام الشهر، زي 31 يناير + شهر = 28/29 فبراير)
export function addMonthsToDateStr(startStr, monthsToAdd) {
  const [y, m, d] = startStr.split('-').map(Number);
  const base = new Date(y, m - 1, 1);
  base.setMonth(base.getMonth() + monthsToAdd);
  const daysInTargetMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(d, daysInTargetMonth));
  return base;
}

// بتضيف عدد أيام على تاريخ
export function addDaysToDateStr(startStr, daysToAdd) {
  const [y, m, d] = startStr.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + daysToAdd);
  return base;
}

export function dateObjToInputValue(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
