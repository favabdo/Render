// services/chatwoot.service.js
// كل الاتصال الصادر (Outgoing) بشات ووت بيمر من هنا بس. نفس فلسفة
// whatsapp.service.js بالظبط (مرحلتين: تسجيل فوري في الداتابيز + إرسال فعلي في
// الخلفية)، بس هنا بنكلم Chatwoot API بدل ما نكلم ميتا مباشرة — لإن شات ووت هو
// اللي بيكلم ميتا نيابة عننا للمحادثات الجاية من عنده

const axios = require('axios');
const conversationRepo = require('../repositories/conversation.repo');
const externalConversationRepo = require('../repositories/externalConversation.repo');
const externalMessageRepo = require('../repositories/externalMessage.repo');
const externalAgentRepo = require('../repositories/externalAgent.repo');
const externalProviderRepo = require('../repositories/externalProvider.repo');
const mediaStorage = require('../utils/mediaStorage');
const logger = require('../utils/logger');

// بتسجل دخول شات ووت بالإيميل والباسورد (نفس صفحة تسجيل الدخول العادية)
// وترجع توكن الـ API الدائم بتاع صاحب الحساب ده (access_token في صفحة
// البروفايل — بالظبط نفس التوكن اللي كان المفروض الإداري/الإيجنت ينسخه يدويًا
// من Profile Settings). بنستخدمها بديل النسخ اليدوي للتوكن، وكمان لتجديده
// تلقائيًا لو باظ أو اتغيّر من غير ما حد يعرف
async function loginAndFetchToken(baseUrl, email, password) {
  if (!baseUrl || !email || !password) {
    throw new Error('لازم رابط شات ووت والإيميل والباسورد الثلاثة عشان نجيب التوكن');
  }
  const root = baseUrl.replace(/\/+$/, '');

  let signInRes;
  try {
    signInRes = await axios.post(
      `${root}/auth/sign_in`,
      { email, password },
      { timeout: 15000, validateStatus: () => true }
    );
  } catch (err) {
    throw new Error(`فشل الاتصال بشات ووت لتسجيل الدخول (${root}): ${err.message}`);
  }

  const authToken = signInRes.headers?.['access-token'];
  if (signInRes.status !== 200 || !authToken) {
    throw new Error(
      signInRes.data?.message || signInRes.data?.errors?.[0] || 'فشل تسجيل الدخول بالإيميل والباسورد — تأكد إنهم صح'
    );
  }

  const sessionHeaders = {
    'access-token': authToken,
    client: signInRes.headers['client'],
    uid: signInRes.headers['uid'],
  };

  const profileRes = await axios.get(`${root}/api/v1/profile`, {
    headers: sessionHeaders,
    timeout: 15000,
  });

  const permanentToken = profileRes.data?.access_token;
  if (!permanentToken) {
    throw new Error('اتسجل الدخول بنجاح بس مفيش access_token في بيانات البروفايل — راجع نسخة شات ووت');
  }
  return permanentToken;
}

// بيدوّر على توكن شخصي بتاع الإيجنت اللي بعت الرد ده (لو نايل شات عارف مين
// بعت، ولو الإيجنت ده اتعمله ميرج بتوكن شخصي أو بإيميل/باسورد). لو مفيش،
// بيرجع توكن الاتصال العام بتاع الـ Provider بدل ما يفشل — عشان الرد يتبعت
// في كل الأحوال، بس الاسم اللي هيظهر في شات ووت هيبقى صاحب التوكن العام مش
// الإيجنت الحقيقي.
// كل نتيجة بترجع معاها refreshToken(): دالة لو التوكن الحالي باظ (401)،
// ممكن نستخدمها عشان نسجل دخول بالإيميل/الباسورد المخزنين ونجيب توكن جديد
// ونحفظه، بدل ما نسيب الرسالة تفشل نهائي
async function resolveSendingToken(provider, senderId) {
  let agentRow = null;
  if (senderId) {
    try {
      agentRow = await externalAgentRepo.findByNileUserId(provider.id, senderId);
    } catch (err) {
      logger.error('❌ فشل تحديد الإيجنت الشخصي، هيتبعت بتوكن الاتصال العام:', err.message);
    }
  }

  if (agentRow?.agent_email && agentRow?.agent_password) {
    const refreshToken = async () => {
      const fresh = await loginAndFetchToken(provider.base_url, agentRow.agent_email, agentRow.agent_password);
      await externalAgentRepo.setAgentPersonalToken(agentRow.id, fresh);
      return fresh;
    };
    if (agentRow.agent_api_access_token) {
      return { token: agentRow.agent_api_access_token, source: `agent-personal (#${agentRow.id})`, refreshToken };
    }
    // مفيش توكن مخزن لسه (أول مرة) — نجيبه دلوقتي بالإيميل والباسورد
    try {
      const fresh = await refreshToken();
      return { token: fresh, source: `agent-personal-auto (#${agentRow.id})`, refreshToken };
    } catch (err) {
      logger.error(`❌ فشل جلب توكن الإيجنت #${agentRow.id} بالإيميل/الباسورد:`, err.message);
    }
  }

  if (agentRow?.agent_api_access_token) {
    return { token: agentRow.agent_api_access_token, source: `agent-personal (#${agentRow.id})`, refreshToken: null };
  }

  const providerRefresh =
    provider.login_email && provider.login_password
      ? async () => {
          const fresh = await loginAndFetchToken(provider.base_url, provider.login_email, provider.login_password);
          await externalProviderRepo.updateProvider(provider.id, { apiAccessToken: fresh });
          return fresh;
        }
      : null;

  return { token: provider.api_access_token, source: 'provider-default', refreshToken: providerRefresh };
}

