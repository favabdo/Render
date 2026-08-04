// utils/audioTranscode.js
// رسايل الصوت (voice notes) اللي واتساب بيبعتها بتوصلنا بصيغة audio/ogg
// (كودك Opus). الصيغة دي شغالة عادي على كروم/أندرويد وعلى المتصفح في
// الويندوز/الماك، لكن Safari على iOS — وأي متصفح تاني شغال على آيفون
// (كروم/إيدج على آيفون كلهم WebKit تحت السطح) — مبيدعمهاش خالص، فالريكورد
// كان بيوصل عادي جدًا للموبايل (الملف نفسه بينزل تمام) بس الـ <audio> element
// كان بيفشل يشغّله من غير أي رسالة خطأ واضحة للمستخدم، فكان حاسس إنه "مش
// بيتحمل". الحل: نحوّل أي صوت واصل من واتساب لصيغة mp3 (مدعومة في كل مكان
// تقريبًا) قبل ما نخزنه، فيشتغل عادي في الويب وفي الموبايل (آيفون وأندرويد).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const logger = require('./logger');

let ffmpegPath = null;
try {
  // ffmpeg-static بيوفر باينري ffmpeg جاهز مع الباكدج نفسها (من غير ما نحتاج
  // نصطّب ffmpeg على مستوى السيرفر/الاستضافة) — لو الباكدج مش متصطبة لأي سبب
  // (مثلاً لسه محتاجين npm install) بنرجع null وبنكمل عادي بالصيغة الأصلية
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  ffmpegPath = require('ffmpeg-static');
} catch (err) {
  logger.warn('⚠️ ffmpeg-static مش متصطبة — تحويل صوتيات واتساب لـ mp3 هيتعطل. شغّل npm install في مجلد server.');
}

// تشخيص بيتنفذ مرة واحدة لحظة تشغيل السيرفر (مش لحظة وصول ريكورد) — بيطبع في
// اللوج فورًا هل ffmpeg شغال فعليًا على البيئة دي (Render مثلًا) ولا لأ، من
// غير ما نستنى ريكورد تجريبي عشان نعرف. لو حصلت مشكلة، هتلاقيها في الـ Runtime
// Logs مباشرة بعد أي ديبلوي، مكتوب فيها السبب بالظبط (مسار مش موجود، صلاحية
// تشغيل ناقصة، أو الباينري نفسه مش متوافق مع نظام التشغيل بتاع Render)
function runStartupDiagnostic() {
  if (!ffmpegPath) return;
  if (!fs.existsSync(ffmpegPath)) {
    logger.error(`❌ [audioTranscode] مسار ffmpeg-static مش موجود فعليًا على الديسك: ${ffmpegPath} — تحويل الصوتيات هيفشل ويرجع للصيغة الأصلية (ogg) دايمًا`);
    return;
  }
  try {
    const out = execFileSync(ffmpegPath, ['-version'], { timeout: 5000 }).toString().split('\n')[0];
    logger.info(`✅ [audioTranscode] ffmpeg شغال تمام على السيرفر ده: ${out}`);
  } catch (err) {
    logger.error(`❌ [audioTranscode] ffmpeg-static موجود على المسار (${ffmpegPath}) بس مش قادر يشتغل فعليًا: ${err.message} — غالبًا مشكلة توافق مع نظام تشغيل الاستضافة`);
  }
}
runStartupDiagnostic();

/**
 * بيحول Buffer صوت (أي صيغة يقدر ffmpeg يفهمها، هنا بالذات ogg/opus) لـ mp3،
 * وبيرجع Buffer جديد أو null لو فشل التحويل لأي سبب (هنسيب الاستدعاء الأصلي
 * يقرر يستخدم الصيغة الأصلية بدل ما يوقف كل حاجة)
 */
function transcodeOggToMp3(inputBuffer) {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let ffmpeg;
    try {
      ffmpeg = spawn(ffmpegPath, ['-i', 'pipe:0', '-vn', '-acodec', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1']);
    } catch (err) {
      logger.error('❌ فشل تشغيل ffmpeg لتحويل صوت واصل من واتساب:', err.message);
      done(null);
      return;
    }

    const chunks = [];
    let stderrTail = '';
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-800);
    });
    ffmpeg.on('error', (err) => {
      logger.error('❌ فشل تشغيل ffmpeg لتحويل صوت واصل من واتساب:', err.message);
      done(null);
    });
    ffmpeg.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        logger.error(`❌ فشل تحويل صوت واصل من واتساب لـ mp3 (ffmpeg exit code ${code}): ${stderrTail}`);
        done(null);
        return;
      }
      done(Buffer.concat(chunks));
    });
    // لو ffmpeg قفل الـ stdin بدري لأي سبب (ملف تالف مثلاً)، منسيبش الـ EPIPE
    // يطلع Unhandled Error ويوقع البروسيس كله — الـ 'close' فوق هيتعامل مع
    // الفشل بالفعل
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.stdin.end(inputBuffer);
  });
}

module.exports = { transcodeOggToMp3 };
