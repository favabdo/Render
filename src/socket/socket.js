// socket/socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../utils/logger');

// role: 0=owner(superadmin) / 1=admin / 2=agent / 3=CRM Agent — نفس المنطق
// المستخدم في middlewares/admin.js وconversation.controller.js
const PRIVILEGED_ROOM = 'post_resolve_viewers'; // admin/owner بس (role <= 1)

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

    // مؤشر "بيكتب دلوقتي" — بنستقبله من الإيجنت اللي بيكتب وبنبعته لكل الإيجنتس
    // التانيين المتصلين (socket.broadcast) عشان اللي فاتحين نفس المحادثة يشوفوه لايف.
    // الفلترة على أساس conversationId بتحصل في الفرونت إند (مش هنا).
    socket.on('typing', (payload) => {
      if (!payload || !payload.conversationId) return;
      socket.broadcast.emit('typing', payload);
    });

    socket.on('stop_typing', (payload) => {
      if (!payload || !payload.conversationId) return;
      socket.broadcast.emit('stop_typing', payload);
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

module.exports = { initSocket, emitToPrivilegedRoom, PRIVILEGED_ROOM };
