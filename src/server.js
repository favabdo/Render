const http = require('http');
const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { initSocket } = require('./socket/socket');
const { startAutoResolveScheduler } = require('./services/autoResolve.service');

const server = http.createServer(app);
const io = initSocket(server);

app.set('io', io); // عشان أي route يقدر يبعت realtime events

server.listen(env.PORT, () => {
  logger.info(`🚀 السيرفر شغال على بورت ${env.PORT}`);
});

// فحص دوري (Auto Resolve After Inactivity) — بيقفل المحادثات الخاملة أوتوماتيك
// حسب عدد الأيام المحدد في إعدادات الحساب (Settings -> Account Settings)
startAutoResolveScheduler(() => app.get('io'));
