// theme/accentColor.js
// بيدي كل إيجنت إمكانية يختار لون "الطابع" الشخصي بتاعه بنفسه (زرار من صفحة
// البروفايل)، واللون ده بيتطبّق فورًا على كل حاجة في البرنامج بنيّة على متغير
// --primary (زرارات، لون رسايلنا احنا اللي بنبعتها، خلفية اسم العميل/الأفتار،
// ولون تظليل السكشن اللي واقف عليه دلوقتي في السايدبار --sidebar-active) —
// نفس بالظبط فكرة theme/index.js (فاتح/غامق) بس هنا اللون نفسه هو اللي بيتغيّر
// مش الوضع. كل إيجنت له تفضيله الخاص محفوظ محليًا على الجهاز (localStorage)
// زي بالظبط باقي تفضيلات الواجهة (الثيم، اللغة)، عشان ميحصلش تعارض لو أكتر
// من إيجنت بيسجلوا دخول من نفس الجهاز

export const DEFAULT_ACCENT_COLOR = '#6C5CE7';

const STORAGE_PREFIX = 'nilechat_accent_color_';

function storageKey(userId) {
  return `${STORAGE_PREFIX}${userId}`;
}

// مجموعة ألوان جاهزة (Presets) تتعرض في المودال جمب الـ color picker الحر،
// عشان يبقى فيه اختيار سريع من غير ما الإيجنت يدور بنفسه على درجة اللون
export const ACCENT_COLOR_PRESETS = [
  '#6C5CE7', // بنفسجي (الأساسي)
  '#2563eb', // أزرق
  '#0ea5e9', // سماوي
  '#10b981', // أخضر
  '#f59e0b', // برتقالي
  '#ef4444', // أحمر
  '#ec4899', // فوشيا
  '#64748b', // رمادي مزرق
];

export function getStoredAccentColor(userId) {
  if (typeof window === 'undefined' || !userId) return DEFAULT_ACCENT_COLOR;
  try {
    return localStorage.getItem(storageKey(userId)) || DEFAULT_ACCENT_COLOR;
  } catch {
    return DEFAULT_ACCENT_COLOR;
  }
}

function clamp255(n) {
  return Math.max(0, Math.min(255, n));
}

function hexToRgbTriple(hex) {
  const h = String(hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return { r: 108, g: 92, b: 231 }; // fallback = DEFAULT_ACCENT_COLOR
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex({ r, g, b }) {
  const toHex = (n) => clamp255(Math.round(n)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// بيمزج اللون مع الأبيض أو الأسود بنسبة معينة عشان نطلع درجة أفتح/أغمق منه —
// نفس فكرة CSS color-mix() بس بدعم أوسع للمتصفحات (بحساب يدوي بسيط)
function mixWith(hex, targetRgb, amount) {
  const c = hexToRgbTriple(hex);
  return rgbToHex({
    r: c.r + (targetRgb.r - c.r) * amount,
    g: c.g + (targetRgb.g - c.g) * amount,
    b: c.b + (targetRgb.b - c.b) * amount,
  });
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

// بيطبّق لون معين كـ --primary على كل الصفحة فورًا: بيشتق منه درجة أفتح
// (--primary-light) وأغمق (--primary-dark)، وبيحدّث --primary-rgb (نسخة
// "r,g,b" مستخدمة في كل تدرجات الشفافية rgba(var(--primary-rgb), OPACITY)
// المنتشرة في التصميم)، وبيحدّث --sidebar-active (لون تظليل السكشن النشط
// في الشريط الجانبي) بنفس اللون كمان
export function applyAccentColor(hex) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { r, g, b } = hexToRgbTriple(hex);
  root.style.setProperty('--primary', hex);
  root.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);
  root.style.setProperty('--primary-light', mixWith(hex, WHITE, 0.35));
  root.style.setProperty('--primary-dark', mixWith(hex, BLACK, 0.15));
  root.style.setProperty('--sidebar-active', hex);
}

export function setAccentColor(userId, hex) {
  if (userId) {
    try {
      localStorage.setItem(storageKey(userId), hex);
    } catch {
      // localStorage ممكن يكون متعطل (وضع خاص إلخ) — نتجاهل ونطبّق اللون
      // بصريًا برضه حتى لو مش هيفضل محفوظ للمرة الجاية
    }
  }
  applyAccentColor(hex);
}

export function resetAccentColor(userId) {
  if (userId) {
    try {
      localStorage.removeItem(storageKey(userId));
    } catch {
      // نفس ملحوظة setAccentColor فوق
    }
  }
  applyAccentColor(DEFAULT_ACCENT_COLOR);
}

// بيقرأ آخر يوزر مسجل دخوله محفوظ في localStorage مباشرة (من غير ما نستورد
// authStore كامل) عشان نتجنب أي circular import بين theme/ و store/، ونطبّق
// لونه المفضل فورًا وقت تحميل التطبيق (قبل أول render) عشان مايبانش وميض من
// اللون الافتراضي للون المختار (flash of default accent) — نفس فكرة
// applyTheme(getStoredTheme()) بالظبط في theme/index.js
function readStoredUserId() {
  try {
    const raw = localStorage.getItem('nilechat_user');
    const user = raw ? JSON.parse(raw) : null;
    return user ? user.id : null;
  } catch {
    return null;
  }
}
applyAccentColor(getStoredAccentColor(readStoredUserId()));
