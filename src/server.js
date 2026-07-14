const http = require('http');
const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { initSocket } = require('./socket/socket');
const { startAutoResolveScheduler } = require('./services/autoResolve.service');
const { startContractExpiryScheduler } = require('./services/contractExpiry.service');
const notificationService = require('./services/notification.service');

const server = http.createServer(app);
const io = initSocket(server);

app.set('io', io); // عشان أي route يقدر يبعت realtime events
notificationService.setIo(io); // عشان خدمة الإشعارات تقدر تبعت 'new_notification' لايف

server.listen(env.PORT, () => {
  logger.info(`🚀 السيرفر شغال على بورت ${env.PORT}`);
});

// فحص دوري (Auto Resolve After Inactivity) — بيقفل المحادثات الخاملة أوتوماتيك
// حسب عدد الأيام المحدد في إعدادات الحساب (Settings -> Account Settings)
startAutoResolveScheduler(() => app.get('io'));

// فحص دوري (عقد الصيانة منتهي) — بيبعت رسالة الأتمتة لأي عميل عقده عدّى تاريخ
// نهايته من غير ما يتجدد (مرة واحدة بس لكل عقد)
startContractExpiryScheduler(() => app.get('io'));
