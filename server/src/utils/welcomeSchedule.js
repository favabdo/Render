// utils/welcomeSchedule.js
// أدوات لتقييم جدول أوقات رسالة الترحيب: هل الوقت الحالي "داخل أوقات العمل"
// المحددة في الإعدادات ولا لأ؟ بيُستخدم علشان نقرر نبعت رسالة الترحيب العادية
// ولا رسالة "خارج أوقات العمل".

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_TIMEZONE = 'Africa/Cairo';

function defaultSchedule() {
  const days = {};
  for (const key of DAY_KEYS) {
    // افتراضيًا: أيام الأسبوع (الأحد للخميس) من 9 صباحًا لـ 5 مساءً، والجمعة/السبت مقفولة
    const isWeekend = key === 'fri' || key === 'sat';
    days[key] = { enabled: !isWeekend, start: '09:00', end: '17:00' };
  }
  return { timezone: DEFAULT_TIMEZONE, days };
}

// بيتأكد إن الـ JSON اللي جاي من الداتابيز أو من اليوزر شكله صحيح، ولو فيه
// أي حاجة ناقصة أو غلط بيكمّلها بالقيم الافتراضية بدل ما يفشل بالكامل
function normalizeSchedule(raw) {
  const base = defaultSchedule();
  if (!raw || typeof raw !== 'object') return base;

  const timezone = typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone.trim() : base.timezone;
  const days = {};
  for (const key of DAY_KEYS) {
    const d = raw.days && typeof raw.days === 'object' ? raw.days[key] : null;
    if (d && typeof d === 'object') {
      const enabled = Boolean(d.enabled);
      const start = /^([01]\d|2[0-3]):[0-5]\d$/.test(d.start) ? d.start : base.days[key].start;
      const end = /^([01]\d|2[0-3]):[0-5]\d$/.test(d.end) ? d.end : base.days[key].end;
      days[key] = { enabled, start, end };
    } else {
      days[key] = base.days[key];
    }
  }
  return { timezone, days };
}

function parseScheduleJson(jsonString) {
  if (!jsonString) return defaultSchedule();
  try {
    return normalizeSchedule(JSON.parse(jsonString));
  } catch {
    return defaultSchedule();
  }
}

// بيرجع { dayKey, minutesSinceMidnight } للوقت الحالي في التايم زون المحدد،
// من غير ما نحتاج أي مكتبة خارجية (Intl مدعومة أصلاً في Node)
function getNowInTimezone(timezone) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const weekdayMap = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' };
  const dayKey = weekdayMap[map.weekday] || 'sun';
  const hour = Number(map.hour === '24' ? '0' : map.hour);
  const minute = Number(map.minute);
  return { dayKey, minutesSinceMidnight: hour * 60 + minute };
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// بيرجع true لو الوقت الحالي واقع جوه أوقات العمل المحددة لليوم الحالي
function isWithinBusinessHours(schedule) {
  const s = normalizeSchedule(schedule);
  let nowInfo;
  try {
    nowInfo = getNowInTimezone(s.timezone);
  } catch {
    nowInfo = getNowInTimezone(DEFAULT_TIMEZONE);
  }

  const day = s.days[nowInfo.dayKey];
  if (!day || !day.enabled) return false;

  const startMin = timeToMinutes(day.start);
  const endMin = timeToMinutes(day.end);
  const nowMin = nowInfo.minutesSinceMidnight;

  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // فترة بتعدي منتصف الليل (مثلاً من 22:00 لـ 06:00)
  return nowMin >= startMin || nowMin < endMin;
}

module.exports = {
  DAY_KEYS,
  DEFAULT_TIMEZONE,
  defaultSchedule,
  normalizeSchedule,
  parseScheduleJson,
  isWithinBusinessHours,
};
