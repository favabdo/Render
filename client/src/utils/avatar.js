// كل الأفتارات (الحروف الأولى) بلون واحد ثابت ومناسب (نفس لون --primary) بدل
// ما كل عميل ياخد لون عشوائي مختلف — ده بيدي شكل أهدأ وأكثر اتساقًا في القايمة.
// استخدام var(--primary) هنا (بدل هيكس ثابت) يخلي خلفية اسم العميل (الأفتار)
// تتغيّر تلقائيًا لو الإيجنت غيّر لون الطابع الشخصي بتاعه من صفحة البروفايل
// (شوف theme/accentColor.js)
const AVATAR_FALLBACK_COLOR = 'var(--primary)';

// واتساب Business Cloud API مش بيوفر صورة البروفايل عن طريق الـ API (ميتا بتمنعها لأسباب
// خصوصية)، فبدل ما نحط صور وهمية بنعرض أول حرف من الاسم الأول والأخير في دايرة ملونة.
export function initialsFromName(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarColorFor() {
  return AVATAR_FALLBACK_COLOR;
}
