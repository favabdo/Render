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
const audioTranscode = require('../utils/audioTranscode');
const logger = require('../utils/logger');

// ============================================================================
// خطة بديلة (Fallback) لمشكلة هيدر api_access_token
// ----------------------------------------------------------------------------
// لو سيرفر شات ووت شغال وراء Nginx بإعداد افتراضي، بيتم مسح أي هيدر فيه
// underscore (زي api_access_token) قبل ما يوصل لشات ووت، فحتى لو التوكن صح
// 100%، شات ووت هيشوف الريكوست من غير أي مصادقة ويرد 401 "لازم تسجل دخول".
// الحل الأصلي (المفضّل لو متاح): إضافة `underscores_in_headers on;` في إعداد
// الدومين في Nginx وعمل reload — ده بيصلح المشكلة نهائيًا بأقل تكلفة.
// الخطة البديلة هنا (من غير ما نلمس السيرفر): استخدام هيدرز تسجيل الدخول
// العادية (access-token / client / uid) بدل api_access_token — دي فيها شرطة
// مش underscore، فـ Nginx الافتراضي مايمسحهاش، وشات ووت بيقبلها بديل كامل
// لنفس الـ API (devise_token_auth session auth بدل الـ personal access token).
// ============================================================================

// كاش بالميموري بس (بيتصفر مع أي ريستارت للسيرفر — ده مقصود، عشان لو حد
// صلح إعداد Nginx بعدين نرجع نجرب api_access_token تاني تلقائيًا من غير ما
// حد يحتاج يعمل حاجة يدويًا).
// 1) sessionAuthPreference: بيتذكر "المزود/الإيجنت ده جرّبنا معاه api_access_token
//    وفشلت، فمن الطلب الجاي روح على طول لهيدرز الجلسة من غير ما تضيّع وقت في
//    محاولة هتفشل أكيد"
// 2) sessionHeadersCache: بيحفظ آخر هيدرز جلسة صالحة (access-token/client/uid)
//    لكل (baseUrl+email) عشان مانسجّلش دخول من الأول في كل رسالة
const sessionAuthPreference = new Map(); // key -> true (يستخدم هيدرز الجلسة)
const sessionHeadersCache = new Map(); // key -> { 'access-token', client, uid }

function sessionCacheKey(baseUrl, email) {
  return `${(baseUrl || '').replace(/\/+$/, '')}::${email || ''}`;
}

// بتسجل دخول بالإيميل/الباسورد وترجع هيدرز الجلسة (access-token/client/uid)
// جاهزة للاستخدام المباشر مع أي endpoint في شات ووت — بديل كامل لـ
// api_access_token، من غير ما نحتاج نمر بصفحة /api/v1/profile أصلاً
async function fetchSessionHeaders(baseUrl, email, password, { forceRefresh = false } = {}) {
  if (!baseUrl || !email || !password) {
    throw new Error('لازم رابط شات ووت والإيميل والباسورد الثلاثة عشان نسجل الدخول');
  }
  const root = baseUrl.replace(/\/+$/, '');
  const cacheKey = sessionCacheKey(root, email);

  if (!forceRefresh && sessionHeadersCache.has(cacheKey)) {
    return sessionHeadersCache.get(cacheKey);
  }

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

  const headers = {
    'access-token': authToken,
    client: signInRes.headers['client'],
    uid: signInRes.headers['uid'],
  };
  sessionHeadersCache.set(cacheKey, headers);
  return headers;
}

// devise_token_auth (اللي شات ووت مبني عليه) بيجدد access-token/client/uid
// في كل ريكوست ناجح بيهم (rotation)، ولو ماخدناش الهيدرز الجديدة دي هنلاقي
// الريكوست اللي بعده فاشل. الدالة دي بتحدّث الكاش بالهيدرز الجديدة من أي رد
// نجح، عشان الريكوست الجاي يشتغل من غير ما نحتاج نسجل دخول تاني كل مرة
function updateSessionHeadersFromResponse(baseUrl, email, responseHeaders) {
  const newAccessToken = responseHeaders?.['access-token'];
  if (!newAccessToken) return; // مفيش تجديد في الرد ده — سيبها زي ما هي
  const cacheKey = sessionCacheKey(baseUrl, email);
  sessionHeadersCache.set(cacheKey, {
    'access-token': newAccessToken,
    client: responseHeaders['client'],
    uid: responseHeaders['uid'],
  });
}

