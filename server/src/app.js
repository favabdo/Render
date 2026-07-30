const path = require('path');
const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const { ensureSchema, getPoolMetrics } = require('./database/connection');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

const webhookRoutes = require('./routes/webhook.routes');
const authRoutes = require('./routes/auth.routes');
const conversationsRoutes = require('./routes/conversations.routes');
const inboxesRoutes = require('./routes/inboxes.routes');
const contactsRoutes = require('./routes/contacts.routes');
const devicesRoutes = require('./routes/devices.routes');
const scheduledTasksRoutes = require('./routes/scheduledTasks.routes');
const visitsRoutes = require('./routes/visits.routes');
const maintenanceContractsRoutes = require('./routes/maintenanceContracts.routes');
const cannedResponsesRoutes = require('./routes/cannedResponses.routes');
const resolveCategoriesRoutes = require('./routes/resolveCategories.routes');
const labelsRoutes = require('./routes/labels.routes');
const companyRoutes = require('./routes/company.routes');
const teamsRoutes = require('./routes/teams.routes');
const webhookConfigRoutes = require('./routes/webhookConfig.routes');
const notificationRoutes = require('./routes/notification.routes');

const app = express();

// السيرفر شغال ورا proxy (Vercel/Render)، فلازم نثق فيه عشان req.protocol
// يرجع https صحيح (مهم عشان لينك دعوة الإيجنتس يتبني بالبروتوكول الصحيح)
app.set('trust proxy', 1);

app.use(express.json());
app.use(cors({ origin: env.DASHBOARD_ORIGIN }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// راوت مراقبة اختياري لحالة الـ SQL connection pool — مطفي افتراضيًا (لازم
// DB_POOL_METRICS_ENDPOINT=true في الـ env)، ومفيش أي استعلام DB بيتنفذ هنا،
// بس قراءة عدادات جاهزة في الميموري (شوف getPoolMetrics في database/connection.js)
if (env.DB_POOL_METRICS_ENDPOINT) {
  app.get('/internal/pool-metrics', (req, res) => res.json(getPoolMetrics()));
}

// لوحة التحكم (بناء الفرونت إند React/Vite الجاهز للإنتاج، جوا client/dist)
const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDistPath));

// ملفات الوسائط (صور/فيديوهات/صوتيات/مستندات) اللي بتتسجل وقت التشغيل (شوف
// utils/mediaStorage.js) بتتخزن فعليًا جوه client/public/uploads — مش جوه
// client/dist. Vite بينسخ محتويات public/ جوه dist/ *وقت الـ build* بس، فأي
// ملف بيتسجل بعد كده (وقت التشغيل الفعلي: ميديا واردة من واتساب أو ميديا
// بيرفعها الإيجنت) مبيكونش موجود جوه dist أصلاً، وبالتالي أي رابط media_url
// كان بيرجع 404 عن طريق الـ static middleware اللي فوق (صورة مكسورة / خطأ
// تشغيل صوت في الواجهة حتى لو الملف اتحفظ صح على الديسك). عشان كده لازم راوت
// static منفصل يتأشر مباشرة على مكان الحفظ الفعلي، مش على dist
const uploadsPath = path.join(__dirname, '..', '..', 'client', 'public', 'uploads');
app.use('/uploads', express.static(uploadsPath));

// أي رابط داخلي بتاع React Router (زي /chats أو /login بعد Refresh) لازم يترجعله
// index.html عشان المتصفح يشغّل الـ React app والراوتينج يحصل من جوا المتصفح نفسه.
// ده لازم يتحط هنا *قبل* أي راوتر محمي بـ requireAuth، لأن الراوترات دي بتستخدم
// router.use(requireAuth) من غير مسار محدد، فبترفض أي طلب يوصلها (حتى لو مش API
// أصلاً زي /chats) بـ 401 قبل ما يوصل لأي fallback متحط بعدها.
app.get('*', (req, res, next) => {
  const isApiPath =
    req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/webhook');
  if (isApiPath) return next();
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

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

// الزيارات (Visits) الخاصة بكل عميل
app.use('/', visitsRoutes);

// سجل عقود الصيانة الكامل الخاص بكل عميل
app.use('/', maintenanceContractsRoutes);

// الردود المحفوظة (Quick Replies / Canned Responses) وتصنيفات الـ Resolve
app.use('/', cannedResponsesRoutes);
app.use('/', resolveCategoriesRoutes);
app.use('/', labelsRoutes);
app.use('/', companyRoutes);
app.use('/', teamsRoutes);
app.use('/', webhookConfigRoutes);
app.use('/', notificationRoutes);

// أي Error يوصل هنا (عن طريق asyncHandler أو next(err)) بيتحول لرد JSON موحد
app.use(errorHandler);

module.exports = app;
