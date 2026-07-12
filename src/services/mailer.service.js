// services/mailer.service.js
// بنستخدم Resend (https://resend.com) لبعت إيميل دعوة الإيجنت الجديد.
// من غير أي SDK زيادة — بنستخدم fetch المدمج في Node على /emails مباشرة،
// عشان مانضيفش dependency جديدة في package.json.

const env = require('../config/env');
const logger = require('../utils/logger');

function buildInviteEmailHtml(inviteUrl, logoUrl) {
  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="NileChat" width="120" style="display:block;height:auto;margin-bottom:20px" />`
    : `<div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#6C5CE7,#00D2FF);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-family:Arial,sans-serif;font-size:18px;margin-bottom:20px">NC</div>`;

  return `
  <div style="font-family:'DM Sans',Arial,sans-serif;background:#f0f2f5;padding:40px 0">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 10px 30px rgba(0,0,0,0.08)">
      ${logoBlock}
      <h2 style="margin:0 0 8px;color:#1a1a2e;font-family:Arial,sans-serif">تمت دعوتك للانضمام إلى NileChat</h2>
      <p style="color:#6b7280;font-size:14px;line-height:1.7;margin:0 0 24px;font-family:Arial,sans-serif">
        دوس على الزرار تحت عشان تختار كلمة السر الخاصة بيك، وبعدها هتقدر تسجّل دخولك على لوحة التحكم مباشرة.
      </p>
      <!-- زرار "bulletproof" بجدول: أضمن بكتير من <a> عادي إنه يشتغل ويبان صح
           في كل عملاء الإيميل (Outlook / Gmail / Apple Mail...) -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
        <tr>
          <td align="center" bgcolor="#6C5CE7" style="border-radius:10px">
            <a href="${inviteUrl}" target="_blank" rel="noopener noreferrer"
               style="display:inline-block;background:#6C5CE7;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;font-family:Arial,sans-serif">
               تفعيل الحساب وتحديد كلمة السر
            </a>
          </td>
        </tr>
      </table>
      <p style="color:#9ca3af;font-size:12px;margin-top:22px;margin-bottom:4px;font-family:Arial,sans-serif">
        لو الزرار مش شغال، انسخ اللينك ده وحطه في المتصفح يدويًا:
      </p>
      <p style="font-size:12px;word-break:break-all;font-family:Arial,sans-serif">
        <a href="${inviteUrl}" target="_blank" rel="noopener noreferrer" style="color:#6C5CE7">${inviteUrl}</a>
      </p>
      <p style="color:#9ca3af;font-size:12px;margin-top:18px;font-family:Arial,sans-serif">
        الرابط ده صالح لمدة 7 أيام. لو مش متوقع الدعوة دي، تجاهل الإيميل ده ببساطة.
      </p>
    </div>
  </div>`;
}

async function sendInviteEmail({ to, inviteUrl, logoUrl }) {
  if (!env.RESEND_API_KEY) {
    // لو ملحقنا نظبط مفتاح Resend لسه، بنطبع الرابط في اللوج عشان الأدمن يقدر يبعته يدويًا
    logger.warn('⚠️ RESEND_API_KEY مش متظبط في الإعدادات — هبعت رابط الدعوة في اللوج بس من غير إيميل حقيقي.');
    logger.warn(`🔗 رابط دعوة ${to}: ${inviteUrl}`);
    return { sent: false, error: 'RESEND_API_KEY مش متظبط' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject: 'دعوة للانضمام إلى NileChat',
        html: buildInviteEmailHtml(inviteUrl, logoUrl),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('❌ فشل إرسال إيميل الدعوة عن طريق Resend:', errText);
      return { sent: false, error: errText };
    }

    logger.info(`✅ تم إرسال إيميل الدعوة إلى ${to}`);
    return { sent: true };
  } catch (err) {
    logger.error('❌ خطأ في الاتصال بـ Resend:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendInviteEmail };
