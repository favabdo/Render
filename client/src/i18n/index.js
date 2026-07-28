import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enSidebar from './locales/en/sidebar.json';
import enChats from './locales/en/chats.json';
import enContacts from './locales/en/contacts.json';
import enCustomerDetails from './locales/en/customerDetails.json';
import enSettings from './locales/en/settings.json';
import enTemplates from './locales/en/templates.json';
import enScheduledTasks from './locales/en/scheduledTasks.json';
import enAnalytics from './locales/en/analytics.json';
import enAi from './locales/en/ai.json';
import enProfile from './locales/en/profile.json';
import enNotifications from './locales/en/notifications.json';

import arCommon from './locales/ar/common.json';
import arAuth from './locales/ar/auth.json';
import arSidebar from './locales/ar/sidebar.json';
import arChats from './locales/ar/chats.json';
import arContacts from './locales/ar/contacts.json';
import arCustomerDetails from './locales/ar/customerDetails.json';
import arSettings from './locales/ar/settings.json';
import arTemplates from './locales/ar/templates.json';
import arScheduledTasks from './locales/ar/scheduledTasks.json';
import arAnalytics from './locales/ar/analytics.json';
import arAi from './locales/ar/ai.json';
import arProfile from './locales/ar/profile.json';
import arNotifications from './locales/ar/notifications.json';

export const RTL_LANGS = ['ar'];

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    sidebar: enSidebar,
    chats: enChats,
    contacts: enContacts,
    customerDetails: enCustomerDetails,
    settings: enSettings,
    templates: enTemplates,
    scheduledTasks: enScheduledTasks,
    analytics: enAnalytics,
    ai: enAi,
    profile: enProfile,
    notifications: enNotifications,
  },
  ar: {
    common: arCommon,
    auth: arAuth,
    sidebar: arSidebar,
    chats: arChats,
    contacts: arContacts,
    customerDetails: arCustomerDetails,
    settings: arSettings,
    templates: arTemplates,
    scheduledTasks: arScheduledTasks,
    analytics: arAnalytics,
    ai: arAi,
    profile: arProfile,
    notifications: arNotifications,
  },
};

const savedLang = (typeof window !== 'undefined' && localStorage.getItem('nilechat_lang')) || 'ar';

i18n.use(initReactI18next).init({
  resources,
  lng: savedLang,
  fallbackLng: 'ar',
  ns: [
    'common',
    'auth',
    'sidebar',
    'chats',
    'contacts',
    'customerDetails',
    'settings',
    'templates',
    'scheduledTasks',
    'analytics',
    'ai',
    'profile',
    'notifications',
  ],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

// ملحوظة مهمة: الاتجاه (dir) بقى ثابت على "rtl" دايمًا (نفس شكل الواجهة الحالي
// بالعربي)، بغض النظر عن اللغة المختارة. زرار تبديل اللغة بيترجم النصوص بس
// (عربي <-> إنجليزي) من غير ما يقلب مكان أي عنصر في الواجهة. لو حبيت ترجع
// السلوك القديم (قلب الاتجاه لـ ltr مع الإنجليزي)، رجّع dir لـ:
// `RTL_LANGS.includes(lang) ? 'rtl' : 'ltr'`
export function applyDocumentDirection(lang) {
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', 'rtl');
}

export function changeLanguage(lang) {
  localStorage.setItem('nilechat_lang', lang);
  i18n.changeLanguage(lang);
  applyDocumentDirection(lang);
}

applyDocumentDirection(savedLang);

export default i18n;
