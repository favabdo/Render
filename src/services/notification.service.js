// خدمة الإشعارات: بتقرر لكل يوزر هل يوصله إشعار Push (In-App) و/أو إيميل، بناءً
// على تفضيلاته المحفوظة في صفحة البروفايل (notification_prefs)، وبتسجل كل حاجة
// في جدول NileChat_Notifications_byA

const notificationRepo = require('../repositories/notification.repo');
const userRepo = require('../repositories/user.repo');
const mailerService = require('./mailer.service');
const logger = require('../utils/logger');

const NOTIFICATION_TYPES = {
  CONVERSATION_CREATED: 'conversation_created',
  CONVERSATION_ASSIGNED: 'conversation_assigned',
  CONVERSATION_MENTION: 'conversation_mention',
  ASSIGNED_CONVERSATION_MESSAGE: 'assigned_conversation_message',
  PARTICIPATING_CONVERSATION_MESSAGE: 'participating_conversation_message',
  LOGIN: 'login',
  ACTIVITY: 'activity',
};

// io بتاع socket.io — بيتظبط مرة واحدة من app.js وقت الإقلاع عشان الخدمة دي تقدر
// تبعت تحديث لايف للفرونت إند (badge/جرس الإشعارات) أول ما إشعار جديد يتسجل
let ioInstance = null;
function setIo(io) {
  ioInstance = io;
}

function emitToUser(userId, notification) {
  if (ioInstance) {
    ioInstance.emit('new_notification', { userId: String(userId), notification });
  }
}

// الحدث الأساسي: بيتفحص تفضيلات كل يوزر مستهدف، ولو مفعّل عنده Push بيسجل إشعار
// في الجدول (وبيبعته لايف)، ولو مفعّل عنده Email بيبعتله إيميل فعلي
async function notifyEvent(type, { title, message, referenceId = null, targetUserIds = [], excludeUserId = null }) {
  const ids = [...new Set((targetUserIds || []).map(String))].filter(
    (id) => !excludeUserId || id !== String(excludeUserId)
  );
  if (ids.length === 0) return;

  await Promise.all(
    ids.map(async (userId) => {
      try {
        const [prefs, user] = await Promise.all([
          userRepo.getNotificationPrefs(userId),
          userRepo.findUserById(userId),
        ]);
        if (!user || user.status !== 'active') return;
        const pref = (prefs && prefs[type]) || { email: false, push: false };

        if (pref.push) {
          const notification = await notificationRepo.createNotification({
            userId,
            type,
            title,
            message,
            referenceId,
          });
          emitToUser(userId, notification);
        }

        if (pref.email && user.email) {
          mailerService
            .sendNotificationEmail({ to: user.email, title, message })
            .catch((err) => logger.error('❌ فشل إرسال إيميل إشعار:', err.message));
        }
      } catch (err) {
        logger.error(`❌ فشل تنفيذ notifyEvent (${type}) لليوزر ${userId}:`, err.message);
      }
    })
  );
}

// إشعار تسجيل الدخول — بيتسجل دايمًا (In-App) بغض النظر عن تفضيلات اليوزر، لأنه
// إشعار أمان أساسي مش حدث عادي
async function notifyLogin(user, { ip = null } = {}) {
  try {
    const time = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
    const notification = await notificationRepo.createNotification({
      userId: user.userId || user.id,
      type: NOTIFICATION_TYPES.LOGIN,
      title: 'تسجيل دخول جديد',
      message: `تم تسجيل الدخول لحسابك بتاريخ ${time}${ip ? ` من عنوان IP: ${ip}` : ''}`,
    });
    emitToUser(user.userId || user.id, notification);
  } catch (err) {
    logger.error('❌ فشل تسجيل إشعار تسجيل الدخول:', err.message);
  }
}

// نشاط عام (رد جديد اتبعت / تغيير في الإعدادات) — بيوصل لكل الإيجنتس النشطين
// (audit log مرئي للجميع)، بغض النظر عن تفضيلات الإشعارات الشخصية بتاعتهم
async function broadcastActivity({ actorId, actorName, action, referenceId = null }) {
  try {
    const users = await userRepo.listUsers();
    const activeUserIds = (users || [])
      .filter((u) => u.status === 'active')
      .map((u) => u.id);
    if (activeUserIds.length === 0) return;

    const title = 'نشاط جديد';
    const message = `${actorName || 'أحد الإيجنتس'} ${action}`;

    const notifications = await notificationRepo.createNotificationForUsers(activeUserIds, {
      type: NOTIFICATION_TYPES.ACTIVITY,
      title,
      message,
      referenceId,
      actorId,
      actorName,
    });
    notifications.forEach((n) => emitToUser(n.user_id, n));
  } catch (err) {
    logger.error('❌ فشل تسجيل نشاط عام (broadcastActivity):', err.message);
  }
}

// اختصار: بيجيب اسم الإيجنت من req.user.userId ويعمل broadcastActivity — مستخدم
// من كل الكونترولرز اللي بتغيّر إعدادات عامة (تيمز/إنبوكسز/ويبهوكس/ليبلز...)
async function logActivity(req, action, referenceId = null) {
  try {
    const actingUser = await userRepo.findUserById(req.user.userId);
    const actorName = actingUser ? userRepo.resolveDisplayName(actingUser) : req.user.email;
    await broadcastActivity({ actorId: req.user.userId, actorName, action, referenceId });
  } catch (err) {
    logger.error('❌ فشل تسجيل نشاط (logActivity):', err.message);
  }
}

module.exports = {
  NOTIFICATION_TYPES,
  setIo,
  notifyEvent,
  notifyLogin,
  broadcastActivity,
  logActivity,
};
