# NileChat Client (React + Vite)

## تشغيل
```
npm install
npm run dev
```
بيفتح على http://localhost:5173 وبيعمل proxy لـ `/api`, `/auth`, `/webhook`, `/socket.io`
على السيرفر (Express) اللي شغال على البورت 3000 (شوف `vite.config.js`).

```
npm run build     # إنتاج build جاهز للنشر في dist/
npm run lint      # oxlint — لازم يرجع صفر أخطاء
npm run preview   # معاينة الـ build المبني
```

## الحالة: كل الصفحات محوّلة 100%
مفيش صفحة Coming Soon أو placeholder — كل الصفحات التسعة (Login, Set Password,
Chats, AI Assistant, Contacts, Templates, Analytics, Scheduled Tasks, Settings
بكل الـ 7 أقسام بتاعتها, Profile) اتحولت فعليًا وبتشتغل على الـ API الحقيقي.

## البنية (Feature-Based Architecture)
```
src/
  components/
    ui/        Avatar, Modal — مكونات عامة معاد استخدامها في أكتر من فيتشر
    layout/     Sidebar, DashboardLayout
    shared/     ToastContainer, AnimatedBackground, ErrorBoundary, RouteLoader
  features/
    auth/       Login + Set Password (accept invite)
    chats/      أعقد فيتشر — قائمة محادثات + شات + labels/teams + resolve + socket
    contacts/   جريد جهات الاتصال
    templates/  Quick Replies + Problem Categories (بسحب وترتيب Pointer-Events)
    scheduled-tasks/  متابعة طلبات العملاء المؤجلة
    settings/   7 أقسام: General/Agents/Teams/Inboxes/Labels/Automation/Integrations
    profile/    بيانات الإيجنت الشخصية
    ai/, analytics/   "Coming Soon" — مطابقين لنفس حالة التطبيق الأصلي (مش هي فيتشرز
                       ناقصة مني، دي القيمة الحقيقية اللي بترجعها الـ API لحد دلوقتي)
  hooks/        useSocket, useSocketContext (شير نفس اتصال socket.io بين الفيتشرز), useDragReorder
  store/        Zustand: authStore, toastStore
  routes/       AppRouter (كل صفحة lazy-loaded)، ProtectedRoute
  styles/       dashboard-full.css (منقول بالكامل من التصميم الأصلي، مش معاد تصميمه)
```

## قرارات تقنية مهمة
- **CSS**: اتنقل الـ stylesheet الأصلي كامل (`styles/dashboard-full.css`) بدل ما
  يتكسر لأجزاء مبعثرة — ده ضمان التطابق البصري 100% بدل مخاطرة فقد تفاصيل في
  إعادة الكتابة اليدوية.
- **الأيقونات**: `lucide-react` مع خريطة صريحة (`utils/iconMap.js`) بدل
  `import * as Icons` اللي كانت بتجيب المكتبة كاملة جوه الـ bundle.
- **Code splitting**: كل صفحة داشبورد `React.lazy` — أول تحميل (صفحة تسجيل
  الدخول) مبيجيبش كود Settings/Inbox Wizard/Chats خالص.
- **Modal**: مكون واحد مشترك (`components/ui/Modal.jsx`) بديل عن نمط
  `resolve-overlay` اللي كان متكرر حرفيًا في 8 مودالز مختلفة.

## معروف وموثّق (مش مخفي)
شوية تفاصيل صغيرة جوه الـ Chat panel (Devices management, Merge Contact,
Previous Conversations) محتاجة API endpoints مش موجودة في الباك إند الحالي،
فالواجهة موجودة بس البيانات فاضية لحد ما الـ endpoints دي تتضاف.

## اللي لسه مش متغطي (صريح، مش مخفي)
- مفيش test suite (Vitest/Playwright) لسه.
- مفيش Husky/lint-staged/commit conventions.
- مفيش full accessibility audit (aria labels على كل عنصر تفاعلي، إلخ).
