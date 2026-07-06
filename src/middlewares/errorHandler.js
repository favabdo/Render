// middlewares/errorHandler.js
// middleware مركزي للأخطاء — أي Error يترمي جوه route ملفوف بـ asyncHandler بيوصل هنا
// بدل ما نكرر try/catch { res.status(500).json({error: err.message}) } في كل route لوحده.
// أي route عايز status code مخصص (400/403/404/409...) يحطه في err.status قبل ما يرميه.

const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'حصل خطأ في السيرفر' });
}

module.exports = errorHandler;
