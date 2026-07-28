const http = require('http');
const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { getPool } = require('./database/connection');
const { initSocket } = require('./sockets/socket');
const { startAutoResolveScheduler } = require('./services/autoResolve.service');
const { startContractExpiryScheduler } = require('./services/contractExpiry.service');
const notificationService = require('./services/notification.service');

// بنسخّن الـ pool من وقت الإقلاع (مش لما أول request يوصل) — عشان أول ريكوست
// حقيقي من أي إيجنت متستناش فتح TCP + login handshake لـ SQL Server (اللي كان
// بيحصل قبل كده بس عند أول request لإن getPool() lazy). لو فشل هنا مش مشكلة:
// نفس الـ app.js middleware (schemaReady) هيحاول تاني تلقائيًا مع أول request
// حقيقي، فمفيش أي تغيير في السلوك لو الداتابيز كانت لسه مش جاهزة وقت الإقلاع.
getPool().catch((err) => {
  logger.warn('⚠️ فشل تسخين (warm-up) الـ SQL pool وقت الإقلاع — هيتعاد المحاولة مع أول request:', err.message);
});

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
