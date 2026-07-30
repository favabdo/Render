// socket/socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../utils/logger');

// role: 0=owner(superadmin) / 1=admin / 2=agent / 3=CRM Agent — نفس المنطق
// المستخدم في middlewares/admin.js وconversation.controller.js
const PRIVILEGED_ROOM = 'post_resolve_viewers'; // admin/owner بس (role <= 1)

// اسم غرفة الـ Socket.IO الخاصة بمحادثة معينة — أي حدث "تيار الرسايل الثقيل"
// (الرسالة الكاملة زي ما هي، media_ready...) بيتبعت للغرفة دي بس عشان منبعتش
// لكل الإيجنتس المتصلين حتى لو مش فاتحين المحادثة دي أصلاً. مؤشر الكتابة
// (typing/stop_typing) مش هنا — ده بيتبعت لغرفة الشركة كلها (companyRoom)،
// مش بس لمين فاتح نفس المحادثة (شوف السبب في تعليق socket.on('typing', ...)
// تحت). new_message نفسه فضل global عمدًا — التفصيل في تعليق conversation.service.js
function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

// اسم غرفة الـ Socket.IO الخاصة بشركة معينة — أي حدث بيمس بيانات شركة (عميل،
// محادثة، إنبوكس، ليبل...) لازم يتبعت للغرفة دي بس (شوف emitToCompany تحت)،
// عشان أجنتس شركة تانية ملهمش أي وصول لحظي (Realtime) لبيانات شركة غيرهم حتى
// لو الاتنين شغالين على نفس السيرفر/نفس قاعدة البيانات
function companyRoom(companyId) {
  return `company:${companyId}`;
}

function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: env.DASHBOARD_ORIGIN },
  });

  // بنحاول نتحقق من هوية أي اتصال جديد عن طريق نفس الـ JWT المستخدم في
  // requireAuth (لو الفرونت إند بعت التوكن في handshake.auth.token أو
  // كـ query param ?token=). لو التوكن مش موجود أو غلط، بنسيب الاتصال يكمل
  // عادي (عشان مانكسرش أي اتصال حالي) بس من غير ما ننضمّه لغرفة الـ admin/owner
  // الخاصة برسايل التقييم — يعني افتراضيًا (من غير توكن معروف) بيتعامل معاه
  // كإيجنت (الوضع الأكثر أمانًا)
  io.use((socket, next) => {
    const raw =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '') ||
      null;
    if (raw) {
      try {
        const payload = jwt.verify(raw, env.JWT_SECRET);
        socket.data.userRole = payload.role;
        socket.data.companyId = payload.companyId || null;
      } catch (err) {
        // توكن غير صالح — نكمل الاتصال عادي بس من غير هوية معروفة
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    logger.info('🔌 موظف جديد اتصل بالـ realtime:', socket.id);

    if (socket.data?.userRole !== undefined && Number(socket.data.userRole) <= 1) {
      socket.join(PRIVILEGED_ROOM);
    }

    // بمجرد ما نعرف شركة الإيجنت ده من التوكن، بننضمه لغرفتها — أي حدث بعد كده
    // (contact_created/conversation_updated/...) بيتبعت بس لغرفة الشركة دي عن
    // طريق emitToCompany، فمش هيوصله أي حدث من شركة تانية أبدًا. لو التوكن مش
    // معروف أصلًا (اتصال قديم أو غير موثّق)، الاتصال بيفضل من غير غرفة شركة —
    // يعني افتراضيًا مش هيوصله ولا حدث company-scoped (الوضع الأكثر أمانًا)
    if (socket.data?.companyId) {
      socket.join(companyRoom(socket.data.companyId));
    }

    // Socket.IO Conversation Rooms — الفرونت إند بيبعت join_conversation لما
    // يفتح شات معين، وleave_conversation لما يقفله أو يتنقل لشات تاني (قبل ما
    // ينضم للجديد). كده بدل ما نبعت تيار الرسايل الثقيل (الرسالة الكاملة/media...)
    // لكل الإيجنتس المتصلين، بنبعته بس لمين فاتح نفس المحادثة فعلاً. مؤشر الكتابة
    // مستثنى من ده عمدًا — شوف تعليق socket.on('typing', ...) تحت.
    socket.on('join_conversation', (conversationId) => {
      if (!conversationId) return;
      socket.join(conversationRoom(conversationId));
    });

    socket.on('leave_conversation', (conversationId) => {
      if (!conversationId) return;
      socket.leave(conversationRoom(conversationId));
    });

    // مؤشر "بيكتب دلوقتي": بيتبعت لكل إيجنتس الشركة (غرفة company:${id})، مش بس
    // اللي فاتحين نفس المحادثة، عشان يرجع يشتغل زي الأول قبل ما القسمة لغرف
    // لكل محادثة (join_conversation) تحصر وصوله بس على مين فاتح نفس المحادثة
    // بالظبط — وده كان بيخلي المؤشر عمليًا ميظهرش أبدًا (نادر جدًا إن اتنين
    // إيجنتس فاتحين بالظبط نفس المحادثة في نفس اللحظة). دلوقتي أي إيجنت بيكتب
    // في أي محادثة، كل زمايله في الشركة بيوصلهم الحدث (الفرونت إند بيعرض
    // مؤشر "بيكتب" في هيدر الشات لو فاتح نفس المحادثة، وفي قايمة الشاتس جمب
    // اسم العميل حتى لو المحادثة دي مش مفتوحة عنده أصلًا). لو الاتصال من غير
    // شركة معروفة (توكن قديم/غير موثّق)، بنرجع لبرودكاست عام زي السلوك الأصلي
    // قبل إضافة عزل الشركات
    socket.on('typing', (payload) => {
      if (!payload || !payload.conversationId) return;
      if (socket.data?.companyId) socket.to(companyRoom(socket.data.companyId)).emit('typing', payload);
      else socket.broadcast.emit('typing', payload);
    });

    socket.on('stop_typing', (payload) => {
      if (!payload || !payload.conversationId) return;
      if (socket.data?.companyId) socket.to(companyRoom(socket.data.companyId)).emit('stop_typing', payload);
      else socket.broadcast.emit('stop_typing', payload);
    });

    socket.on('disconnect', () => {
      logger.info('🔌 موظف قطع الاتصال:', socket.id);
    });
  });

  return io;
}