// بيجيب قايمة إيجنتس الحساب كلها من شات ووت — مستخدمة في "مزامنة الإيجنتس"
// من واجهة الميرج، عشان الإداري يشوف كل الإيجنتس مرة واحدة من غير ما يستنى
// كل واحد فيهم يبعت رسالة الأول عشان يظهر عندنا
async function fetchAgents(provider) {
  const url = `${provider.base_url.replace(/\/+$/, '')}/api/v1/accounts/${provider.account_id}/agents`;
  const response = await axios.get(url, {
    headers: { api_access_token: provider.api_access_token },
    timeout: 15000,
  });
  return Array.isArray(response.data?.payload) ? response.data.payload : response.data || [];
}

// بتحاول تبعت الطلب بالتوكن الحالي، ولو شات ووت رفضه بـ 401/403 (توكن باظ
// أو اتغيّر) وعندنا طريقة نجدده بيها (تسجيل دخول بالإيميل/الباسورد المخزنين
// من resolveSendingToken)، بتجدده تلقائيًا وتحاول تبعت تاني مرة واحدة بس —
// عشان الرد يوصل من غير ما حد يحتاج يدخل يحدّث التوكن يدويًا
async function sendWithAutoRefresh(sendFn, tokenInfo) {
  try {
    return await sendFn(tokenInfo.token);
  } catch (err) {
    const status = err.response?.status;
    if ((status === 401 || status === 403) && tokenInfo.refreshToken) {
      logger.error(
        `⚠️ توكن شات ووت (${tokenInfo.source}) مرفوض (HTTP ${status}) — جارٍ تجديده تلقائيًا بالإيميل/الباسورد المخزنين...`
      );
      const freshToken = await tokenInfo.refreshToken();
      tokenInfo.token = freshToken;
      tokenInfo.source = `${tokenInfo.source} (متجدد تلقائيًا)`;
      return await sendFn(freshToken);
    }
    throw err;
  }
}

// مرحلة 1: تسجيل الرسالة فورًا في جدول الرسايل العادي (بتظهر للإيجنت على طول
// بحالة 'sending')، بالظبط زي whatsappService.createOutgoingMessage
async function createOutgoingMessage(toNumber, text, conversationId, sender) {
  return conversationRepo.saveMessage({
    waMessageId: null,
    conversationId,
    direction: 'out',
    fromNumber: null,
    toNumber,
    messageType: 'text',
    messageText: text,
    status: 'sending',
    sentByUserId: sender?.id || null,
    sentByName: sender?.name || null,
  });
}

