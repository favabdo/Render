import {
  UsersRound,
  Headset,
  CreditCard,
  Sparkles,
  Shield,
  Globe,
  Wrench,
  Star,
  MessageCircle,
  Send,
  MessageSquare,
  Mail,
  Smartphone,
  PhoneCall,
  Webhook,
  Camera,
} from 'lucide-react';

// كل الأيقونات المستخدمة فعليًا في TEAM_ICON_OPTIONS + كل قنوات /api/inboxes/channels
// (شوف inbox.controller.js) — بدل `import * as Icons` اللي كانت بتجيب مكتبة lucide-react
// كاملة (~700kB) جوه bundle الـ Settings لمجرد استخدام أيقونات قليلة.
// ملحوظة: نسخة lucide-react دي مبقاش فيها أيقونات براندات (Facebook/Instagram)،
// فبنستخدم بديل عام (Messenger -> MessageCircle, Instagram -> Camera) للقنوات دي
// اللي أصلاً "قريبًا" ومش شغالة فعليًا لسه.
const ICON_MAP = {
  'users-round': UsersRound,
  headset: Headset,
  'credit-card': CreditCard,
  sparkles: Sparkles,
  shield: Shield,
  globe: Globe,
  wrench: Wrench,
  star: Star,
  'message-circle': MessageCircle,
  facebook: MessageCircle,
  instagram: Camera,
  send: Send,
  'message-square': MessageSquare,
  mail: Mail,
  smartphone: Smartphone,
  'phone-call': PhoneCall,
  webhook: Webhook,
};

export function iconKeyToComponent(key) {
  return ICON_MAP[key] || UsersRound;
}

export { MessageCircle as InboxDefaultIcon };
