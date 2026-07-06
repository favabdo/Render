# NileChat – WhatsApp Cloud API → SQL Server

المشروع ده بيستقبل رسائل WhatsApp Cloud API عن طريق webhook، ويحفظها (وارد وصادر وحالات التسليم) في قاعدة بيانات **SQL Server** داخل جدول اسمه **NileChat_byA** (بيتنشئ تلقائيًا أول مرة لو مش موجود، ولو موجود بيستخدمه عادي من غير ما يلمس بياناته).

## 1) تثبيت المكتبات

```bash
npm install
```

## 2) الإعدادات

اعمل نسخة من `.env.example` باسم `.env` واملأ القيم:

```
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=

DB_NAME=ChatwootReports
DB_PASSWORD=passwordniletechno
DB_PORT=1433
DB_SERVER=162.55.67.11
DB_TDS_VERSION=4.2
DB_USER=elharaman

DB_TABLE_NAME=NileChat_byA

DASHBOARD_ORIGIN=https://support.niletechno.com
PORT=3000
```

> ملحوظة: لو السيرفر عنده بورت بديل (DB_PORT2=1434) واتقفل الأول، غيّر قيمة DB_PORT بس.

## 3) تشغيل المشروع

```bash
npm start
```

أول ما السيرفر يشتغل هيعمل اتصال بقاعدة البيانات ويتأكد إن جدول `NileChat_byA` موجود، ولو مش موجود هينشئه تلقائيًا بالأعمدة دي:

| العمود | الوصف |
|---|---|
| id | رقم تسلسلي (Primary Key) |
| wa_message_id | معرّف الرسالة من واتساب |
| direction | in (وارد) / out (صادر) / status (تحديث حالة) |
| from_number / to_number | أرقام المرسل والمستقبل |
| contact_name | اسم العميل (لو متاح) |
| message_type | text / image / audio / document / ... |
| message_text | نص الرسالة |
| media_url | معرّف/رابط الميديا لو الرسالة وسائط |
| status | sent / delivered / read / failed |
| raw_payload | الـ JSON الخام بالكامل (للمراجعة لاحقًا) |
| created_at | تاريخ ووقت الحفظ |

## 4) ربط الـ Webhook مع Meta

في إعدادات WhatsApp في Meta App، حط رابط الـ webhook بتاعك:
```
https://your-domain.com/webhook
```
واستخدم نفس القيمة اللي حطيتها في `WHATSAPP_VERIFY_TOKEN`.

## 5) لوحة التحكم (الدردشة اللايف زي Chatwoot)

المشروع فيه لوحة تحكم مدمجة (`/`) بتتيح لأي عدد موظفين إنهم:
- يشوفوا كل المحادثات لحظة بلحظة (Socket.IO) من غير ما يعملوا refresh
- يستلموا (Assign) أي محادثة لنفسهم
- يردّوا على العميل من جوه الموقع مباشرة

### إضافة أول موظف (Agent)

السيرفر بينشئ جدول `NileChat_Agents` تلقائيًا، لكن لازم تضيف الموظفين بنفسك بالأمر ده (مرة واحدة لكل موظف):

```bash
node scripts/seedAgent.js "اسم الموظف" "email@example.com" "password123"
```

لو شغال على Fly.io، نفّذه جوه الماكينة:
```bash
fly ssh console -C "node scripts/seedAgent.js 'اسم الموظف' 'email@example.com' 'password123'"
```

بعدها افتح رابط الموقع بتاعك في المتصفح (`https://your-app.fly.dev`) وسجّل دخول بنفس الإيميل وكلمة المرور.

### إزاي شغالة

- أي رسالة واتساب جديدة بتوصل على الـ webhook → بتتربط بمحادثة (Conversation) حسب رقم العميل → بتتسجل في `NileChat_byA` → بتتبعت فورًا realtime لكل الموظفين المتصلين بالموقع.
- لما موظف يدوس "استلام المحادثة"، بتتسجل عنده وتتحدث حالتها لـ assigned.
- الرد من الموقع بيعدي على نفس WhatsApp Cloud API وبيتسجل تلقائيًا كـ "out" بنفس المحادثة.

## 6) إرسال رسالة من API مباشرة (اختياري، من غير الموقع)


```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{"to": "201xxxxxxxxx", "text": "أهلاً بيك!"}'
```

