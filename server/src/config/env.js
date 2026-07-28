// config/env.js
// نقطة واحدة لقراءة كل متغيرات البيئة، عشان مانكررش process.env.X في كل مكان
// ولو حبينا نضيف متغير جديد أو نغيّر قيمة افتراضية نغيّرها من هنا بس

require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  DASHBOARD_ORIGIN: process.env.DASHBOARD_ORIGIN || '*',

  // دومين المشروع الثابت (بيتستخدم في بناء لينكات الإيميلات زي رابط تحديد كلمة السر ورابط اللوجو)
  // لازم يكون نفس دومين الإرسال في Resend عشان الإيميلات متتحطش في السبام
  // مثال: https://app.your-domain.example.com (من غير / في الآخر)
  APP_URL: process.env.APP_URL || '',

  JWT_SECRET: process.env.JWT_SECRET || 'change-this-secret-in-production',
  SETUP_SECRET: process.env.SETUP_SECRET,

  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,

  // إعدادات إرسال إيميل الدعوة للإيجنتس الجدد عن طريق Resend (https://resend.com)
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_FROM: process.env.MAIL_FROM || 'NileChat <onboarding@resend.dev>',

  // مفتاح Groq (https://console.groq.com/keys) — بيتستخدم في زرار "Generate Reply" اللي
  // بيقترح رد جاهز للإيجنت بالذكاء الاصطناعي بناءً على سياق المحادثة كامل. لو سيبته فاضي
  // الزرار هيفضل موجود بس مش هيعمل حاجة لما يتدوس عليه (مفيش أي Error هيظهر للإيجنت)
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',

  DB_TABLE_NAME: process.env.DB_TABLE_NAME || 'NileChat_byA',

  // لو true: تقرير التوقيت الحقيقي (كل مرحلة في مسار reply) بيترجع كمان جوه
  // جسم استجابة الـ HTTP نفسه (تحت مفتاح _timing) بجانب اللوج العادي، لكن بس
  // لو الطلب نفسه فيه هيدر x-debug-timing:1 برضه (الاتنين لازم يكونوا مظبوطين)
  // — عشان في الإنتاج العادي الاستجابة تفضل زي ما هي بالظبط من غير أي تغيير.
  // اللوج (logger.info) بيحصل دايمًا بغض النظر عن المتغير ده.
  DEBUG_TIMING: process.env.DEBUG_TIMING === 'true',
  DB: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    // إعدادات الـ connection pool بتاع mssql (tarn.js تحت السطح) — كلهم قابلين
    // للتظبيط من متغيرات البيئة من غير أي تغيير في الكود، والقيم الافتراضية دي
    // مظبوطة على سيناريو CRM إنتاجي (~100 إيجنت متزامن، آلاف المحادثات، حركة
    // سوكيت عالية). التفاصيل والمبررات في database/connection.js
    POOL_MAX: parseInt(process.env.DB_POOL_MAX || '20', 10),
    POOL_MIN: parseInt(process.env.DB_POOL_MIN || '2', 10),
    POOL_IDLE_TIMEOUT_MS: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000', 10),
    POOL_ACQUIRE_TIMEOUT_MS: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT_MS || '15000', 10),
    POOL_CREATE_TIMEOUT_MS: parseInt(process.env.DB_POOL_CREATE_TIMEOUT_MS || '15000', 10),
    POOL_DESTROY_TIMEOUT_MS: parseInt(process.env.DB_POOL_DESTROY_TIMEOUT_MS || '5000', 10),
  },
  // متطفّي فقط — يوم بيوم/عند التشخيص. لو true بيطبع سطر لوج على كل acquire/create
  // كونكشن من الـ pool. لازم يفضل false في الإنتاج العادي (ده أصلاً كان شغال
  // دايمًا من غير أي مفتاح إيقاف قبل كده — اتصلح عشان منضربش الأداء بلوجينج كتير
  // على كل استعلام).
  DB_POOL_DEBUG_LOG: process.env.DB_POOL_DEBUG_LOG === 'true',
  // لو true بيضيف GET /internal/pool-metrics (JSON خفيف: كونكشنز مستخدمة/فاضية/
  // منتظرة + متوسط وقت الـ acquire) — مطفي افتراضيًا، مفيش أي راوت إضافي غير لو
  // اتفعّل صراحةً.
  DB_POOL_METRICS_ENDPOINT: process.env.DB_POOL_METRICS_ENDPOINT === 'true',
};
