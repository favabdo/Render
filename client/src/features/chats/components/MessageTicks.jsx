import { Check, CheckCheck } from 'lucide-react';

// تيك رسايل الإيجنت للعميل: بيظهر تيك واحد فورًا أول ما الرسالة "تتبعت" من
// عندنا (حتى لو حالتها الحقيقية عند واتساب لسه من ورا كده) — وده متعمّد عشان
// الإيجنت يحس إنها مشيت على طول. بعدين بيتحول لتيكين أول ما توصل فعليًا
// للعميل (delivered)، وتيكين ملوّنين أول ما العميل يفتحها ويشوفها (read).
// الحالة الوحيدة اللي مفيش فيها تيك خالص هي الفشل، ووقتها بيظهر شريط
// "فشل الإرسال" (MessageStatusRow) بدل التيك.
export default function MessageTicks({ m }) {
  if (m.from !== 'agent' || m.failed) return null;
  if (m.status === 'read') {
    return (
      <span className="msg-ticks msg-ticks-read" title="تمت المشاهدة">
        <CheckCheck size={14} />
      </span>
    );
  }
  if (m.status === 'delivered') {
    return (
      <span className="msg-ticks" title="تم التسليم">
        <CheckCheck size={14} />
      </span>
    );
  }
  return (
    <span className="msg-ticks" title="تم الإرسال">
      <Check size={14} />
    </span>
  );
}