// مرحلة 2: بتاخد الرسالة اللي اتسجلت في المرحلة اللي فوق وتحاول تبعتها فعليًا
// لـ Chatwoot API. لو نجحت -> بتقفل الرسالة 'sent' وتسجل نايل مسدج آي دي في
// External_Messages_byA (idempotency: لو الـ webhook بتاع message_created رجع
// لينا بنفس الرسالة دي تاني، هنلاقيها مسجلة خلاص ونتجاهلها بدل ما نكررها)
async function deliverOutgoingMessage(savedMessage, { conversationId, text, sender }, onFinalized, timer) {
  let finalRow;
  let url;
  let tokenInfo;
  try {
    const externalConversation = await externalConversationRepo.findByNileConversationIdWithProvider(conversationId);
    if (!externalConversation || !externalConversation.provider_is_active) {
      throw new Error('المحادثة دي مش مربوطة بمزود خارجي نشط (External_Conversation_byA)');
    }

    url = `${externalConversation.provider_base_url.replace(/\/+$/, '')}/api/v1/accounts/${externalConversation.provider_account_id}/conversations/${externalConversation.external_conversation_id}/messages`;
    tokenInfo = await resolveSendingToken(
      {
        id: externalConversation.provider_id,
        base_url: externalConversation.provider_base_url,
        api_access_token: externalConversation.provider_api_access_token,
        login_email: externalConversation.provider_login_email,
        login_password: externalConversation.provider_login_password,
      },
      sender?.id
    );

    const response = await sendWithAutoRefresh((token) => {
      const sendPromise = axios.post(
        url,
        { content: text, message_type: 'outgoing', private: false },
        { headers: { api_access_token: token }, timeout: 15000 }
      );
      return timer ? timer.time('http:chatwoot_send_message', sendPromise) : sendPromise;
    }, tokenInfo);
    const chatwootMessageId = response.data?.id;

    finalRow = await conversationRepo.finalizeOutgoingMessage(savedMessage.id, {
      waMessageId: null,
      status: 'sent',
    });

    if (chatwootMessageId) {
      await externalMessageRepo
        .createExternalMessage(externalConversation.provider_id, chatwootMessageId, {
          externalConversationRowId: externalConversation.id,
          nileMessageId: savedMessage.id,
          direction: 'out',
          messageType: 'text',
          rawJson: JSON.stringify(response.data || {}),
        })
        .catch((err) => {
          // لو فشل التسجيل هنا مش مشكلة قاتلة — الرسالة اتبعتت فعلاً وظهرت
          // للعميل، بس لو الـ webhook رجع بعدها هيتسجل كرسالة واردة تانية غلط.
          // بنسجل الخطأ بس عشان نراجعه، من غير ما نفشّل الرد نفسه
          logger.error('❌ فشل تسجيل External_Messages_byA بعد الإرسال الناجح:', err.message);
        });
    }
  } catch (err) {
    logger.error(
      `❌ فشل إرسال رسالة لشات ووت — URL: ${url || 'غير معروف (فشل قبل تكوين الرابط)'} — HTTP ${err.response?.status || 'N/A'} — التوكن المستخدم: ${tokenInfo?.source || 'غير معروف'} (آخر 4 حروف: ...${(tokenInfo?.token || '').slice(-4)}):`,
      typeof err.response?.data === 'string' ? err.response.data.slice(0, 300) : err.response?.data || err.message
    );
    finalRow = await conversationRepo.finalizeOutgoingMessage(savedMessage.id, {
      waMessageId: null,
      status: 'failed',
    });
  }

  if (onFinalized) await onFinalized(finalRow);
  return finalRow;
}

// بتنزّل مرفق وارد من شات ووت (رابطه بييجي جاهز في الـ payload نفسه — data_url
// — عكس ميتا اللي بتحتاج نداءين منفصلين لجيب الرابط الأول) وتخزنه محليًا زي
// أي وسائط واردة تانية، وترجع رابط عام (public URL) نحطه في media_url
async function downloadAttachment(dataUrl) {
  if (!dataUrl) return null;
  try {
    const response = await axios.get(dataUrl, {
      responseType: 'arraybuffer',
      maxContentLength: 50 * 1024 * 1024,
      timeout: 30000,
    });
    const mimeType = response.headers['content-type'] || null;
    const buffer = Buffer.from(response.data);
    const { publicUrl } = mediaStorage.saveBuffer(buffer, { folder: 'incoming', mimeType });
    return { url: publicUrl, mimeType };
  } catch (err) {
    logger.error('❌ فشل تنزيل مرفق وارد من شات ووت:', err.message);
    return null;
  }
}

