// utils/helpers.js
// دوال مساعدة عامة مستخدمة في أكتر من مكان في المشروع

// بيلف أي async route handler عشان أي Error يتلقط تلقائيًا ويتبعت لـ errorHandler
// بدل ما نكرر try/catch في كل route لوحده
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// بيشيل أي حاجة غير رقم من رقم التليفون (+، مسافات، شرط...) عشان نقارن رقمين بغض النظر عن التنسيق
function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

// رقم التليفون لازم يبدأ بـ + وبدون مسافات (زي شات ووت بالظبط)
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

module.exports = { asyncHandler, normalizeDigits, PHONE_REGEX };
