// config/env.js
// نقطة واحدة لقراءة كل متغيرات البيئة، عشان مانكررش process.env.X في كل مكان
// ولو حبينا نضيف متغير جديد أو نغيّر قيمة افتراضية نغيّرها من هنا بس

require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  DASHBOARD_ORIGIN: process.env.DASHBOARD_ORIGIN || '*',

  // دومين المشروع الثابت (بيتستخدم في بناء لينكات الإيميلات زي رابط تحديد كلمة السر ورابط اللوجو)
  // لازم يكون نفس دومين الإرسال في Resend عشان الإيميلات متتحطش في السبام
  // مثال: https://app.abdullahelsawy.online (من غير / في الآخر)
  APP_URL: process.env.APP_URL || '',

  JWT_SECRET: process.env.JWT_SECRET || 'change-this-secret-in-production',
  SETUP_SECRET: process.env.SETUP_SECRET,

  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,

  // إعدادات إرسال إيميل الدعوة للإيجنتس الجدد عن طريق Resend (https://resend.com)
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_FROM: process.env.MAIL_FROM || 'NileChat <onboarding@resend.dev>',

  DB_TABLE_NAME: process.env.DB_TABLE_NAME || 'NileChat_byA',
  DB: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
  },
};