// النقطة المركزية اللي بتقرر: نبعت بـ api_access_token ولا بهيدرز الجلسة؟
// وبتتولى كل التبديل التلقائي بينهم لو واحد فيهم فشل.
//
// المعاملات:
//  - requestFn(headers): دالة بترجع Promise (axios request) وبتاخد الهيدرز
//    اللي المفروض تتبعت بيها (بتضيفها هي على أي هيدرز تانية عندها)
//  - creds: { baseUrl, apiAccessToken, email, password, cacheKey } — كل
//    المعلومات المطلوبة عشان نعرف نجدد أو نبدّل طريقة
//  - getResponseHeaders(result): دالة بترجع هيدرز الرد (axios: res.headers،
//    fetch: Object.fromEntries(res.headers.entries()))
//
// بترجع نتيجة الريكوست الناجح، أو بترمي الخطأ لو كل المحاولات فشلت
async function sendToChatwoot(requestFn, creds, getResponseHeaders) {
  const { baseUrl, apiAccessToken, email, password, cacheKey, refreshToken } = creds;
  const hasCreds = !!(email && password);
  const preferSession = cacheKey && sessionAuthPreference.get(cacheKey);

  // -------- الوضع 1: هيدرز الجلسة مباشرة (لو عارفين خلاص إنها اللي بتشتغل) --------
  if (preferSession && hasCreds) {
    try {
      const sessionHeaders = await fetchSessionHeaders(baseUrl, email, password);
      const result = await requestFn(sessionHeaders);
      updateSessionHeadersFromResponse(baseUrl, email, getResponseHeaders(result));
      return result;
    } catch (err) {
      const status = err.response?.status || err.status;
      if (status === 401 || status === 403) {
        // ممكن الجلسة القديمة انتهت — نجرب تسجيل دخول جديد تمامًا مرة واحدة
        const sessionHeaders = await fetchSessionHeaders(baseUrl, email, password, { forceRefresh: true });
        const result = await requestFn(sessionHeaders);
        updateSessionHeadersFromResponse(baseUrl, email, getResponseHeaders(result));
        return result;
      }
      throw err;
    }
  }

  // -------- الوضع 2: نبدأ بـ api_access_token العادي (الوضع الافتراضي) --------
  let lastErr = null;
  if (apiAccessToken) {
    try {
      return await requestFn({ api_access_token: apiAccessToken });
    } catch (err) {
      lastErr = err;
      const status = err.response?.status || err.status;
      if (!(status === 401 || status === 403)) throw err;

      // التوكن اترفض — قبل ما نفترض إنها مشكلة Nginx، نجرب أول حاجة نجدد
      // التوكن نفسه (ممكن يكون باظ أو اتغيّر فعلاً، مش بالضرورة مشكلة هيدرز)
      if (typeof refreshToken === 'function') {
        try {
          const freshToken = await refreshToken();
          return await requestFn({ api_access_token: freshToken });
        } catch (refreshErr) {
          lastErr = refreshErr;
          const refreshStatus = refreshErr.response?.status || refreshErr.status;
          if (!(refreshStatus === 401 || refreshStatus === 403)) throw refreshErr;
        }
      }

      if (!hasCreds) throw lastErr;
      logger.error(
        `⚠️ هيدر api_access_token اترفض (HTTP ${status}) حتى بعد تجديد التوكن — على الأغلب Nginx بيمسح الهيدر ده لإنه فيه underscore. جارٍ التحويل لهيدرز الجلسة (access-token/client/uid)...`
      );
    }
  } else if (!hasCreds) {
    throw new Error('مفيش لا توكن (api_access_token) ولا إيميل/باسورد لتسجيل الدخول — مفيش طريقة نبعت بيها');
  }

  // -------- الوضع 3: التحويل لهيدرز الجلسة بعد فشل api_access_token --------
  if (!hasCreds) throw lastErr || new Error('توكن api_access_token فشل ومفيش إيميل/باسورد لعمل fallback بهيدرز الجلسة');

  const sessionHeaders = await fetchSessionHeaders(baseUrl, email, password);
  const result = await requestFn(sessionHeaders);
  updateSessionHeadersFromResponse(baseUrl, email, getResponseHeaders(result));
  if (cacheKey) {
    sessionAuthPreference.set(cacheKey, true);
    logger.info(
      `✅ هيدرز الجلسة (access-token/client/uid) اشتغلت بديل api_access_token — هيتم استخدامها مباشرة من دلوقتي لـ (${cacheKey})`
    );
  }
  return result;
}

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

  // بيانات دخول المزود (Provider) — هنستخدمها كخطة احتياطية أخيرة (fallback
  // لهيدرز الجلسة) في أي حالة الإيجنت نفسه معندوش إيميل/باسورد شخصيين
  // يعملهم بيها session، عشان الرسالة تتبعت في كل الأحوال بدل ما تفشل
  // نهائي — حتى لو التوكن الشخصي المخزّن للإيجنت باظ أو Nginx بيمسح الهيدر
  const hasProviderCreds = !!(provider.login_email && provider.login_password);
  const providerFallbackAuth = hasProviderCreds
    ? { email: provider.login_email, password: provider.login_password, cacheKey: `provider:${provider.id}` }
    : {};
  const providerRefresh = hasProviderCreds
    ? async () => {
        const fresh = await loginAndFetchToken(provider.base_url, provider.login_email, provider.login_password);
        await externalProviderRepo.updateProvider(provider.id, { apiAccessToken: fresh });
        return fresh;
      }
    : null;

  if (agentRow?.agent_email && agentRow?.agent_password) {
    const refreshToken = async () => {
      const fresh = await loginAndFetchToken(provider.base_url, agentRow.agent_email, agentRow.agent_password);
      await externalAgentRepo.setAgentPersonalToken(agentRow.id, fresh);
      return fresh;
    };
    const emailAuth = { email: agentRow.agent_email, password: agentRow.agent_password, cacheKey: `agent:${agentRow.id}` };
    if (agentRow.agent_api_access_token) {
      return { token: agentRow.agent_api_access_token, source: `agent-personal (#${agentRow.id})`, refreshToken, ...emailAuth };
    }
    // مفيش توكن مخزن لسه (أول مرة) — نجيبه دلوقتي بالإيميل والباسورد
    try {
      const fresh = await refreshToken();
      return { token: fresh, source: `agent-personal-auto (#${agentRow.id})`, refreshToken, ...emailAuth };
    } catch (err) {
      logger.error(`❌ فشل جلب توكن الإيجنت #${agentRow.id} بالإيميل/الباسورد:`, err.message);
    }
  }

  if (agentRow?.agent_api_access_token) {
    // الإيجنت عنده توكن شخصي بس من غير إيميل/باسورد خاصين بيه (زي إيجنت #12
    // في اللوج) — لو التوكن ده باظ أو اترفض بسبب Nginx، مفيش طريقة نسجل
    // دخول بيها كـ"هو نفسه"، فبنستخدم بيانات دخول المزود كـ fallback أخير
    // عشان الرد يوصل (هيظهر باسم حساب المزود العام مش الإيجنت، بس أحسن من
    // فشل الرسالة تمامًا)
    return {
      token: agentRow.agent_api_access_token,
      source: `agent-personal (#${agentRow.id})`,
      refreshToken: null,
      ...providerFallbackAuth,
    };
  }

  return { token: provider.api_access_token, source: 'provider-default', refreshToken: providerRefresh, ...providerFallbackAuth };
}

