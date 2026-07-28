// utils/compressImage.js
// بيصغّر أي صورة (من الكاميرا مثلًا، ممكن تكون 5-15MB) لأقصى بعد 1600px وجودة
// JPEG معقولة قبل ما نرفعها — ده بيقلل حجم الرفع بشكل كبير من غير فرق يُذكر في
// الشكل داخل شات واتساب، وبالتالي بيحسّن وقت إرسال الصور خصوصًا على نت بطيء.
// مش بنلمس GIF (ممكن يكون متحرك) ولا لو الصورة أصلًا صغيرة كفاية.

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;
const SKIP_UNDER_BYTES = 350 * 1024; // لو الملف أصلاً أصغر من كده متستهلش تعيد ترميزه

export async function compressImageIfNeeded(file) {
  if (!file.type?.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size <= SKIP_UNDER_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file; // لو مفيدش، ابعت الأصلي زي ما هو

    const newName = file.name.replace(/\.\w+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch (err) {
    // أي مشكلة في الضغط (متصفح قديم مش داعم createImageBitmap مثلًا) —
    // ابعت الملف الأصلي زي ما هو بدل ما توقف الإرسال بالكامل
    return file;
  }
}
