import useLanguageStore from '../store/languageStore';
import dict from './translations';

// t('namespace.key') -> النص بلغة الواجهة الحالية. لو المفتاح مش موجود، بيرجّع
// المفتاح نفسه (بدل ما الصفحة تكسر) عشان يبان بسهولة في التطوير إن فيه ترجمة ناقصة
function resolveKey(key) {
  const [namespace, prop] = key.split('.');
  return dict[namespace]?.[prop] || null;
}

export default function useTranslation() {
  const lang = useLanguageStore((s) => s.lang);
  const setLang = useLanguageStore((s) => s.setLang);
  const toggleLang = useLanguageStore((s) => s.toggleLang);

  function t(key, vars) {
    const entry = resolveKey(key);
    let text = entry ? entry[lang] || entry.ar || key : key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, v);
      }
    }
    return text;
  }

  return { t, lang, setLang, toggleLang, isRtl: lang === 'ar' };
}
