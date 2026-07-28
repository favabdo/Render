// صيغة رقم تليفون العميل: كود الدولة وبعده رقم الموبايل من غير الصفر اللي في الأول
// مصر: 20 + 1[0125] + 8 أرقام (12 رقم، بيبدأ بـ 2010/2011/2012/2015)
// السعودية: 966 + 5 + 8 أرقام (12 رقم، بيبدأ بـ 9665)
// الكويت: 965 + [569] + 7 أرقام (11 رقم)
// عُمان: 968 + [79] + 7 أرقام (11 رقم)
// لازم يفضل متزامن مع نفس الرجيكس القديم (كان في public/dashboard.html)
export const CUSTOMER_PHONE_REGEX = /^(201[0125]\d{8}|9665\d{8}|965[569]\d{7}|968[79]\d{7})$/;

// إعدادات كل مفتاح دولة: كود الدولة، الصيغة المحلية اللي بتتكتب (من غير كود
// الدولة)، والـ placeholder/hint اللي بيتغير مع الاختيار
export const PHONE_COUNTRIES = {
  eg: {
    key: 'eg',
    dial: '20',
    localRegex: /^1[0125]\d{8}$/,
    placeholderExample: '01054853221',
  },
  sa: {
    key: 'sa',
    dial: '966',
    localRegex: /^5\d{8}$/,
    placeholderExample: '0501234567',
  },
  kw: {
    key: 'kw',
    dial: '965',
    localRegex: /^[569]\d{7}$/,
    placeholderExample: '51234567',
  },
  om: {
    key: 'om',
    dial: '968',
    localRegex: /^[79]\d{7}$/,
    placeholderExample: '91234567',
  },
};

// بتاخد رقم زي ما اتكتب محليًا (ممكن يبدأ بصفر أو لأ) وترجّعه بالصيغة الكاملة
// اللي بتتخزن (كود الدولة + الرقم من غير الصفر)
export function normalizePhoneForCountry(countryKey, rawValue) {
  const country = PHONE_COUNTRIES[countryKey] || PHONE_COUNTRIES.eg;
  let digits = (rawValue || '').replace(/\D/g, '');
  if (!digits) return '';
  // لو اتكتب/اتلصق بالصيغة الدولية الكاملة (بكود الدولة) نسيبه زي ما هو
  if (digits.startsWith(country.dial) && CUSTOMER_PHONE_REGEX.test(digits)) return digits;
  // غير كده، نشيل أي صفر في الأول (زي ما بيتكتب محليًا: 010...) ونحط كود الدولة قبله
  digits = digits.replace(/^0+/, '');
  return country.dial + digits;
}
