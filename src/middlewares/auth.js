// middlewares/auth.js
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const userRepo = require('../repositories/user.repo');

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
      next();
    })
    .catch(next);
}

module.exports = { requireAuth, invalidateUserStatusCache };
