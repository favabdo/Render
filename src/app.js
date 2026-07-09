const path = require('path');
const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const { ensureSchema } = require('./config/db');
const logger = require('./utils/logger');
const errorHandler = require('./middlewares/errorHandler');

const webhookRoutes = require('./routes/webhook.routes');
const authRoutes = require('./routes/auth.routes');
const conversationsRoutes = require('./routes/conversations.routes');
const inboxesRoutes = require('./routes/inboxes.routes');
const contactsRoutes = require('./routes/contacts.routes');
const devicesRoutes = require('./routes/devices.routes');
const scheduledTasksRoutes = require('./routes/scheduledTasks.routes');
const cannedResponsesRoutes = require('./routes/cannedResponses.routes');
const resolveCategoriesRoutes = require('./routes/resolveCategories.routes');

const app = express();

// السيرفر شغال ورا proxy (Vercel/Render)، فلازم نثق فيه عشان req.protocol
// يرجع https صحيح (مهم عشان لينك دعوة الإيجنتس يتبني بالبروتوكول الصحيح)
app.set('trust proxy', 1);

app.use(express.json());
app.use(cors({ origin: env.DASHBOARD_ORIGIN }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// لوحة التحكم (الفرونت إند الكامل بتاع public/)
app.use(express.static(path.join(__dirname, '..', 'public')));

// بنتأكد إن الجداول موجودة قبل أي route تاني (مرة واحدة بس بفضل الـ cache)
let schemaReady = null;
app.use(async (req, res, next) => {
  if (!schemaReady) {
    schemaReady = ensureSchema().catch((err) => {
      schemaReady = null; // لو فشلت، جرب تاني في الـ request الجاي
      throw err;
    });
  }
  try {
    await schemaReady;
    next();
  } catch (err) {
    logger.error('❌ فشل تجهيز قاعدة البيانات:', err.message);
    res.status(500).json({ error: 'Database not ready: ' + err.message });
  }
});

// الـ webhook بتاع واتساب (من غير auth - بتاع ميتا)
app.use('/', webhookRoutes);

// تسجيل الدخول + إنشاء أول موظف + البروفايل الشخصي + إدارة المستخدمين
app.use('/', authRoutes);

// كل الـ API الخاصة بالمحادثات (محمية بـ JWT)
app.use('/', conversationsRoutes);

// إدارة الـ Inboxes (القنوات: واتساب دلوقتي، وقنوات تانية جاية)
app.use('/', inboxesRoutes);

// إدارة الكونتاكتس الحقيقيين (العملاء)
app.use('/', contactsRoutes);

// أجهزة الدعم الفني (AnyDesk) الخاصة بكل عميل
app.use('/', devicesRoutes);

// التاسكات المجدولة (Scheduled Tasks) الخاصة بكل عميل
app.use('/', scheduledTasksRoutes);

// الردود المحفوظة (Quick Replies / Canned Responses) وتصنيفات الـ Resolve
app.use('/', cannedResponsesRoutes);
app.use('/', resolveCategoriesRoutes);

// أي Error يوصل هنا (عن طريق asyncHandler أو next(err)) بيتحول لرد JSON موحد
app.use(errorHandler);

module.exports = app;
