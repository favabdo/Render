// services/cache.service.js
//
// طبقة كاش عامة (Redis) — cache-aside — تستخدمها الـ repositories بس، للموارد
// "قراءة أغلب الوقت" المحددة في التدقيق (Teams/Labels/Agents/Company Settings/
// Automation/Webhooks/Inbox Settings/Contact & Customer Details/Devices/
// Maintenance Contracts/Visits/Scheduled Tasks). ممنوع تمامًا استخدامها لأي حاجة
// ليها علاقة بالمحادثات/الرسايل/الحضور/الكتابة الآن/الـ webhook الوارد من واتساب
// أو مسار إرسال الرسائل — دي لازم تفضل لايف 100% من SQL Server زي ما هي بالظبط.
//
// أهم مبدأ هنا: لو Redis مش موجود أو وقع لأي سبب، كل دالة هنا بترجع بهدوء (miss)
// من غير ما ترمي استثناء — يعني أي repo بيستخدم getOrSet() هيرجع تلقائيًا يقرا من
// SQL Server زي ما كان شغال بالظبط قبل ما الكاش يتضاف، من غير ما يكسر أي حاجة.
// الكاش هنا تحسين أداء بحت، مش جزء من منطق العمل، ومفروض ميغيّرش أي استجابة API.

const logger = require('../utils/logger');
const env = require('../config/env');

let RedisClient = null;
try {
  // eslint-disable-next-line global-require
  RedisClient = require('ioredis');
} catch (err) {
  RedisClient = null; // الحزمة لسه مش متركبة — الكاش هيفضل متعطل تلقائيًا (فحص أدناه)
}

const RECONNECT_COOLDOWN_MS = 30000; // لو الاتصال فشل، منحاولش تاني قبل 30 ثانية (عشان منضربش Redis/الشبكة بمحاولات متلاحقة)

let client = null;
let connectPromise = null;
let lastConnectFailureAt = 0;

// عدادات خفيفة جدًا (نفس فكرة metrics بتاعة الـ SQL pool) — مفيش أي لوج على كل
// عملية، بس أرقام في الميموري ممكن تتعرض لو حبينا مونيتورينج اختياري بعدين
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
  errors: 0,
};

function isEnabled() {
  return env.CACHE_ENABLED && !!RedisClient;
}

// بيرجع كلاينت Redis جاهز، أو null لو الكاش متعطل/الاتصال فاشل حاليًا. بيعمل
// lazy connect زي getPool() بالظبط بس مع cooldown عشان لو Redis نازل مش هيحاول
// يتصل مع كل request جديد
function getClient() {
  if (!isEnabled()) return Promise.resolve(null);

  if (client && client.status === 'ready') return Promise.resolve(client);

  const now = Date.now();
  if (!connectPromise && now - lastConnectFailureAt < RECONNECT_COOLDOWN_MS) {
    return Promise.resolve(null);
  }

  if (!connectPromise) {
    let instance;
    try {
      instance = new RedisClient(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3000,
        retryStrategy: () => null, // منعتمدش على إعادة المحاولة الداخلية بتاعة ioredis — الـ cooldown فوق بيتكفل بيها
      });
    } catch (err) {
      lastConnectFailureAt = Date.now();
      logger.warn('⚠️ فشل تهيئة عميل Redis — الكاش هيفضل متعطل، كل القراءات هتيجي من SQL Server مباشرة:', err.message);
      return Promise.resolve(null);
    }

    instance.on('error', (err) => {
      stats.errors += 1;
      logger.warn('⚠️ Redis error (كاش):', err.message);
    });

    connectPromise = instance
      .connect()
      .then(() => {
        client = instance;
        logger.info('✅ متصل بنجاح بـ Redis (طبقة الكاش)');
        return client;
      })
      .catch((err) => {
        lastConnectFailureAt = Date.now();
        connectPromise = null;
        logger.warn('⚠️ فشل الاتصال بـ Redis — هيتعاد المحاولة تلقائيًا بعد شوية، لحد ذلك كل القراءات هتيجي من SQL Server مباشرة:', err.message);
        try {
          instance.disconnect();
        } catch (_) {
          /* تجاهل */
        }
        return null;
      });
  }

  return connectPromise;
}

