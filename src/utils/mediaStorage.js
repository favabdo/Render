// utils/mediaStorage.js
// بيسجل ملفات الوسائط (صور/فيديوهات/صوتيات/مستندات) على الديسك جوه public/uploads
// ويرجع رابط عام (public URL) نخزنه في عمود media_url بدل الـ id بتاع ميتا نفسه —
// عشان الواجهة تقدر تعرض الصورة/الفيديو/الصوت مباشرة من غير أي auth إضافي.
//
// ملحوظة: لو السيرفر شغال على استضافة بدون disk دائم (زي Render Free بدون
// Persistent Disk)، الملفات دي ممكن تتمسح لما السيرفر يعيد التشغيل أو ينشر
// نسخة جديدة. لو محتاج تخزين دائم فعلي، الأنسب إنك تربط Persistent Disk من
// إعدادات الاستضافة أو تحول التخزين لـ S3/Cloudinary بعدين.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');

const EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'video/quicktime': '.mov',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/webm': '.webm',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'application/zip': '.zip',
};

function extensionFor(mimeType, fallbackName) {
  if (mimeType && EXTENSION_BY_MIME[mimeType]) return EXTENSION_BY_MIME[mimeType];
  if (fallbackName) {
    const ext = path.extname(fallbackName);
    if (ext) return ext;
  }
  return '';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * بيحفظ Buffer على الديسك جوه public/uploads/<folder>/ باسم عشوائي آمن،
 * وبيرجع { publicUrl, absolutePath } — الـ publicUrl ده جاهز نخزنه في الداتابيز
 * ونستخدمه مباشرة كـ src في الواجهة (بما إن public/ متسيرفر كـ static)
 */
function saveBuffer(buffer, { folder = 'incoming', mimeType = null, originalName = null } = {}) {
  const dir = path.join(UPLOADS_ROOT, folder);
  ensureDir(dir);

  const ext = extensionFor(mimeType, originalName);
  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const absolutePath = path.join(dir, fileName);
  fs.writeFileSync(absolutePath, buffer);

  return {
    publicUrl: `/uploads/${folder}/${fileName}`,
    absolutePath,
  };
}

module.exports = { saveBuffer };
