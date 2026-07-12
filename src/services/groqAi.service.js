// services/groqAi.service.js
// خدمة "Generate Reply" — بتاخد سياق المحادثة كامل زي ما هو (رسائل العميل والإيجنت
// بترتيبها الطبيعي) وتبعته لـ Groq (https://groq.com) عشان يرجع اقتراح رد جاهز
// يساعد الإيجنت يرد بسرعة، بدل ما يكتب من الصفر في كل مرة.
//
// مهم: لو GROQ_API_KEY مش متحطوط في الـ .env، الدالة بترجع null فورًا من غير ما
// تحاول تعمل أي طلب شبكة — عشان الزرار في الواجهة يفضل شغال بس من غير ما يعمل
// حاجة، ومن غير ما يظهر أي Error للإيجنت.

const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// بنحول رسائل المحادثة (زي ما هي مخزنة عندنا) لصيغة chat messages اللي الموديل فاهمها:
// - رسايل العميل (in)   -> role: user
// - ردود الإيجنت (out)  -> role: assistant
// - الملاحظات الخاصة والرسايل النظامية (note/system) مش بتتبعت — مش جزء من الحوار
//   الفعلي مع العميل، وممكن تلخبط الموديل لو اتبعتت كأنها كلام حقيقي في المحادثة
function buildChatHistory(messages = []) {
  return messages
    .filter((m) => m && (m.direction === 'in' || m.direction === 'out') && m.message_text)
    .map((m) => ({
      role: m.direction === 'out' ? 'assistant' : 'user',
      content: String(m.message_text).slice(0, 2000), // حماية بسيطة من رسايل طويلة جدًا
    }));
}

const SYSTEM_PROMPT = `انت مساعد بيساعد موظف خدمة عملاء يرد على عميل في محادثة واتساب.
هتاخد كل المحادثة اللي حصلت بين العميل والموظف زي ما هي بالظبط، وهتقترح رد واحد بس
مناسب يكمل بيه الموظف الرد على آخر رسالة من العميل.

قواعد مهمة:
- رد بنفس اللغة واللهجة اللي العميل بيتكلم بيها في المحادثة (لو عامية مصري رد بعامية مصري، لو إنجليزي رد بإنجليزي... إلخ).
- الرد لازم يكون قصير ومباشر ومناسب لسياق المحادثة، مش عمومي أو عشوائي.
- ماتضيفش أي مقدمات زي "تفضل رد مقترح" أو علامات تنصيص — ابعت نص الرد بس زي ما هيتبعت للعميل حرفيًا.
- لو المحادثة مفيهاش رسايل كفاية تفهم منها السياق، اقترح رد ترحيبي عام مناسب.`;

/**
 * بيرجع نص رد مقترح، أو null لو الـ API key مش متظبط أصلاً (يعني الميزة معطلة).
 * بيرمي Error فعلي بس لو الـ key موجود لكن الطلب لـ Groq فشل (شبكة/رفض من عندهم...).
 */
async function generateReplySuggestion(messages) {
  if (!env.GROQ_API_KEY) return null;

  const chatHistory = buildChatHistory(messages);

  try {
    const response = await axios.post(
      GROQ_URL,
      {
        model: env.GROQ_MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...chatHistory],
        temperature: 0.6,
        max_tokens: 300,
      },
      {
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('Groq رجع رد فاضي');
    return reply;
  } catch (err) {
    logger.error('[groqAi] فشل توليد الرد المقترح:', err.response?.data || err.message);
    throw new Error('تعذر توليد رد مقترح دلوقتي، حاول تاني');
  }
}

module.exports = { generateReplySuggestion };
