// socket/socket.js
const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../utils/logger');

function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: env.DASHBOARD_ORIGIN },
  });

  io.on('connection', (socket) => {
    logger.info('🔌 موظف جديد اتصل بالـ realtime:', socket.id);

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

module.exports = { initSocket };