// namespace + versioning: كل مفتاح فعليًا بيتحط قبله البادئة ورقم الإصدار، عشان:
// 1) نقدر نفرّق كاش النظام ده عن أي استخدام تاني لنفس Redis instance (namespace)
// 2) نقدر "نبطّل" كل الكاش القديم دفعة واحدة برفع رقم الإصدار من الـ env بس، من
//    غير أي FLUSHALL فعلي على Redis (versioning)
function buildKey(key) {
  return `${env.CACHE_PREFIX}:${env.CACHE_VERSION}:${key}`;
}

// مفتاح مركّب من أجزاء (namespace prefixes) — مثال: cacheKey('customer', 42) => 'customer:42'
function cacheKey(...parts) {
  return parts.filter((p) => p !== undefined && p !== null && p !== '').join(':');
}

// ===== الدوال العامة (generic get/set/delete) — كل التعامل مع Redis من هنا بس،
// مفيش أي repo بيتكلم مع مكتبة ioredis مباشرة (مفيش تكرار كود) =====

async function get(key) {
  const redis = await getClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(buildKey(key));
    if (raw == null) {
      stats.misses += 1;
      return null;
    }
    stats.hits += 1;
    return JSON.parse(raw);
  } catch (err) {
    stats.errors += 1;
    logger.warn(`⚠️ فشل قراءة الكاش (${key}):`, err.message);
    return null;
  }
}

async function set(key, value, ttlSeconds) {
  const redis = await getClient();
  if (!redis) return false;
  try {
    const raw = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.set(buildKey(key), raw, 'EX', ttlSeconds);
    } else {
      await redis.set(buildKey(key), raw);
    }
    stats.sets += 1;
    return true;
  } catch (err) {
    stats.errors += 1;
    logger.warn(`⚠️ فشل تخزين الكاش (${key}):`, err.message);
    return false;
  }
}

// بتمسح مفتاح واحد أو مجموعة مفاتيح محددة بالاسم — مفيش ولا دالة هنا بتعمل
// FLUSHALL/FLUSHDB أو أي مسح عام لكل الكاش، بالتصميم (شوف تعليق الملف فوق)
async function del(keyOrKeys) {
  const redis = await getClient();
  if (!redis) return false;
  const keys = (Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]).filter(Boolean);
  if (!keys.length) return true;
  try {
    await redis.del(keys.map(buildKey));
    stats.deletes += keys.length;
    return true;
  } catch (err) {
    stats.errors += 1;
    logger.warn(`⚠️ فشل مسح مفاتيح الكاش (${keys.join(', ')}):`, err.message);
    return false;
  }
}

// ===== cache-aside الجاهز — ده اللي المفروض كل repo يستخدمه =====
// Redis -> hit? رجّع فورًا. miss؟ نفّذ fetchFn (استعلام SQL Server الحقيقي)،
// خزّن النتيجة في Redis، وارجعها. لو fetchFn رمت استثناء أو النتيجة null/undefined
// منخزنهاش (عشان منكاشش "مفيش نتيجة" ونمنع نتيجة حقيقية بعد كده تتسجل)
async function getOrSet(key, ttlSeconds, fetchFn) {
  const cached = await get(key);
  if (cached !== null) return cached;

  const fresh = await fetchFn();
  if (fresh !== null && fresh !== undefined) {
    // مفيش داعي نستنى set تخلص قبل ما نرجع النتيجة للمستخدم — لو فشلت مش
    // هتأثر على الاستجابة نفسها (fail-open)، بس بنمسكها بـ catch عشان unhandled
    // rejection ميظهرش في الـ logs من غير داعي
    set(key, fresh, ttlSeconds).catch(() => {});
  }
  return fresh;
}

function getStats() {
  return { ...stats, enabled: isEnabled(), connected: !!(client && client.status === 'ready') };
}

module.exports = {
  cacheKey,
  get,
  set,
  del,
  getOrSet,
  getStats,
  TTL: env.CACHE_TTL,
};
