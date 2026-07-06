const axios = require('axios');

const GRAPH_VERSION = 'v20.0';

// بيسيب بس الأرقام (بيشيل +، المسافات، الشرط، إلخ) عشان نقارن رقمين بغض النظر عن شكل التنسيق
function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * تحقق حقيقي من إن التلاتة بيانات دي بتاعة بعض فعلاً (من غير Business Account ID):
 * - بنسأل ميتا مباشرة عن الـ phoneNumberId ده بالـ accessToken اللي المستخدم كتبه
 *   (لو الـ ID غلط أو التوكن مالوش صلاحية عليه، ميتا هترفض الطلب من الأول)
 * - بعدين بنقارن الرقم الحقيقي اللي رجع من ميتا (display_phone_number) بالرقم اللي المستخدم كتبه
 *
 * لو أي شرط من دول فشل، بيرمي Error برسالة واضحة بالعربي.
 * لو كله تمام، بيرجع { verifiedName, displayPhoneNumber } من بيانات ميتا نفسها (مش من كلام المستخدم).
 */
async function verifyWhatsappCredentials({ phoneNumber, phoneNumberId, accessToken }) {
  if (!phoneNumber || !phoneNumberId || !accessToken) {
    const err = new Error('لازم تدخل الرقم و Phone Number ID و API key التلاتة مع بعض');
    err.code = 'MISSING_FIELDS';
    throw err;
  }

  let phoneData;
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}`;
    const response = await axios.get(url, {
      params: { fields: 'id,display_phone_number,verified_name' },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    phoneData = response.data;
  } catch (err) {
    const metaError = err.response?.data?.error?.message;
    const e = new Error(
      metaError ||
        'مقدرناش نوصل لبيانات الـ Phone Number ID ده — تأكد إن الـ ID صح وإن الـ API key عنده صلاحية عليه'
    );
    e.code = 'META_REQUEST_FAILED';
    throw e;
  }

  if (!phoneData || !phoneData.display_phone_number) {
    const e = new Error('الـ Phone Number ID ده مش موجود عند ميتا أو التوكن مالوش صلاحية عليه');
    e.code = 'PHONE_NOT_FOUND';
    throw e;
  }

  const typedDigits = normalizeDigits(phoneNumber);
  const realDigits = normalizeDigits(phoneData.display_phone_number);
  if (typedDigits !== realDigits) {
    const e = new Error(
      `الرقم اللي كتبته مش هو الرقم المسجل فعليًا على الـ Phone Number ID ده (الرقم الحقيقي: ${phoneData.display_phone_number})`
    );
    e.code = 'PHONE_MISMATCH';
    throw e;
  }

  return {
    verifiedName: phoneData.verified_name || null,
    displayPhoneNumber: phoneData.display_phone_number || null,
  };
}

module.exports = { verifyWhatsappCredentials, normalizeDigits };
