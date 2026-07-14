// middlewares/auth.js
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const userRepo = require('../repositories/user.repo');

// رول 3 = "CRM Agent": إيجنت بيشوف بس قسم العملاء (Contacts) في الداشبورد،
// ومش بيقدر يعدّل أو يضيف أي حاجة (لا اسم، لا رقم تليفون، لا زيارة، لا عقد
// صيانة، ولا يمسح عميل) — قراءة بس. أي راوت تاني في السيرفر (محادثات، إنبوكسز،
// إعدادات، يوزرز...) ممنوع عليه خالص. القايمة دي هي مصدر الحقيقة الوحيد لصلاحياته
// (الإخفاء في الفرونت في dashboard.html شكل بس — الحماية الحقيقية من هنا)
const CRM_AGENT_ROLE = 3;
const CRM_AGENT_ALLOWED_ROUTES = [
  { method: null, pattern: /^\/api\/me(\/.*)?$/ }, // إدارة حسابه الشخصي (بروفايل/أفتار/كلمة سر) — مش جزء من "قسم العملاء" لكن أساسي لأي يوزر مسجل دخول
  { method: 'GET', pattern: /^\/api\/contacts$/ },
  { method: 'GET', pattern: /^\/api\/contacts-paginated$/ },
  { method: 'GET', pattern: /^\/api\/contacts\/\d+$/ },
  { method: 'GET', pattern: /^\/api\/contacts\/\d+\/visits$/ },
  { method: 'GET', pattern: /^\/api\/contacts\/\d+\/maintenance-contracts$/ },
];

function isCrmAgentRequestAllowed(req) {
  return CRM_AGENT_ALLOWED_ROUTES.some(({ method, pattern }) => {
    if (method && req.method !== method) return false;
    return pattern.test(req.path);
  });
}

function enforceCrmAgentAccess(req, res) {
  if (req.user?.role === CRM_AGENT_ROLE && !isCrmAgentRequestAllowed(req)) {
    res.status(403).json({ error: 'حساب CRM Agent يقدر يشوف قسم العملاء بس (بدون تعديل)' });
    return true; // اتقفلت الاستجابة، الكولر يوقف هنا ومايناديش next()
  }
  return false;
}

// بنعمل كاش صغير جدًا (بضع ثواني) لحالة كل يوزر عشان مانضربش الداتابيز في كل
// request، لكن برضه نضمن إن أي إيجنت اتعمله deactivate أو حذف يتقفل بسرعة
// (خلال ثواني قليلة) حتى لو مبعتش أي حدث realtime وصله (شوف socket/socket.js
// لقفل فوري وقت فتح الداشبورد فعليًا).
const STATUS_CACHE_TTL_MS = 5000;
const statusCache = new Map(); // userId -> { status, expiresAt }

async function getUserStatus(userId) {
  const cached = statusCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.status;

  const user = await userRepo.findUserById(userId);
  const status = user ? user.status : null; // null يعني اليوزر اتمسح خالص
  statusCache.set(userId, { status, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
  return status;
}

// أي إيجنت يتعمله deactivate أو delete بننادي على الدالة دي عشان نمسح الكاش بتاعه
// فورًا، فأول request جاي منه (أو من apiFetch العادي في الداشبورد) يترفض على طول
function invalidateUserStatusCache(userId) {
  statusCache.delete(String(userId));
  statusCache.delete(Number(userId));
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'لازم تسجل دخول' });
  }

  // نجرب الأول كـ JWT عادي (تسجيل دخول من لوحة التحكم)
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    // مش JWT صحيح — ممكن يكون توكن وصول شخصي (Access Token) من صفحة
    // البروفايل، مستخدم في تكامل خارجي عن طريق الـ API
    userRepo
      .findUserByAccessToken(token)
      .then((user) => {
        if (!user || user.status !== 'active') {
          return res.status(401).json({ error: 'التوكن غير صحيح أو الحساب غير مفعّل' });
        }
        req.user = { userId: user.id, email: user.email, role: user.role };
        if (enforceCrmAgentAccess(req, res)) return;
        next();
      })
      .catch(next);
    return;
  }

  getUserStatus(payload.userId)
    .then((status) => {
      if (status !== 'active') {
        return res.status(401).json({ error: 'الحساب موقوف أو محذوف، سجل دخول تاني' });
      }
      req.user = payload;
      if (enforceCrmAgentAccess(req, res)) return;
      next();
    })
    .catch(next);
}

module.exports = { requireAuth, invalidateUserStatusCache };
