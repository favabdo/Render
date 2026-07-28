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
  CONTACT_CREATED: 'contact_created',
  CONTACT_UPDATED: 'contact_updated',
  SCHEDULED_TASK_CREATED: 'scheduled_task_created',
  SETTINGS_UPDATED: 'settings_updated',
  TEAM_UPDATED: 'team_updated',
  INBOX_UPDATED: 'inbox_updated',
  LABEL_UPDATED: 'label_updated',
  CANNED_RESPONSE_UPDATED: 'canned_response_updated',
  RESOLVE_CATEGORY_UPDATED: 'resolve_category_updated',
  WEBHOOK_UPDATED: 'webhook_updated',
  CONVERSATION_REPLY_ACTIVITY: 'conversation_reply_activity',
};

// عنوان ثابت لكل نوع من الأنواع الجديدة دي (يتعرض في الإشعار نفسه)
const ACTIVITY_TYPE_TITLES = {
  [NOTIFICATION_TYPES.CONTACT_CREATED]: 'عميل جديد',
  [NOTIFICATION_TYPES.CONTACT_UPDATED]: 'تعديل على عميل',
  [NOTIFICATION_TYPES.SCHEDULED_TASK_CREATED]: 'تاسك جديد',
  [NOTIFICATION_TYPES.SETTINGS_UPDATED]: 'تعديل في الإعدادات',
  [NOTIFICATION_TYPES.TEAM_UPDATED]: 'تعديل على تيم',
  [NOTIFICATION_TYPES.INBOX_UPDATED]: 'تعديل على Inbox',
  [NOTIFICATION_TYPES.LABEL_UPDATED]: 'تعديل على ليبل',
  [NOTIFICATION_TYPES.CANNED_RESPONSE_UPDATED]: 'تعديل على رد جاهز',
  [NOTIFICATION_TYPES.RESOLVE_CATEGORY_UPDATED]: 'تعديل على تصنيف إغلاق',
  [NOTIFICATION_TYPES.WEBHOOK_UPDATED]: 'تعديل على Webhook',
  [NOTIFICATION_TYPES.CONVERSATION_REPLY_ACTIVITY]: 'رد على محادثة',
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

// إشعار تسجيل الدخول — زي أي نوع تاني بالظبط، بيتبعت بس لو اليوزر مفعّل النوع
// ده (login) من تفضيلاته في البروفايل
async function notifyLogin(user, { ip = null } = {}) {
  try {
    const userId = user.userId || user.id;
    const [prefs, fullUser] = await Promise.all([
      userRepo.getNotificationPrefs(userId),
      userRepo.findUserById(userId),
    ]);
    const pref = (prefs && prefs[NOTIFICATION_TYPES.LOGIN]) || { email: false, push: false };
    if (!pref.push && !pref.email) return;

    const time = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
    const title = 'تسجيل دخول جديد';
    const message = `تم تسجيل الدخول لحسابك بتاريخ ${time}${ip ? ` من عنوان IP: ${ip}` : ''}`;

    if (pref.push) {
      const notification = await notificationRepo.createNotification({
        userId,
        type: NOTIFICATION_TYPES.LOGIN,
        title,
        message,
      });
      emitToUser(userId, notification);
    }

    if (pref.email && fullUser?.email) {
      mailerService
        .sendNotificationEmail({ to: fullUser.email, title, message })
        .catch((err) => logger.error('❌ فشل إرسال إيميل إشعار تسجيل الدخول:', err.message));
    }
  } catch (err) {
    logger.error('❌ فشل تسجيل إشعار تسجيل الدخول:', err.message);
  }
}

// اختصار: بيجيب اسم الإيجنت من req.user.userId ويعمل notifyTypedActivity —
// مستخدم من كل الكونترولرز اللي بتغيّر إعدادات عامة (تيمز/إنبوكسز/ويبهوكس/
// ليبلز/ردود جاهزة/تصنيفات إغلاق/عملاء/تاسكس/إعدادات). بيحترم تفضيلات كل
// يوزر (push/email) بتاعة النوع ده بالظبط: لو حد قافل نوع معين من الإشعارات
// فعلاً ميوصلوش — لا Push ولا إيميل ولا حتى صف في صفحة الإشعارات
async function notifyTypedActivity(req, type, action, referenceId = null) {
  try {
    const [actingUser, users] = await Promise.all([
      userRepo.findUserById(req.user.userId),
      userRepo.listUsers(),
    ]);
    const actorName = actingUser ? userRepo.resolveDisplayName(actingUser) : req.user.email;
    const activeUserIds = (users || []).filter((u) => u.status === 'active').map((u) => u.id);
    if (activeUserIds.length === 0) return;

    const title = ACTIVITY_TYPE_TITLES[type] || 'نشاط جديد';
    const message = `${actorName || 'أحد الإيجنتس'} ${action}`;

    await notifyEvent(type, {
      title,
      message,
      referenceId,
      targetUserIds: activeUserIds,
      excludeUserId: req.user.userId,
    });
  } catch (err) {
    logger.error(`❌ فشل تنفيذ notifyTypedActivity (${type}):`, err.message);
  }
}

module.exports = {
  NOTIFICATION_TYPES,
  setIo,
  notifyEvent,
  notifyLogin,
  notifyTypedActivity,
};
