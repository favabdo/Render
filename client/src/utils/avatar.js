export const AVATAR_COLORS = [
  '#6C5CE7',
  '#00B894',
  '#0984E3',
  '#E17055',
  '#E84393',
  '#00CEC9',
  '#FDCB6E',
  '#D63031',
  '#0891B2',
  '#7C3AED',
];

// واتساب Business Cloud API مش بيوفر صورة البروفايل عن طريق الـ API (ميتا بتمنعها لأسباب
// خصوصية)، فبدل ما نحط صور وهمية بنعرض أول حرف من الاسم الأول والأخير في دايرة ملونة.
export function initialsFromName(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarColorFor(seed) {
  const str = String(seed || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