// بيبعت حدث لأصحاب الـ admin/owner بس (اللي اتوصلوا بـ socket فيه توكن صالح
// وrole<=1) — مستخدم لرسايل أتمتة "ما بعد الحل" (CSAT/تقييم) اللي الإيجنت مش
// المفروض يشوفها لايف برضه (مش بس لما يفتح الشات من الأول)
function emitToPrivilegedRoom(io, event, payload) {
  if (!io) return;
  io.to(PRIVILEGED_ROOM).emit(event, payload);
}

// بيبعت حدث لأصحاب الـ Socket.IO المنضمين لغرفة محادثة معينة بس (اللي فاتحين
// نفس المحادثة دلوقتي عن طريق join_conversation) — مستخدم لتيار الرسايل
// الثقيل اللي معندوش تأثير على قايمة المحادثات (زي message_media_ready).
function emitToConversationRoom(io, conversationId, event, payload) {
  if (!io || !conversationId) return;
  io.to(conversationRoom(conversationId)).emit(event, payload);
}

// بيبني الـ payload الخفيف اللي بيتبعت global في conversation_updated لما
// رسالة جديدة توصل/تتبعت — بس الحقول اللازمة لتحديث كارت المحادثة في القايمة
// الجانبية (معاينة آخر رسالة + نوعها + وقتها + اتجاهها عشان الفرونت إند يعرف
// يحسب عداد unread عليها ولا لأ لو مش فاتح المحادثة دي دلوقتي)، من غير ما
// نبعت جسم الرسالة كامل ولا أي رسايل تانية من تاريخ المحادثة. لاحظ إننا مش
// بنبعت unreadCount جاهز من هنا: العداد ده مش متسجل في الداتابيز أصلاً
// (state في الفرونت إند بس، مش عمود SQL)، وحسابه سيرفر-سايد هيحتاج تغيير في
// الـ schema/queries، وده برّه نطاق المهمة دي (تحسين توصيل الأحداث بس، من غير
// أي تغيير في منطق العمل أو الداتابيز).
function buildConversationSummary(conversationId, message) {
  return {
    id: conversationId,
    lastMessageText: message?.message_text || '',
    lastMessageType: message?.message_type || 'text',
    lastMessageDirection: message?.direction || null,
    lastMessageAt: message?.created_at || null,
  };
}

// بيبعت حدث لكل الإيجنتس المتصلين اللي تابعين لشركة معينة بس — ده اللي المفروض
// كل الكنترولرز تستخدمه بدل io.emit(...) العام القديم لأي حدث بيمس بيانات
// مرتبطة بشركة (عميل/محادثة/إنبوكس/ليبل/تيم/جهاز/زيارة/عقد/تاسك...). لو
// companyId مش موجود (احتياطي بس، مش المفروض يحصل من كنترولر شغال براحته
// خلف requireAuth) بترجع من غير ما تبعت أي حاجة عشان منسربش حدث لكل الشركات
function emitToCompany(io, companyId, event, payload) {
  if (!io || !companyId) return;
  io.to(companyRoom(companyId)).emit(event, payload);
}

module.exports = {
  initSocket,
  emitToPrivilegedRoom,
  emitToConversationRoom,
  emitToCompany,
  buildConversationSummary,
  conversationRoom,
  companyRoom,
  PRIVILEGED_ROOM,
};


