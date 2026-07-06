// utils/logger.js
// لوجر بسيط بيغلف console عشان يبقى فيه نقطة واحدة نقدر نتحكم منها في طريقة
// الطباعة/التسجيل بعدين (مثلاً لو حبينا نبعت اللوجز لخدمة خارجية زي Sentry)

function info(...args) {
  console.log(...args);
}

function warn(...args) {
  console.warn(...args);
}

function error(...args) {
  console.error(...args);
}

module.exports = { info, warn, error };