// بيجيب قايمة إيجنتس الحساب كلها من شات ووت — مستخدمة في "مزامنة الإيجنتس"
// من واجهة الميرج، عشان الإداري يشوف كل الإيجنتس مرة واحدة من غير ما يستنى
// كل واحد فيهم يبعت رسالة الأول عشان يظهر عندنا
async function fetchAgents(provider) {
  const url = `${provider.base_url.replace(/\/+$/, '')}/api/v1/accounts/${provider.account_id}/agents`;
  const response = await sendToChatwoot(
    (headers) => axios.get(url, { headers, timeout: 15000 }),
    {
      baseUrl: provider.base_url,
      apiAccessToken: provider.api_access_token,
      email: provider.login_email,
      password: provider.login_password,
      cacheKey: `provider:${provider.id}`,
    },
    (res) => res.headers
  );
  return Array.isArray(response.data?.payload) ? response.data.payload : response.data || [];
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

    const response = await sendToChatwoot(
      (headers) => {
        const sendPromise = axios.post(
          url,
          { content: text, message_type: 'outgoing', private: false },
          { headers, timeout: 15000 }
        );
        return timer ? timer.time('http:chatwoot_send_message', sendPromise) : sendPromise;
      },
      {
        baseUrl: externalConversation.provider_base_url,
        apiAccessToken: tokenInfo.token,
        email: tokenInfo.email,
        password: tokenInfo.password,
        cacheKey: tokenInfo.cacheKey,
        refreshToken: tokenInfo.refreshToken,
      },
      (res) => res.headers
    );
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
    let mimeType = response.headers['content-type'] || null;
    let buffer = Buffer.from(response.data);

    // نفس مشكلة رسايل الصوت اللي بتيجي مباشرة من واتساب: صيغة ogg/opus مش
    // شغالة خالص على آيفون. المحادثات هنا بتوصل عن طريق شات ووت (مش مباشرة
    // من واتساب Cloud API)، فده الطريق الفعلي اللي لازم التحويل يحصل فيه —
    // مش downloadIncomingMedia بتاعة whatsapp.service.js اللي أصلاً مش
    // بتتنفذ لو التكامل شغال عن طريق شات ووت
    if (mimeType && mimeType.toLowerCase().startsWith('audio/ogg')) {
      logger.info(`ℹ️ [chatwoot downloadAttachment] استلمنا رسالة صوتية بصيغة "${mimeType}" — بنحاول نحولها لـ mp3...`);
      const mp3Buffer = await audioTranscode.transcodeOggToMp3(buffer);
      if (mp3Buffer) {
        buffer = mp3Buffer;
        mimeType = 'audio/mpeg';
        logger.info(`✅ [chatwoot downloadAttachment] اتحولت لـ mp3 بنجاح (${mp3Buffer.length} بايت)`);
      } else {
        logger.warn('⚠️ فشل تحويل رسالة صوتية واردة من شات ووت لـ mp3 — هتتخزن بصيغتها الأصلية (ogg) وممكن متشتغلش على آيفون');
      }
    }

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

    // fetch لا يرمي استثناء تلقائيًا على 401/403 (عكس axios)، فبنحوّلها هنا
    // لاستثناء بنفس شكل استثناءات axios (err.response.status) عشان
    // sendToChatwoot تقدر تتعامل معاها بنفس المنطق الموحّد لكل الطلبات
    const doUpload = async (headers) => {
      const sendPromise = fetch(url, { method: 'POST', headers, body: form });
      const res = timer ? await timer.time('http:chatwoot_send_media', sendPromise) : await sendPromise;
      if (!res.ok) {
        const err = new Error(`Chatwoot رفض رفع الملف — HTTP ${res.status}`);
        err.response = { status: res.status };
        throw err;
      }
      return res;
    };

    const response = await sendToChatwoot(
      doUpload,
      {
        baseUrl: externalConversation.provider_base_url,
        apiAccessToken: tokenInfo.token,
        email: tokenInfo.email,
        password: tokenInfo.password,
        cacheKey: tokenInfo.cacheKey,
        refreshToken: tokenInfo.refreshToken,
      },
      (res) => Object.fromEntries(res.headers.entries())
    );
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

// ============================================================================
// مزامنة عكسية: نايل شات → شات ووت (Assign / Resolve / Private Note)
// ----------------------------------------------------------------------------
// عكس كل المزامنة التلقائية الموجودة فوق (اللي كلها شات ووت → نايل شات بس).
// الدوال الثلاثة دي بتتنادى من conversation.controller.js بعد ما الإجراء
// يتم فعليًا عندنا، وبتفشل بهدوء (تُسجَّل في اللوج بس) لو المحادثة مش مربوطة
// بمزود خارجي، أو لو الإجراء مش قابل للمزامنة (زي Assign لإيجنت لسه مالوش ميرج)
async function getExternalConversationForSync(nileConversationId) {
  const externalConversation = await externalConversationRepo.findByNileConversationIdWithProvider(nileConversationId);
  if (!externalConversation || !externalConversation.provider_is_active) return null;
  return externalConversation;
}

function buildProviderCreds(externalConversation, tokenInfo) {
  return {
    baseUrl: externalConversation.provider_base_url,
    apiAccessToken: tokenInfo.token,
    email: tokenInfo.email,
    password: tokenInfo.password,
    cacheKey: tokenInfo.cacheKey,
    refreshToken: tokenInfo.refreshToken,
  };
}

// لو عملنا Assign من نايل شات لإيجنت متعمله ميرج مع إيجنت شات ووت، بنبعت
// نفس التعيين لشات ووت (POST .../assignments)، عشان يظهر هناك إنه اتعمله
// اساين برضه. لو الإيجنت المستهدف لسه مالوش ميرج، مفيش حاجة نبعتها (مفيش
// إيجنت شات ووت نعينه له أصلاً)
// actingNileUserId: مين اللي عمل الـ Assign فعليًا من نايل شات — بنستخدم
// توكنه الشخصي لو هو نفسه متعمله ميرج (نفس آلية resolveSendingToken الموثوقة
// المستخدمة في إرسال الردود العادية)، بدل ما نروح على طول لتوكن الاتصال العام
// بتاع الـ Provider (اللي ممكن يكون باظ/منتهي من غير ما حد ينتبه، لإنه نادرًا
// ما بيتستخدم لوحده)
async function assignConversationInChatwoot(nileConversationId, targetNileUserId, actingNileUserId = null) {
  const externalConversation = await getExternalConversationForSync(nileConversationId);
  if (!externalConversation) return;

  const agentRow = await externalAgentRepo.findByNileUserId(externalConversation.provider_id, targetNileUserId);
  if (!agentRow) return; // الإيجنت ده مش متعمله ميرج — مفيش إيجنت شات ووت نعينه له

  const url = `${externalConversation.provider_base_url.replace(/\/+$/, '')}/api/v1/accounts/${externalConversation.provider_account_id}/conversations/${externalConversation.external_conversation_id}/assignments`;

  const tokenInfo = await resolveSendingToken(
    {
      id: externalConversation.provider_id,
      base_url: externalConversation.provider_base_url,
      api_access_token: externalConversation.provider_api_access_token,
      login_email: externalConversation.provider_login_email,
      login_password: externalConversation.provider_login_password,
    },
    actingNileUserId
  );

  await sendToChatwoot(
    (headers) => axios.post(url, { assignee_id: agentRow.external_agent_id }, { headers, timeout: 15000 }),
    buildProviderCreds(externalConversation, tokenInfo),
    (res) => res.headers
  );
}

// لو عملنا Resolve من نايل شات، بنقفل نفس المحادثة في شات ووت (toggle_status)
async function resolveConversationInChatwoot(nileConversationId, actingNileUserId = null) {
  const externalConversation = await getExternalConversationForSync(nileConversationId);
  if (!externalConversation) return;

  const url = `${externalConversation.provider_base_url.replace(/\/+$/, '')}/api/v1/accounts/${externalConversation.provider_account_id}/conversations/${externalConversation.external_conversation_id}/toggle_status`;

  const tokenInfo = await resolveSendingToken(
    {
      id: externalConversation.provider_id,
      base_url: externalConversation.provider_base_url,
      api_access_token: externalConversation.provider_api_access_token,
      login_email: externalConversation.provider_login_email,
      login_password: externalConversation.provider_login_password,
    },
    actingNileUserId
  );

  await sendToChatwoot(
    (headers) => axios.post(url, { status: 'resolved' }, { headers, timeout: 15000 }),
    buildProviderCreds(externalConversation, tokenInfo),
    (res) => res.headers
  );
}

// لو الإيجنت كتب ملاحظة خاصة من نايل شات، بنبعتها لشات ووت كملاحظة خاصة
// برضه (private=true) عشان أي حد شغال من شات ووت مباشرة يشوفها. بترجع
// { externalConversationRowId, providerId, chatwootMessageId } لو نجحت (عشان
// الكنترولر يسجلها في External_Messages_byA ويمنع تكرارها لما الـ webhook
// يرجعلنا نفس الرسالة تاني)، أو null لو المحادثة مش مربوطة بمزود خارجي
async function sendPrivateNoteToChatwoot(nileConversationId, text, senderName, actingNileUserId = null) {
  const externalConversation = await getExternalConversationForSync(nileConversationId);
  if (!externalConversation) return null;

  const url = `${externalConversation.provider_base_url.replace(/\/+$/, '')}/api/v1/accounts/${externalConversation.provider_account_id}/conversations/${externalConversation.external_conversation_id}/messages`;

  const tokenInfo = await resolveSendingToken(
    {
      id: externalConversation.provider_id,
      base_url: externalConversation.provider_base_url,
      api_access_token: externalConversation.provider_api_access_token,
      login_email: externalConversation.provider_login_email,
      login_password: externalConversation.provider_login_password,
    },
    actingNileUserId
  );

  const content = senderName ? `${senderName}: ${text}` : text;

  const response = await sendToChatwoot(
    (headers) => axios.post(url, { content, message_type: 'outgoing', private: true }, { headers, timeout: 15000 }),
    buildProviderCreds(externalConversation, tokenInfo),
    (res) => res.headers
  );

  return {
    externalConversationRowId: externalConversation.id,
    providerId: externalConversation.provider_id,
    chatwootMessageId: response.data?.id || null,
  };
}

module.exports = {
  createOutgoingMessage,
  deliverOutgoingMessage,
  downloadAttachment,
  createOutgoingMediaMessage,
  deliverOutgoingMediaMessage,
  fetchAgents,
  loginAndFetchToken,
  assignConversationInChatwoot,
  resolveConversationInChatwoot,
  sendPrivateNoteToChatwoot,
};