// مرحلة 1 (وسائط صادرة): تسجيل فوري بنفس شكل whatsappService.createOutgoingMediaMessage
async function createOutgoingMediaMessage(toNumber, { messageType, mediaUrl, mimeType, fileName, caption }, conversationId, sender) {
  return conversationRepo.saveMessage({
    waMessageId: null,
    conversationId,
    direction: 'out',
    fromNumber: null,
    toNumber,
    messageType,
    messageText: caption || null,
    mediaUrl,
    mediaMime: mimeType || null,
    mediaFileName: fileName || null,
    status: 'sending',
    sentByUserId: sender?.id || null,
    sentByName: sender?.name || null,
  });
}

// مرحلة 2 (وسائط صادرة): رفع الملف فعليًا لـ Chatwoot عن طريق multipart/form-data.
// بنستخدم fetch/FormData/Blob المدمجين في Node (>=18) بدل axios هنا تحديدًا،
// لإن الإرسال Multipart لشات ووت أبسط وأضمن بيهم من غير أي مكتبة إضافية
async function deliverOutgoingMediaMessage(savedMessage, { conversationId, buffer, mimeType, fileName, caption, sender }, onFinalized, timer) {
  let finalRow;
  let url;
  try {
    const externalConversation = await externalConversationRepo.findByNileConversationIdWithProvider(conversationId);
    if (!externalConversation || !externalConversation.provider_is_active) {
      throw new Error('المحادثة دي مش مربوطة بمزود خارجي نشط (External_Conversation_byA)');
    }

    url = `${externalConversation.provider_base_url.replace(/\/+$/, '')}/api/v1/accounts/${externalConversation.provider_account_id}/conversations/${externalConversation.external_conversation_id}/messages`;

    const form = new FormData();
    form.append('message_type', 'outgoing');
    form.append('private', 'false');
    if (caption) form.append('content', caption);
    form.append('attachments[]', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), fileName || 'file');

    const tokenInfo = await resolveSendingToken(
      {
        id: externalConversation.provider_id,
        base_url: externalConversation.provider_base_url,
        api_access_token: externalConversation.provider_api_access_token,
        login_email: externalConversation.provider_login_email,
        login_password: externalConversation.provider_login_password,
      },
      sender?.id
    );

    const doUpload = (token) => {
      const sendPromise = fetch(url, {
        method: 'POST',
        headers: { api_access_token: token },
        body: form,
      });
      return timer ? timer.time('http:chatwoot_send_media', sendPromise) : sendPromise;
    };

    let response = await doUpload(tokenInfo.token);
    if ((response.status === 401 || response.status === 403) && tokenInfo.refreshToken) {
      logger.error(
        `⚠️ توكن شات ووت (${tokenInfo.source}) مرفوض (HTTP ${response.status}) — جارٍ تجديده تلقائيًا بالإيميل/الباسورد المخزنين...`
      );
      const freshToken = await tokenInfo.refreshToken();
      tokenInfo.token = freshToken;
      tokenInfo.source = `${tokenInfo.source} (متجدد تلقائيًا)`;
      response = await doUpload(freshToken);
    }
    if (!response.ok) {
      throw new Error(`Chatwoot رفض رفع الملف — HTTP ${response.status} — التوكن المستخدم: ${tokenInfo.source}`);
    }
    const data = await response.json();
    const chatwootMessageId = data?.id;

    finalRow = await conversationRepo.finalizeOutgoingMessage(savedMessage.id, { waMessageId: null, status: 'sent' });

    if (chatwootMessageId) {
      await externalMessageRepo
        .createExternalMessage(externalConversation.provider_id, chatwootMessageId, {
          externalConversationRowId: externalConversation.id,
          nileMessageId: savedMessage.id,
          direction: 'out',
          messageType: 'media',
          rawJson: JSON.stringify(data || {}),
        })
        .catch((err) => logger.error('❌ فشل تسجيل External_Messages_byA بعد رفع الملف بنجاح:', err.message));
    }
  } catch (err) {
    logger.error(`❌ فشل إرسال وسائط لشات ووت — URL: ${url || 'غير معروف'}:`, err.message);
    finalRow = await conversationRepo.finalizeOutgoingMessage(savedMessage.id, { waMessageId: null, status: 'failed' });
  }

  if (onFinalized) await onFinalized(finalRow);
  return finalRow;
}

module.exports = {
  createOutgoingMessage,
  deliverOutgoingMessage,
  downloadAttachment,
  createOutgoingMediaMessage,
  deliverOutgoingMediaMessage,
  fetchAgents,
  loginAndFetchToken,
};
