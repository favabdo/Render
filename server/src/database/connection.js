const sql = require('mssql');
const env = require('../config/env');
const logger = require('../utils/logger');

const TABLE_NAME = env.DB_TABLE_NAME;

// إعدادات الـ pool — كلهم قابلين للتظبيط من env (config/env.js)، والقيم
// الافتراضية اتحطت لسيناريو CRM إنتاجي: ~100 إيجنت متزامن، آلاف محادثات نشطة،
// حركة سوكيت عالية، SQL Server أونلاين. مبرر كل قيمة:
//
// max: 20 — العدد اللي بيتحسب مش عدد الإيجنتس نفسه، لإن مش كل الـ100 إيجنت
//   بيضربوا الداتابيز في نفس اللحظة بالظبط؛ الاستعلامات قصيرة (ميلي ثانية لحد
//   عشرات الميلي ثانية) وبترجع الكونكشن للـ pool فورًا بعد كل query. 20 كونكشن
//   متزامن بيدّي هامش أمان كويس لبيرست حقيقي (كذا إيجنت بيفتحوا محادثات/يبعتوا
//   ردود في نفس الثانية) من غير ما نستهلك حد الكونكشنز على السيرفر أو نفتح
//   كونكشنز زيادة عن اللزوم (كل كونكشن بياخد Memory/Worker Thread على SQL
//   Server نفسه). لو ظهر تشبع فعلي (اتضح من poolSaturationPct في المتريكس)
//   يترفع تدريجيًا مش يتضاعف على الفاضي.
// min: 2 — كونكشن سخن واحد ممكن يبقى نقطة ضعف لو اتقفل / فشل الـ health check
//   بتاعه فجأة؛ اتنين بيدّوا نفس فايدة "منع cold start" الأصلية من غير ما
//   يزودوا التكلفة بشكل محسوس (لسه رقم بسيط جدًا قدام max).
// idleTimeoutMillis: 30000 — القيمة الأصلية كانت صح وفضلت زي ما هي: كفاية عشان
//   الكونكشنز الزيادة عن الـ min تتقفل لو الحمل قل (مش هتفضل مفتوحة من غير
//   داعي)، وميعادها مش قريب جدًا عشان ميقفلش كونكشنز بيتم استخدامها فعليًا كل
//   شوية في نظام فيه حركة مستمرة زي CRM شات.
// acquireTimeoutMillis: 15000 — لو الـ pool اتشبع فعلاً (كل الكونكشنز مشغولة)
//   الطلب بينتظر لحد 15 ثانية بس، مش هيفضل معلّق للأبد ويكوّم طلبات فوق بعض
//   (كان مش متظبط قبل كده = أي تشبع كان ممكن يعلّق الطلبات من غير أي حد أقصى).
//   15 ثانية كفاية لبيرست عادي وفي نفس الوقت بتفشل بسرعة معقولة لو فيه مشكلة
//   حقيقية، بدل ما تسيب الـ request معلّق لحد timeout الـ HTTP نفسه.
// createTimeoutMillis: 15000 — لو فتح كونكشن TDS جديد (TCP + login handshake)
//   وقف لأي سبب (شبكة/سيرفر مش راد)، منستناهوش للأبد؛ نفس منطق acquireTimeoutMillis
//   بس لمرحلة إنشاء الكونكشن نفسها.
// destroyTimeoutMillis: 5000 — سقف زمني معقول لقفل كونكشن قديم/idle بهدوء من
//   غير ما يعلّق دورة الـ reap.
const config = {
  user: env.DB.user,
  password: env.DB.password,
  server: env.DB.server,
  port: env.DB.port,
  database: env.DB.database,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: env.DB.POOL_MAX,
    min: env.DB.POOL_MIN,
    idleTimeoutMillis: env.DB.POOL_IDLE_TIMEOUT_MS,
    acquireTimeoutMillis: env.DB.POOL_ACQUIRE_TIMEOUT_MS,
    createTimeoutMillis: env.DB.POOL_CREATE_TIMEOUT_MS,
    destroyTimeoutMillis: env.DB.POOL_DESTROY_TIMEOUT_MS,
  },
};

let poolPromise;

// عدادات خفيفة جدًا في الميموري بس (مفيش أي I/O، مفيش أي لوج بشكل افتراضي) —
// بتتحدّث مع كل حدث من أحداث الـ pool الداخلية (tarn، اللي مكتبة mssql بتستخدمها
// جوه) عشان نقدر نجاوب فعليًا وقت ما حد يسأل: هل بيتفتح كونكشن جديد مع كل طلب؟
// كام مللي ثانية بتاخدها عملية "acquire" (سحب كونكشن من الـ pool) لوحدها،
// منفصلة عن وقت تنفيذ الاستعلام نفسه؟ هل فيه طلبات مستنية (pool مشبّع)؟
// getPoolMetrics() بترجّع آخر لقطة عند الطلب — من غير أي console.log على كل
// query (ده كان بيحصل قبل كده مع كل استعلام في التطبيق، وده اللي بند "لا للوجينج
// الثقيل" في التدقيق كان بيقصده بالظبط).
const metrics = {
  totalAcquires: 0,
  totalConnectionsCreated: 0,
  totalCreateFailures: 0,
  lastAcquireMs: null,
  acquireMsSum: 0, // لحساب المتوسط من غير ما نخزن كل قيمة لوحدها
  poolCreatedAt: null,
  poolReadyMs: null, // كام مللي ثانية استغرقها فتح أول كونكشن (pool warm-up)
};

function attachPoolDiagnostics(pool) {
  const tarnPool = pool.pool;
  if (!tarnPool || typeof tarnPool.on !== 'function') {
    logger.warn('⚠️ تعذر الوصول لإحصائيات الـ connection pool الداخلية في نسخة mssql دي — تشخيص الـ pool محدود');
    return;
  }

  const debugLog = env.DB_POOL_DEBUG_LOG; // مطفي افتراضيًا — شوف config/env.js

  const acquireStarts = new Map();
  const createStarts = new Map();

  function poolStats() {
    return {
      used: tarnPool.numUsed?.(),
      free: tarnPool.numFree?.(),
      pendingCreates: tarnPool.numPendingCreates?.(),
      pendingAcquires: tarnPool.numPendingAcquires?.(),
    };
  }

  tarnPool.on('acquireRequest', (eventId) => acquireStarts.set(eventId, process.hrtime.bigint()));
  tarnPool.on('acquireSuccess', (eventId) => {
    const start = acquireStarts.get(eventId);
    acquireStarts.delete(eventId);
    const ms = start ? Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100 : null;
    metrics.totalAcquires += 1;
    metrics.lastAcquireMs = ms;
    if (ms != null) metrics.acquireMsSum += ms;
    if (debugLog) {
      logger.info('🔌 pool:acquire', { ms, totalAcquiresSinceStartup: metrics.totalAcquires, ...poolStats() });
    }
  });

  // createRequest/createSuccess بيحصلوا بس لما الـ pool فعليًا يفتح كونكشن TDS
  // جديد (TCP + login handshake) — مش مع كل استعلام لو الـ pooling شغال صح.
  // لو العدد ده بيزيد مع كل رد بيتبعت، يبقى فعليًا بيتفتح كونكشن جديد كل مرة.
  tarnPool.on('createRequest', (eventId) => createStarts.set(eventId, process.hrtime.bigint()));
  tarnPool.on('createSuccess', (eventId) => {
    const start = createStarts.get(eventId);
    createStarts.delete(eventId);
    metrics.totalConnectionsCreated += 1;
    const ms = start ? Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100 : null;
    if (debugLog) {
      logger.info('🆕 pool:new_connection_opened', { ms, totalConnectionsCreatedSinceStartup: metrics.totalConnectionsCreated, ...poolStats() });
    }
  });
  tarnPool.on('createFail', (eventId, err) => {
    metrics.totalCreateFailures += 1;
    logger.error('❌ pool:connection_create_failed', err?.message);
  });
}

// لقطة خفيفة وآمنة للإنتاج لحالة الـ pool دلوقتي — للاستخدام في مونيتورينج
// اختياري بس (زي /internal/pool-metrics لو DB_POOL_METRICS_ENDPOINT مفعّل).
// مفيش أي استعلام حقيقي بيتنفذ هنا، بس قراءة عدادات جاهزة في الميموري.
function getPoolMetrics() {
  const tarnPool = poolPromise && poolPromise._resolvedPool ? poolPromise._resolvedPool.pool : null;
  const live = tarnPool
    ? {
        activeConnections: tarnPool.numUsed?.() ?? null,
        idleConnections: tarnPool.numFree?.() ?? null,
        waitingRequests: tarnPool.numPendingAcquires?.() ?? null,
        poolSaturationPct:
          tarnPool.numUsed != null && env.DB.POOL_MAX
            ? Math.round(((tarnPool.numUsed() || 0) / env.DB.POOL_MAX) * 10000) / 100
            : null,
      }
    : { activeConnections: null, idleConnections: null, waitingRequests: null, poolSaturationPct: null };

  return {
    ...live,
    lastAcquireMs: metrics.lastAcquireMs,
    avgAcquireMs:
      metrics.totalAcquires > 0 ? Math.round((metrics.acquireMsSum / metrics.totalAcquires) * 100) / 100 : null,
    totalAcquiresSinceStartup: metrics.totalAcquires,
    totalConnectionsCreatedSinceStartup: metrics.totalConnectionsCreated,
    totalCreateFailuresSinceStartup: metrics.totalCreateFailures,
    poolCreatedAt: metrics.poolCreatedAt,
    poolReadyMs: metrics.poolReadyMs,
    poolMax: env.DB.POOL_MAX,
    poolMin: env.DB.POOL_MIN,
  };
}

function getPool() {
  if (!poolPromise) {
    const startedAt = process.hrtime.bigint();
    metrics.poolCreatedAt = new Date().toISOString();
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        metrics.poolReadyMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100;
        logger.info('✅ متصل بنجاح بقاعدة بيانات SQL Server:', env.DB.database);
        attachPoolDiagnostics(pool);
        // بنخزن مرجع الـ pool الحقيقي على نفس الـ promise عشان getPoolMetrics()
        // تقدر توصله بشكل sync من غير ما تستنى الـ promise تاني (قراءة بس،
        // مفيش أي تأثير على سلوك الاتصال).
        poolPromise._resolvedPool = pool;
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        logger.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
        throw err;
      });
  }
  return poolPromise;
}

async function ensureTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '${TABLE_NAME}')
    BEGIN
      CREATE TABLE [dbo].[${TABLE_NAME}] (
        id             BIGINT IDENTITY(1,1) PRIMARY KEY,
        wa_message_id  NVARCHAR(100) NULL,
        direction      NVARCHAR(10) NOT NULL,
        from_number    NVARCHAR(30) NULL,
        to_number      NVARCHAR(30) NULL,
        contact_name   NVARCHAR(200) NULL,
        message_type   NVARCHAR(30) NULL,
        message_text   NVARCHAR(MAX) NULL,
        media_url      NVARCHAR(500) NULL,
        status         NVARCHAR(30) NULL,
        raw_payload    NVARCHAR(MAX) NULL,
        created_at     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);
  logger.info(`✅ الجدول [${TABLE_NAME}] جاهز.`);
}

async function ensureConversationsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Conversations_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Conversations_byA] (
        id                BIGINT IDENTITY(1,1) PRIMARY KEY,
        contact_number    NVARCHAR(30) NOT NULL,
        contact_name      NVARCHAR(200) NULL,
        status            NVARCHAR(20) NOT NULL DEFAULT 'open',
        assigned_agent_id BIGINT NULL,
        last_message_at   DATETIME2 NULL,
        created_at        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_NileChat_Conversations_byA_contact_number
        ON [dbo].[NileChat_Conversations_byA](contact_number);
    END
  `);
}

async function ensureAgentsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Agents_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Agents_byA] (
        id            BIGINT IDENTITY(1,1) PRIMARY KEY,
        name          NVARCHAR(200) NOT NULL,
        email         NVARCHAR(200) NOT NULL UNIQUE,
        password_hash NVARCHAR(200) NOT NULL,
        created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);
}

// جدول المستخدمين — المسموح لهم بتسجيل الدخول
async function ensureUsersTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Users_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Users_byA] (
        id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
        email                 NVARCHAR(200) NOT NULL UNIQUE,
        password              NVARCHAR(200) NOT NULL,
        role                  INT           NOT NULL DEFAULT 1,   -- 0=superadmin / 1=admin / 2=agent
        status                NVARCHAR(20)  NOT NULL DEFAULT 'active',
        company_id            BIGINT        NULL,
        company_code          NVARCHAR(100) NULL,
        invite_token          NVARCHAR(200) NULL,
        invite_token_expires  DATETIME2     NULL
      );
    END
    ELSE
    BEGIN
      -- إضافة الأعمدة الجديدة لو الجدول موجود بالفعل من غير ما يمسح البيانات
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_Users_byA') AND name = 'company_id')
        ALTER TABLE [dbo].[NileChat_Users_byA] ADD company_id BIGINT NULL;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_Users_byA') AND name = 'company_code')
        ALTER TABLE [dbo].[NileChat_Users_byA] ADD company_code NVARCHAR(100) NULL;
      -- الاسم اللي بيتعرض للإيجنت بدل الإيميل (قابل للتعديل من نفس الإيجنت)
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_Users_byA') AND name = 'display_name')
        ALTER TABLE [dbo].[NileChat_Users_byA] ADD display_name NVARCHAR(200) NULL;
      -- توكن دعوة الإيجنت الجديد (بيتبعت في إيميل التسجيل) وتاريخ انتهاء صلاحيته
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_Users_byA') AND name = 'invite_token')
        ALTER TABLE [dbo].[NileChat_Users_byA] ADD invite_token NVARCHAR(200) NULL;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_Users_byA') AND name = 'invite_token_expires')
        ALTER TABLE [dbo].[NileChat_Users_byA] ADD invite_token_expires DATETIME2 NULL;
    END
  `);
  logger.info('✅ جدول Users جاهز.');
}

// جدول الـ Inboxes — كل Inbox بيمثل قناة اتصال حقيقية (دلوقتي: WhatsApp Cloud API)
// كل Inbox ليه بيانات اعتماد (credentials) مستقلة، فممكن تضيف أكتر من رقم واتساب
// وكل واحد بيبقى Inbox منفصل، بالظبط زي فكرة Chatwoot
async function ensureInboxesTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Inboxes_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Inboxes_byA] (
        id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
        name                  NVARCHAR(200) NOT NULL,
        channel_type          NVARCHAR(30)  NOT NULL DEFAULT 'whatsapp',
        api_provider          NVARCHAR(30)  NOT NULL DEFAULT 'whatsapp_cloud',
        phone_number          NVARCHAR(30)  NULL,
        phone_number_id       NVARCHAR(100) NULL,
        business_account_id   NVARCHAR(100) NULL,
        access_token          NVARCHAR(1000) NULL,
        verified_name         NVARCHAR(200) NULL,
        display_phone_number  NVARCHAR(50)  NULL,
        status                NVARCHAR(20)  NOT NULL DEFAULT 'active',
        created_by            BIGINT NULL,
        created_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);
  logger.info('✅ جدول Inboxes جاهز.');
}

// لو جدول الـ Inboxes كان اتعمل قبل كده بنسخة أقدم من الكود، بنضيف الأعمدة الجديدة
// من غير ما نلمس أي بيانات موجودة (زي فكرة ensureUsersTableExists بالظبط)
async function ensureInboxesHaveExtraColumns() {
  const pool = await getPool();
  const columns = [
    { name: 'api_provider', def: `NVARCHAR(30) NOT NULL DEFAULT 'whatsapp_cloud'` },
    { name: 'phone_number', def: `NVARCHAR(30) NULL` },
    { name: 'business_account_id', def: `NVARCHAR(100) NULL` },
    // الـ WhatsApp Flow بتاع "تقييم ما بعد الحل" (نجوم الحل + نجوم الإيجنت + تعليق
    // نصي كلهم في رسالة واحدة) بيتعمله publish مرة واحدة لكل Inbox وبيتخزن الـ id
    // بتاعه هنا عشان مانعملوش Flow جديد كل مرة — لو فاضي هيتعمل تلقائيًا أول مرة
    // يحصل فيها Resolve مع تفعيل قاعدة التقييم
    { name: 'rating_flow_id', def: `NVARCHAR(100) NULL` },
  ];
  for (const col of columns) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.NileChat_Inboxes_byA') AND name = '${col.name}'
      )
      BEGIN
        ALTER TABLE [dbo].[NileChat_Inboxes_byA] ADD ${col.name} ${col.def};
      END
    `);
  }
}

// ربط الموظفين (Agents) بكل Inbox — نفس فكرة Chatwoot "Add Agents"
async function ensureInboxAgentsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_InboxAgents_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_InboxAgents_byA] (
        id         BIGINT IDENTITY(1,1) PRIMARY KEY,
        inbox_id   BIGINT NOT NULL,
        user_id    BIGINT NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_NileChat_InboxAgents_byA UNIQUE (inbox_id, user_id)
      );
    END
  `);
}

// بنربط كل محادثة بالـ Inbox اللي جاية منه (عشان لو فيه أكتر من رقم واتساب نعرف نرد من نفس الرقم)
async function ensureConversationsHaveInboxColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Conversations_byA') AND name = 'inbox_id'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_Conversations_byA] ADD inbox_id BIGINT NULL;
    END
  `);
}

// بنسجل تفاصيل الحل الحقيقي (مين حلها، إمتى، وتحت أي تصنيف) بدل ما يبقى شكلي في الواجهة بس
async function ensureConversationsHaveResolveColumns() {
  const pool = await getPool();
  const columns = [
    { name: 'resolve_category', def: 'NVARCHAR(150) NULL' },
    { name: 'resolve_notes', def: 'NVARCHAR(MAX) NULL' },
    { name: 'resolved_by', def: 'BIGINT NULL' },
    { name: 'resolved_at', def: 'DATETIME2 NULL' },
  ];
  for (const col of columns) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.NileChat_Conversations_byA') AND name = '${col.name}'
      )
      BEGIN
        ALTER TABLE [dbo].[NileChat_Conversations_byA] ADD ${col.name} ${col.def};
      END
    `);
  }
}

// بمجرد ما المحادثة تتقفل (Resolve) بنسجل وقت القفل هنا وده اللي بيقفل المحادثة فعليًا
// للأبد — عمل Reopen بعد كده بيغيّر الـ status بس (عشان تظهر في قسم المفتوحة) لكن الوقت
// ده مبيتمسحش خالص، فأي محاولة رد/تعيين/ملاحظة/إعادة قفل على المحادثة دي هتتمنع طول ما
// العمود ده مش NULL — بغض النظر عن الـ status الحالي
async function ensureConversationsHaveLockColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Conversations_byA') AND name = 'locked_at'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_Conversations_byA] ADD locked_at DATETIME2 NULL;
    END
  `);
}

async function ensureMessagesHaveConversationColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.${TABLE_NAME}') AND name = 'conversation_id'
    )
    BEGIN
      ALTER TABLE [dbo].[${TABLE_NAME}] ADD conversation_id BIGINT NULL;
    END
  `);
}

// بنسجل مين بعت الرسالة الصادرة (الإيجنت) عشان نقدر نعرض اسمه فوق الرسالة في الشات
// بنخزن اسم وقت الإرسال (snapshot) عشان لو الإيجنت غيّر اسمه بعدين، الرسايل القديمة
// تفضل عليها الاسم اللي كان بيستخدمه وقتها بالظبط
async function ensureMessagesHaveSenderColumns() {
  const pool = await getPool();
  const columns = [
    { name: 'sent_by_user_id', def: 'BIGINT NULL' },
    { name: 'sent_by_name', def: 'NVARCHAR(200) NULL' },
  ];
  for (const col of columns) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.${TABLE_NAME}') AND name = '${col.name}'
      )
      BEGIN
        ALTER TABLE [dbo].[${TABLE_NAME}] ADD ${col.name} ${col.def};
      END
    `);
  }
}

// بنعلّم رسايل أتمتة "ما بعد الحل" (CSAT + فلو التقييم بكل مراحله + ردود العميل
// عليها) بعمود منفصل عشان نقدر نفلترها بره شاشة الإيجنت (آخر حاجة يشوفها
// الإيجنت هي رسالة "Conversation was marked resolved" نفسها بس — أي حاجة بعدها
// من أتمتة التقييم مخصوصة للـ admin/owner بس، شوف conversation.controller.js)
async function ensureMessagesHavePostResolveColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.${TABLE_NAME}') AND name = 'is_post_resolve'
    )
    BEGIN
      ALTER TABLE [dbo].[${TABLE_NAME}] ADD is_post_resolve BIT NOT NULL DEFAULT 0;
    END
  `);
}

// بنسجل نوع الملف (MIME) واسمه الأصلي مع أي رسالة وسائط (صورة/فيديو/صوت/مستند)
// عشان الواجهة تعرف تعرض العنصر الصح (img/video/audio/رابط تحميل) وتفضل عارفة
// اسم الملف الأصلي حتى لو الرابط المخزن اسمه عشوائي على السيرفر
async function ensureMessagesHaveMediaColumns() {
  const pool = await getPool();
  const columns = [
    { name: 'media_mime', def: 'NVARCHAR(150) NULL' },
    { name: 'media_filename', def: 'NVARCHAR(300) NULL' },
  ];
  for (const col of columns) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.${TABLE_NAME}') AND name = '${col.name}'
      )
      BEGIN
        ALTER TABLE [dbo].[${TABLE_NAME}] ADD ${col.name} ${col.def};
      END
    `);
  }
}

// بيضيف الإندكسات الناقصة على جدول الرسائل: conversation_id (بيتفلتر بيه في كل
// فتح شات، وبيتحدّث بيه last_message_at) و wa_message_id (بيتدور بيه مع كل
// status update جاي من ميتا). من غيرهم بتحصل full table scan على الجدول ده مع
// نمو عدد الرسائل — تحسين أداء بحت، مفيش أي تغيير في المنطق أو النتائج، بس بيسرّع
// نفس الاستعلامات اللي شغالة أصلاً (لازم تتنفذ بعد ما عمود conversation_id يتضاف
// فعليًا لو الجدول قديم — شوف ترتيبها في ensureSchema تحت)
async function ensureMessagesHaveIndexes() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.${TABLE_NAME}') AND name = 'IX_${TABLE_NAME}_conversation_id'
    )
    BEGIN
      CREATE INDEX IX_${TABLE_NAME}_conversation_id ON [dbo].[${TABLE_NAME}](conversation_id);
    END
  `);
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.${TABLE_NAME}') AND name = 'IX_${TABLE_NAME}_wa_message_id'
    )
    BEGIN
      CREATE INDEX IX_${TABLE_NAME}_wa_message_id ON [dbo].[${TABLE_NAME}](wa_message_id);
    END
  `);
}

// ===== الكونتاكتس (العملاء الحقيقيين) =====
// كونتاكت ممكن يبقى ليه أكتر من رقم واحد مرتبط بيه (لو العميل بعت من رقم جديد وربطناه بنفس الكونتاكت القديم)
async function ensureContactsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Contacts_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Contacts_byA] (
        id         BIGINT IDENTITY(1,1) PRIMARY KEY,
        name       NVARCHAR(200) NULL,
        status     TINYINT NOT NULL DEFAULT 1, -- 1 = شغال وظاهر، 0 = متمسوح (مخفي بس البيانات فاضلة)
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);
}

// كارت "عميل صيانة" (Add Customer، أدمن بس): مكان العميل، تاريخ التعاقد الأصلي
// (لأول مرة اتعاقدنا مع العميل — بيانات معلوماتية بس ومالهاش أي علاقة بعقود
// الصيانة نفسها)، ورقم تليفون مدير العميل. الأعمدة دي بتفضل NULL لأي كونتاكت
// عادي جاي من واتساب — بتتملى بس لما الأدمن يضيف/يعدّل بيانات الكونتاكت من
// زرار "Add Contact" أو "تعديل" في صفحة Contacts
async function ensureContactsHaveCustomerCardColumns() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'location'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_Contacts_byA] ADD location NVARCHAR(300) NULL;
    END
  `);

  // العمودين القدام دول كانوا بيتخزن فيهم تاريخ بدء/انتهاء عقد الصيانة قبل ما
  // يبقى ليه جدول منفصل بالكامل (NileChat_MaintenanceContracts_byA) — بقوا
  // مكررين ومش مستخدمين في أي كويري حاليًا، فبنمسحهم عشان مايفضلش لبس، وبنحط
  // مكانهم تاريخ التعاقد (بمعنى جديد تمامًا، مستقل عن الصيانة) ورقم المدير
  await pool.request().query(`
    IF EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'maintenance_end_date'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_Contacts_byA] DROP COLUMN maintenance_end_date;
    END
  `);

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'contract_date'
    )
    BEGIN
      -- تاريخ التعاقد: معلومة مستقلة بتوضح امتى اتعاقدنا مع العميل ده لأول مرة،
      -- مالهاش أي ربط ببرمجة/حساب عقود الصيانة (دي في جدول منفصل تمامًا)
      ALTER TABLE [dbo].[NileChat_Contacts_byA] ADD contract_date DATE NULL;
    END

    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'manager_phone'
    )
    BEGIN
      -- رقم تليفون مدير العميل (شخص مختلف عن رقم العميل نفسه المسجل في ContactPhones)
      ALTER TABLE [dbo].[NileChat_Contacts_byA] ADD manager_phone NVARCHAR(30) NULL;
    END

    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'manager_name'
    )
    BEGIN
      -- اسم مدير العميل، بيتخزن جمب رقم تليفونه (manager_phone) كمعلومة مستقلة برضه
      ALTER TABLE [dbo].[NileChat_Contacts_byA] ADD manager_name NVARCHAR(200) NULL;
    END

    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'created_by'
    )
    BEGIN
      -- الإيجنت (من جدول NileChat_Users_byA) اللي أنشأ كارت العميل ده
      ALTER TABLE [dbo].[NileChat_Contacts_byA] ADD created_by BIGINT NULL;
    END
  `);
}

// عمود الحالة: 1 = عميل شغال وظاهر عادي في كل مكان (القايمة، البحث، اختيار
// "اربط بكونتاكت موجود"...)، 0 = عميل "متمسوح" من وجهة نظر المستخدم. مسح عميل
// دلوقتي (contact.controller.deleteContact -> contact.repo.softDeleteContact)
// بقى بيحول الحالة لـ 0 بس، من غير ما يلمس صفه ولا أي حاجة مرتبطة بيه (أرقامه،
// محادثاته، رسايله...) — كله فاضل زي ما هو في الداتابيز، بس بيتفلتر ويتخفي من
// القوايم (listContacts / listContactsPage) عشان محدش يشوفه تاني
async function ensureContactsHaveStatusColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'status'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_Contacts_byA] ADD status TINYINT NOT NULL DEFAULT 1;
    END
  `);
}

// عمودين مستقلين لتصنيف العميل (VIP / غير نشط)، مالهمش أي علاقة بعمود status
// (اللي بيتحكم في المسح الناعم soft-delete). كل عمود منفصل تمامًا عن التاني:
// is_vip = 1 يعني عميل VIP و0 يعني لأ، is_inactive = 1 يعني غير نشط و0 يعني
// نشط. بكده عميل ممكن يبقى VIP وغير نشط في نفس الوقت
async function ensureContactsHaveVipInactiveColumns() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'is_vip'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_Contacts_byA] ADD is_vip TINYINT NOT NULL DEFAULT 0;
    END

    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'is_inactive'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_Contacts_byA] ADD is_inactive TINYINT NOT NULL DEFAULT 0;
    END
  `);
}

async function ensureContactPhonesTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_ContactPhones_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_ContactPhones_byA] (
        id           BIGINT IDENTITY(1,1) PRIMARY KEY,
        contact_id   BIGINT NOT NULL,
        phone_number NVARCHAR(30) NOT NULL UNIQUE,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_NileChat_ContactPhones_byA_contact_id
        ON [dbo].[NileChat_ContactPhones_byA](contact_id);
    END
  `);
}

// فروع العميل: عميل (شركة) ممكن يكون ليه أكتر من فرع/مكان، كل فرع ليه اسمه
// وعنوانه بشكل مستقل. عمود location القديم على الكونتاكت نفسه فضل موجود
// كمان (بيتحدّث تلقائيًا بأول فرع) عشان أي كويري قديمة بتستخدمه (listContacts،
// البحث، رسايل الزيارات...) تفضل شغالة من غير ما نلمسها كلها
async function ensureContactBranchesTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_ContactBranches_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_ContactBranches_byA] (
        id         BIGINT IDENTITY(1,1) PRIMARY KEY,
        contact_id BIGINT NOT NULL,
        name       NVARCHAR(200) NULL,
        location   NVARCHAR(300) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_NileChat_ContactBranches_byA_contact_id
        ON [dbo].[NileChat_ContactBranches_byA](contact_id);
    END
  `);
}

// الموديولات اللي كل عميل مشترك فيها (حسابات عامة، إدارة مخازن، شئون موظفين...
// إلخ) — عميل ممكن يكون مشترك في أكتر من موديول مع بعض، فبنخزنهم في جدول
// منفصل (صف لكل موديول لكل عميل) بدل عمود واحد. is_custom بتفرّق الموديول اللي
// الأدمن كتبه بايده (مش من القايمة الجاهزة) عشان نقدر نعرضه/نتعامل معاه لوحده
async function ensureContactModulesTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_ContactModules_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_ContactModules_byA] (
        id           BIGINT IDENTITY(1,1) PRIMARY KEY,
        contact_id   BIGINT NOT NULL,
        module_name  NVARCHAR(300) NOT NULL,
        is_custom    BIT NOT NULL DEFAULT 0,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_NileChat_ContactModules_byA_contact_id
        ON [dbo].[NileChat_ContactModules_byA](contact_id);
    END
  `);
}


// يوضح كل رقم بيمثل إيه (مثلاً: "الشغل"، "الرقم الشخصي") — كله برضه تحت نفس الكونتاكت
async function ensureContactPhonesHaveLabelColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_ContactPhones_byA') AND name = 'label'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_ContactPhones_byA] ADD label NVARCHAR(100) NULL;
    END
  `);
}

// بنربط كل محادثة بالكونتاكت الحقيقي بتاعها (رقم واحد ممكن يتنقل بين كونتاكتس لو حصل دمج)
async function ensureConversationsHaveContactColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_Conversations_byA') AND name = 'contact_id'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_Conversations_byA] ADD contact_id BIGINT NULL;
    END
  `);
}

// أجهزة الدعم الفني (AnyDesk) الخاصة بكل عميل — قسم "Devices" في لوحة العميل، بقى
// بيتخزن فعليًا في الداتابيز بدل ما يكون في الذاكرة بس (كان بيتمسح أول ما تعمل refresh)
async function ensureDevicesTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Devices_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Devices_byA] (
        id         BIGINT IDENTITY(1,1) PRIMARY KEY,
        contact_id BIGINT NOT NULL,
        name       NVARCHAR(200) NOT NULL,
        anydesk    NVARCHAR(150) NULL,
        password   NVARCHAR(200) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NULL
      );
      CREATE INDEX IX_NileChat_Devices_byA_contact_id
        ON [dbo].[NileChat_Devices_byA](contact_id);
    END
  `);
  logger.info('✅ جدول Devices جاهز.');
}

// التاسكات المجدولة (Scheduled Tasks) — لما عميل يطلب حاجة والإيجنت يحتاج يجدولها
// ليوم تاني، بنسجلها هنا: مين العميل، إيه المطلوب، مين الإيجنت اللي جدولها (من الجلسة
// بتاعته)، تاريخ الإضافة (created_at تلقائي)، وتاريخ التسليم المتفق عليه (due_date).
// التاسك بتفضل موجودة لما تتقفل (status='ended')، مش بتتمسح خالص — بس بتتنقل من
// "Open Tasks" لـ "Ended Tasks" في الواجهة.
async function ensureScheduledTasksTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_ScheduledTasks_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_ScheduledTasks_byA] (
        id            BIGINT IDENTITY(1,1) PRIMARY KEY,
        contact_id    BIGINT NOT NULL,
        customer_name NVARCHAR(200) NULL,
        task_text     NVARCHAR(MAX) NOT NULL,
        agent_id      BIGINT NULL,
        agent_name    NVARCHAR(200) NULL,
        status        NVARCHAR(20) NOT NULL DEFAULT 'open',
        due_date      DATE NOT NULL,
        created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        ended_at      DATETIME2 NULL
      );
      CREATE INDEX IX_NileChat_ScheduledTasks_byA_contact_id
        ON [dbo].[NileChat_ScheduledTasks_byA](contact_id);
    END

    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.NileChat_ScheduledTasks_byA') AND name = 'delivery_status'
    )
    BEGIN
      -- delivery_status بتتحسب مرة واحدة بس لحظة الـ End (شوف endScheduledTask في
      -- scheduledTask.repo.js): 'on_time' لو اتقفلت في نفس يوم due_date أو قبله،
      -- 'late' لو اتقفلت بعد ما يوم التسليم المتفق عليه عدى. NULL لحد ما التاسك تتقفل.
      ALTER TABLE [dbo].[NileChat_ScheduledTasks_byA] ADD delivery_status NVARCHAR(20) NULL;
    END
  `);
  logger.info('✅ جدول Scheduled Tasks جاهز.');
}

// الزيارات (Visits) — سجل زيارات الإيجنتس للعملاء: تاريخ الزيارة، اللي اتعمل فيها،
// وساعات الوصول/الانصراف (اختياري). الزيارة ممكن تتضاف مرتبطة بكونتاكت حقيقي
// (contact_id) لو اتضافت من جوه صفحة تفاصيل العميل، أو باسم يدوي (customer_name)
// بس لو اتضافت من زرار "إضافة زيارة" البرّاني (جمب Add Contact) والإيجنت كتب اسم
// عميل مش متسجل أصلًا كـ كونتاكت. agent_id/agent_name بييجوا من الجلسة بتاعة
// الإيجنت وقت الإضافة (مش من الفرونت) عشان محدش يقدر يزوّر مين اللي عمل الزيارة.
async function ensureVisitsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Visits_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Visits_byA] (
        id              BIGINT IDENTITY(1,1) PRIMARY KEY,
        contact_id      BIGINT NULL,
        customer_name   NVARCHAR(200) NULL,
        visit_date      DATE NOT NULL,
        work_done       NVARCHAR(MAX) NOT NULL,
        arrival_time    NVARCHAR(5) NULL,
        departure_time  NVARCHAR(5) NULL,
        agent_id        BIGINT NULL,
        agent_name      NVARCHAR(200) NULL,
        created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_NileChat_Visits_byA_contact_id
        ON [dbo].[NileChat_Visits_byA](contact_id);
    END
  `);
  logger.info('✅ جدول Visits جاهز.');
}

// سجل عقود الصيانة (Maintenance Contracts) — بديل عن فكرة "عقد واحد بس" اللي كانت
// متخزنة كأعمدة على الكونتاكت نفسه (contract_date/maintenance_end_date). دلوقتي كل
// عقد بيتسجل كصف منفصل هنا: تاريخ بدء، تاريخ انتهاء، وملاحظة اختيارية، فلو عقد عميل
// انتهى ممكن نضيفله عقد جديد كامل من غير ما نمسح تاريخ العقود اللي فاتت. عمود
// contract_date/maintenance_end_date على الكونتاكت بيفضل موجود بس مش بيتحدث تاني —
// بدل منه بنجيب "العقد الحالي" (الساري لو موجود، وإلا آخر عقد انتهى) بـ OUTER APPLY
// في استعلامات contact.repo.js، فالإحصائيات الظاهرة برة (فوق قسم الزيارات) بتفضل
// شغالة زي ما هي بالظبط من غير ما نغيّر حاجة في الفرونت الخاص بيها.
async function ensureMaintenanceContractsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_MaintenanceContracts_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_MaintenanceContracts_byA] (
        id              BIGINT IDENTITY(1,1) PRIMARY KEY,
        contact_id      BIGINT NOT NULL,
        start_date      DATE NOT NULL,
        end_date        DATE NOT NULL,
        notes           NVARCHAR(500) NULL,
        created_by      BIGINT NULL,
        created_by_name NVARCHAR(200) NULL,
        created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_NileChat_MaintenanceContracts_byA_contact_id
        ON [dbo].[NileChat_MaintenanceContracts_byA](contact_id);

      -- ترحيل لمرة واحدة بس: أي عميل كان عنده عقد صيانة متسجل بالطريقة القديمة
      -- (عمودين contract_date/maintenance_end_date على الكونتاكت، قبل ما
      -- الاتنين يتمسحوا و contract_date ترجع بمعنى تاني تمامًا -- تاريخ التعاقد
      -- العام، مالوش علاقة بالصيانة) بياخد أول صف في سجل العقود الجديد، عشان
      -- تاريخه القديم ميتلغيش. العمودين القدام دول ممكن يكونوا اتمسحوا فعلاً
      -- من زمان في قواعد بيانات شغالة (زي عندنا دلوقتي)، فبنبني الـ INSERT كـ
      -- SQL ديناميكي (sp_executesql) بدل ما نكتبه كنص ثابت في الباتش: SQL Server
      -- بيتأكد من أسماء الأعمدة وقت الـ compile للباتش كله مرة واحدة حتى لو
      -- جوه شرط IF مش هيتنفذ، فأي إشارة مباشرة لعمود مش موجود أصلاً كانت هترمي
      -- "Invalid column name" برغم الـ IF EXISTS، لإن الفحص وقت الـ compile مش
      -- وقت التنفيذ. بالطريقة دي الاستعلام بيتفحص وبيتنفذ بس لو العمودين موجودين فعلاً
      IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'contract_date')
         AND EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'maintenance_end_date')
      BEGIN
        DECLARE @legacyMigrateSql NVARCHAR(MAX) = N'
          INSERT INTO [dbo].[NileChat_MaintenanceContracts_byA] (contact_id, start_date, end_date, notes)
          SELECT id, contract_date, maintenance_end_date, N''تم ترحيله تلقائيًا من بيانات العميل القديمة''
          FROM [dbo].[NileChat_Contacts_byA]
          WHERE contract_date IS NOT NULL AND maintenance_end_date IS NOT NULL;';
        EXEC sp_executesql @legacyMigrateSql;
      END
    END
  `);

  // عمود "إيقاف العقد" — الأدمن/الأونر بس اللي يقدر يوقف عقد ساري (بدل ما يمسحه
  // نهائي ويفقد تاريخه). العقد الموقوف بيفضل في السجل لكن مبيتحسبش "ساري" تاني
  // حتى لو تاريخه لسه جوه المدة، وده اللي بيسمح بإضافة عقد جديد بعد كده. لازم
  // تكون ALTER في batch منفصل زي باقي الأعمدة المتأخرة في الملف ده عشان
  // "Invalid column name" وقت الـ compile
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_MaintenanceContracts_byA') AND name = 'stopped_at')
      ALTER TABLE [dbo].[NileChat_MaintenanceContracts_byA] ADD stopped_at DATETIME2 NULL;
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_MaintenanceContracts_byA') AND name = 'stopped_by')
      ALTER TABLE [dbo].[NileChat_MaintenanceContracts_byA] ADD stopped_by BIGINT NULL;
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_MaintenanceContracts_byA') AND name = 'stopped_by_name')
      ALTER TABLE [dbo].[NileChat_MaintenanceContracts_byA] ADD stopped_by_name NVARCHAR(200) NULL;
  `);

  // عمود "تم إرسال إشعار انتهاء العقد" — بيتسجل بمجرد ما رسالة أتمتة "العقد
  // منتهي" تتبعت للعميل ده، عشان قاعدة الأتمتة متبعتش نفس الرسالة أكتر من مرة
  // لنفس العقد (بتتفحص دوريًا من contractExpiry.service.js)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_MaintenanceContracts_byA') AND name = 'expiry_notice_sent_at')
      ALTER TABLE [dbo].[NileChat_MaintenanceContracts_byA] ADD expiry_notice_sent_at DATETIME2 NULL;
  `);
  logger.info('✅ جدول Maintenance Contracts جاهز.');
}

// الردود المحفوظة (Quick Replies / Canned Responses) — نصوص جاهزة الإيجنت بيدرجها بضغطة واحدة
async function ensureCannedResponsesTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_CannedResponses_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_CannedResponses_byA] (
        id           BIGINT IDENTITY(1,1) PRIMARY KEY,
        label        NVARCHAR(200) NOT NULL,
        message_text NVARCHAR(MAX) NOT NULL,
        created_by   BIGINT NULL,
        sort_order   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);

  // بنعمل ALTER في batch منفصل عن أي حاجة بتستخدم العمود ده — لو حطيناهم في نفس
  // الـ batch، SQL Server بيعمل compile للـ batch كله قبل التنفيذ فبيديني
  // "Invalid column name" لأنه لسه مايعرفش إن العمود اتضاف
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_CannedResponses_byA') AND name = 'sort_order')
      ALTER TABLE [dbo].[NileChat_CannedResponses_byA] ADD sort_order INT NULL;
  `);

  // أي صف لسه مالوش ترتيب (قديم من قبل الفيتشر ده) بناخد رقمه من ترتيب الإنشاء —
  // ده في batch تالت لوحده عشان يتأكد إن العمود بقى موجود فعليًا وقت التنفيذ
  await pool.request().query(`
    UPDATE t SET t.sort_order = src.rn
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
      FROM [dbo].[NileChat_CannedResponses_byA]
      WHERE sort_order IS NULL
    ) AS src
    JOIN [dbo].[NileChat_CannedResponses_byA] t ON t.id = src.id
  `);
  logger.info('✅ جدول Canned Responses جاهز.');
}

// تصنيفات المشاكل اللي بتظهر وقت عمل Resolve للمحادثة
async function ensureResolveCategoriesTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_ResolveCategories_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_ResolveCategories_byA] (
        id          BIGINT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(150) NOT NULL,
        icon        NVARCHAR(20)  NULL,
        description NVARCHAR(300) NULL,
        color       NVARCHAR(50)  NULL,
        created_by  BIGINT NULL,
        sort_order  INT NULL,
        created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NileChat_ResolveCategories_byA') AND name = 'sort_order')
      ALTER TABLE [dbo].[NileChat_ResolveCategories_byA] ADD sort_order INT NULL;
  `);

  await pool.request().query(`
    UPDATE t SET t.sort_order = src.rn
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
      FROM [dbo].[NileChat_ResolveCategories_byA]
      WHERE sort_order IS NULL
    ) AS src
    JOIN [dbo].[NileChat_ResolveCategories_byA] t ON t.id = src.id
  `);
  logger.info('✅ جدول Resolve Categories جاهز.');
}

// جدول الليبلز (Labels) — بتتعمل من صفحة الإعدادات أو من جوه كارت العميل نفسه،
// وبتتفلتر/تتعرض لكل الإيجنتس على المحادثة (زي فكرة Chatwoot Labels بالظبط)
async function ensureLabelsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Labels_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Labels_byA] (
        id          BIGINT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(100) NOT NULL,
        color       NVARCHAR(20)  NULL,
        description NVARCHAR(300) NULL,
        created_by  BIGINT NULL,
        created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);
  logger.info('✅ جدول Labels جاهز.');
}

// جدول الربط بين المحادثات والليبلز (many-to-many) — كل صف يعني إن الليبل ده
// متحط على المحادثة دي، ومحمي بـ UNIQUE عشان نفس الليبل ميتكررش على نفس المحادثة
async function ensureConversationLabelsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_ConversationLabels_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_ConversationLabels_byA] (
        id              BIGINT IDENTITY(1,1) PRIMARY KEY,
        conversation_id BIGINT NOT NULL,
        label_id        BIGINT NOT NULL,
        created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_NileChat_ConversationLabels_byA UNIQUE (conversation_id, label_id)
      );
      CREATE INDEX IX_NileChat_ConversationLabels_byA_conversation_id
        ON [dbo].[NileChat_ConversationLabels_byA](conversation_id);
    END
  `);
  logger.info('✅ جدول Conversation Labels جاهز.');
}

// جدول الشركات (Accounts) — كل شركة ليها كود مميز (خليط حروف/أرقام) واسم يتعرض
// في صفحة الإعدادات لكل الإيجنتس اللي تابعين لها. أول شركة بتتعمل تلقائيًا هي
// "Nile Techno Support" (أول عميل استخدم النظام)، وأي يوزر جديد من غيرها بيتربط
// بيها تلقائيًا لحد ما نضيف واجهة فعلية لإنشاء/اختيار شركات تانية.
async function ensureCompaniesTableExists() {
  const pool = await getPool();
  const existsResult = await pool.request().query(`
    SELECT CASE WHEN EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Companies_byA') THEN 1 ELSE 0 END AS tableExists
  `);
  const alreadyExists = Boolean(existsResult.recordset[0].tableExists);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Companies_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Companies_byA] (
        id                BIGINT IDENTITY(1,1) PRIMARY KEY,
        name              NVARCHAR(200) NOT NULL,
        code              NVARCHAR(50)  NOT NULL UNIQUE,
        auto_resolve_days INT           NULL,
        created_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);

  // أول مرة يتعمل فيها الجدول بس، بنزرع أول شركة (Nile Techno Support) بكود
  // عشوائي خليط حروف وأرقام — نفس فكرة أي حساب أول (Owner Account) بيتعمل تلقائي
  if (!alreadyExists) {
    const code = generateCompanyCode();
    await pool
      .request()
      .input('name', sql.NVarChar(200), 'Nile Techno Support')
      .input('code', sql.NVarChar(50), code)
      .input('autoResolveDays', sql.Int, 7)
      .query(`
        INSERT INTO [dbo].[NileChat_Companies_byA] (name, code, auto_resolve_days)
        VALUES (@name, @code, @autoResolveDays)
      `);
    logger.info(`✅ اتزرعت أول شركة (Nile Techno Support) بكود: ${code}`);
  }
  logger.info('✅ جدول Companies جاهز.');
}

// كود الشركة: خليط حروف كبيرة وأرقام (10 خانات) عشان يبقى فريد وسهل التوزيع
// على الإيجنتس الجداد وقت التسجيل (زي "NTX7K2Q9PL")
function generateCompanyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // من غير حروف/أرقام بتتلخبط بصريًا (O/0, I/1)
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// أي يوزر قديم أو جديد لسه ملوش company_id (لسه معملهوش ربط بشركة)، بنربطه
// تلقائيًا بأول شركة موجودة في النظام (Nile Techno Support) — لحد ما يتعمل
// فعليًا فلو multi-company كامل (اختيار/إنشاء شركة وقت التسجيل)
async function ensureUsersHaveCompanyAssigned() {
  const pool = await getPool();
  await pool.request().query(`
    IF EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Companies_byA')
       AND EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Users_byA')
    BEGIN
      DECLARE @firstCompanyId BIGINT = (SELECT TOP 1 id FROM [dbo].[NileChat_Companies_byA] ORDER BY id ASC);
      DECLARE @firstCompanyCode NVARCHAR(50) = (SELECT TOP 1 code FROM [dbo].[NileChat_Companies_byA] ORDER BY id ASC);
      IF @firstCompanyId IS NOT NULL
      BEGIN
        UPDATE [dbo].[NileChat_Users_byA]
        SET company_id = @firstCompanyId,
            company_code = COALESCE(company_code, @firstCompanyCode)
        WHERE company_id IS NULL;
      END
    END
  `);
}

// أعمدة صفحة البروفايل الشخصي: الاسم الكامل، صورة البروفايل، تفضيلات
// الإشعارات (JSON)، وتوكن الوصول الشخصي (Access Token) لأي تكامل عن طريق الـ API
async function ensureUsersHaveProfileColumns() {
  const pool = await getPool();
  const columns = [
    { name: 'full_name', def: 'NVARCHAR(200) NULL' },
    { name: 'avatar_url', def: 'NVARCHAR(500) NULL' },
    { name: 'notification_prefs', def: 'NVARCHAR(MAX) NULL' },
    { name: 'access_token', def: 'NVARCHAR(200) NULL' },
  ];
  for (const col of columns) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.NileChat_Users_byA') AND name = '${col.name}'
      )
      BEGIN
        ALTER TABLE [dbo].[NileChat_Users_byA] ADD ${col.name} ${col.def};
      END
    `);
  }
  logger.info('✅ أعمدة صفحة البروفايل (full_name/avatar_url/notification_prefs/access_token) جاهزة.');
}

// جدول التيمز (Teams) — بيتجمع فيه شوية إيجنتس تحت مسمى واحد لتسهيل التوزيع
// (زي "Tech Support" أو "Billing")، وكل تيم ليه استراتيجية توزيع اختيارية
async function ensureTeamsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Teams_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Teams_byA] (
        id                BIGINT IDENTITY(1,1) PRIMARY KEY,
        name              NVARCHAR(150) NOT NULL,
        description       NVARCHAR(300) NULL,
        icon              NVARCHAR(50)  NOT NULL DEFAULT 'users-round',
        color             NVARCHAR(20)  NOT NULL DEFAULT '#6C5CE7',
        routing_strategy  NVARCHAR(20)  NOT NULL DEFAULT 'manual',
        created_by        BIGINT NULL,
        created_at        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);
  logger.info('✅ جدول Teams جاهز.');
}

// جدول الربط بين التيمز والإيجنتس (many-to-many) — نفس فكرة NileChat_InboxAgents_byA بالظبط
async function ensureTeamMembersTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_TeamMembers_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_TeamMembers_byA] (
        id         BIGINT IDENTITY(1,1) PRIMARY KEY,
        team_id    BIGINT NOT NULL,
        user_id    BIGINT NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_NileChat_TeamMembers_byA UNIQUE (team_id, user_id)
      );
      CREATE INDEX IX_NileChat_TeamMembers_byA_team_id
        ON [dbo].[NileChat_TeamMembers_byA](team_id);
    END
  `);
  logger.info('✅ جدول Team Members جاهز.');
}

// جدول الربط بين المحادثات والتيمز (many-to-many) — نفس فكرة
// NileChat_ConversationLabels_byA بالظبط، بس للتيمز بدل الليبلز
async function ensureConversationTeamsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_ConversationTeams_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_ConversationTeams_byA] (
        id              BIGINT IDENTITY(1,1) PRIMARY KEY,
        conversation_id BIGINT NOT NULL,
        team_id         BIGINT NOT NULL,
        created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_NileChat_ConversationTeams_byA UNIQUE (conversation_id, team_id)
      );
      CREATE INDEX IX_NileChat_ConversationTeams_byA_conversation_id
        ON [dbo].[NileChat_ConversationTeams_byA](conversation_id);
    END
  `);
  logger.info('✅ جدول Conversation Teams جاهز.');
}

// إعدادات الأتمتة (Automation) بتاعة الشركة: تعيين تلقائي لإيجنت معين على أي
// محادثة جديدة، رسالة ترحيب ثابتة تتبعت أول ما محادثة جديدة تتفتح، ورسالة
// CSAT تتبعت للعميل بمجرد ما المحادثة تتعمللها Resolve — كل واحدة ليها toggle
// مستقل ونص قابل للتعديل من صفحة الإعدادات
async function ensureCompaniesHaveAutomationColumns() {
  const pool = await getPool();
  const columns = [
    { name: 'automation_auto_assign_enabled', def: 'BIT NOT NULL DEFAULT 0' },
    { name: 'automation_auto_assign_agent_id', def: 'BIGINT NULL' },
    { name: 'automation_welcome_enabled', def: 'BIT NOT NULL DEFAULT 0' },
    { name: 'automation_welcome_message', def: 'NVARCHAR(MAX) NULL' },
    // جدول رسالة الترحيب: لو مفعّل، بيبقى في رسالتين بدل واحدة — رسالة أثناء
    // أوقات العمل (automation_welcome_message) ورسالة تانية برا أوقات العمل
    // (automation_welcome_offhours_message)، والجدول نفسه (أيام + ساعات لكل
    // يوم + التايم زون) متخزن كـ JSON في automation_welcome_schedule
    { name: 'automation_welcome_schedule_enabled', def: 'BIT NOT NULL DEFAULT 0' },
    { name: 'automation_welcome_offhours_message', def: 'NVARCHAR(MAX) NULL' },
    { name: 'automation_welcome_schedule', def: 'NVARCHAR(MAX) NULL' },
    { name: 'automation_csat_enabled', def: 'BIT NOT NULL DEFAULT 0' },
    { name: 'automation_csat_message', def: 'NVARCHAR(MAX) NULL' },
    // توجيه بالكلمات المفتاحية (Keyword Routing): لو أي رسالة جاية من العميل
    // فيها واحدة (أو أكتر) من الكلمات دي، المحادثة بتتحول أوتوماتيك لتيم معين.
    // الكلمات نفسها متخزنة كـ JSON array من النصوص في automation_keyword_routing_keywords
    { name: 'automation_keyword_routing_enabled', def: 'BIT NOT NULL DEFAULT 0' },
    // كل قاعدة = { team_id, keywords: [...] } — بيتخزنوا كـ JSON array واحد،
    // عشان تقدر تعمل أكتر من قاعدة: كل مجموعة كلمات بتوجه لتيم مختلف
    { name: 'automation_keyword_routing_rules', def: 'NVARCHAR(MAX) NULL' },
    // "عقد الصيانة منتهي": رسالة تتبعت أوتوماتيك (مرة واحدة بس لكل عقد) لأي
    // عميل عقده عدّى تاريخ نهايته من غير ما يتجدد — النص قابل للتعديل من صفحة
    // الإعدادات (contractExpiry.service.js هو اللي بيفحص وبيبعت)
    { name: 'automation_contract_expired_enabled', def: 'BIT NOT NULL DEFAULT 0' },
    { name: 'automation_contract_expired_message', def: 'NVARCHAR(MAX) NULL' },
    // نفس الرسالة فوق، بس مفتاح تفعيل مستقل تمامًا: ده بيتحكم في "رد تلقائي
    // على كل رسالة" (applyContractExpiryReplyForMessage في conversation.service.js)
    // بدل "إشعار مرة واحدة بس" (contractExpiry.service.js) اللي بيتحكم فيه
    // automation_contract_expired_enabled فوق — الاتنين مستقلين عن بعض تمامًا
    { name: 'automation_contract_expired_repeat_enabled', def: 'BIT NOT NULL DEFAULT 0' },
    // "تقييم بعد الحل" (Post-Resolve Rating): بمجرد ما محادثة تتقفل (Resolve)،
    // بيتبعت للعميل بالترتيب: تقييم نجوم (1-5) لحل المشكلة، تقييم نجوم (1-5)
    // لممثل خدمة العملاء، وبعدين تقييم نصي اختياري — كل رسالة من التلاتة ليها
    // نص افتراضي لو الحقل فاضي (شايفينه في ratingFlow.service.js)
    { name: 'automation_rating_enabled', def: 'BIT NOT NULL DEFAULT 0' },
    { name: 'automation_rating_issue_message', def: 'NVARCHAR(MAX) NULL' },
    { name: 'automation_rating_agent_message', def: 'NVARCHAR(MAX) NULL' },
    { name: 'automation_rating_feedback_message', def: 'NVARCHAR(MAX) NULL' },
    { name: 'automation_rating_thanks_message', def: 'NVARCHAR(MAX) NULL' },
  ];
  for (const col of columns) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.NileChat_Companies_byA') AND name = '${col.name}'
      )
      BEGIN
        ALTER TABLE [dbo].[NileChat_Companies_byA] ADD ${col.name} ${col.def};
      END
    `);
  }
  logger.info('✅ أعمدة إعدادات الأتمتة (Automation) جاهزة على جدول Companies.');
}

// جدول تقييمات ما بعد الحل (Post-Resolve Ratings): صف واحد بيتفتح لكل محادثة
// اتقفلت وقاعدة "تقييم بعد الحل" مفعّلة، وبيتحدّث خطوة بخطوة (stage) لحد ما
// العميل يخلص التلات خطوات (تقييم الحل -> تقييم الإيجنت -> تعليق نصي اختياري)
// أو يسيب الفلو من غير ما يكمل (بيفضل الصف بحالته الأخيرة، مش بيتمسح)
async function ensureConversationRatingsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_ConversationRatings_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_ConversationRatings_byA] (
        id              BIGINT IDENTITY(1,1) PRIMARY KEY,
        conversation_id BIGINT NOT NULL,
        contact_id      BIGINT NULL,
        contact_number  NVARCHAR(30) NOT NULL,
        inbox_id        BIGINT NULL,
        agent_id        BIGINT NULL,
        agent_name      NVARCHAR(200) NULL,
        stage           NVARCHAR(30) NOT NULL DEFAULT 'awaiting_issue_rating',
        issue_rating    INT NULL,
        agent_rating    INT NULL,
        feedback_text   NVARCHAR(MAX) NULL,
        created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        completed_at    DATETIME2 NULL
      );
      CREATE INDEX IX_NileChat_ConversationRatings_byA_contact_number
        ON [dbo].[NileChat_ConversationRatings_byA](contact_number, stage);
      CREATE INDEX IX_NileChat_ConversationRatings_byA_conversation_id
        ON [dbo].[NileChat_ConversationRatings_byA](conversation_id);
    END
  `);
  logger.info('✅ جدول Conversation Ratings (تقييم بعد الحل) جاهز.');
}

// جدول الـ Webhooks الصادرة (Outbound): اليوزر بيسجّل URL بتاعه، واحنا بنبعتله
// طلب POST فيه تفاصيل الحدث (رسالة جديدة، رد، Resolve...) لحظة حصوله فعليًا،
// موقّع بتوقيع HMAC-SHA256 عشان يتأكد إن الطلب جاي منا فعلاً
async function ensureWebhooksTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Webhooks_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Webhooks_byA] (
        id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
        company_id         BIGINT NOT NULL,
        url                NVARCHAR(1000) NOT NULL,
        secret             NVARCHAR(200) NOT NULL,
        events             NVARCHAR(MAX) NOT NULL,
        enabled            BIT NOT NULL DEFAULT 1,
        created_by         BIGINT NULL,
        created_at         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        last_triggered_at  DATETIME2 NULL,
        last_status_code   INT NULL,
        last_error         NVARCHAR(500) NULL
      );
      CREATE INDEX IX_NileChat_Webhooks_byA_company_id
        ON [dbo].[NileChat_Webhooks_byA](company_id);
    END
  `);
  logger.info('✅ جدول الـ Webhooks الصادرة جاهز.');
}

// جدول الإشعارات — كل إشعار (In-App / Push) بيتخزن هنا لكل يوزر لوحده،
// عمود status: 1 = جديد/لسه ملقوش، 0 = مقروء. النوع (type) بيحدد شكل الإشعار:
// conversation_created / conversation_assigned / conversation_mention /
// assigned_conversation_message / participating_conversation_message /
// login (تسجيل دخول) / activity (نشاط عام: رد جديد أو تغيير في الإعدادات، بيوصل للكل)
async function ensureNotificationsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NileChat_Notifications_byA')
    BEGIN
      CREATE TABLE [dbo].[NileChat_Notifications_byA] (
        id              BIGINT IDENTITY(1,1) PRIMARY KEY,
        user_id         BIGINT NOT NULL,
        type            NVARCHAR(50) NOT NULL,
        title           NVARCHAR(300) NULL,
        message         NVARCHAR(MAX) NULL,
        reference_id    BIGINT NULL,
        status          INT NOT NULL DEFAULT 1,
        actor_id        BIGINT NULL,
        actor_name      NVARCHAR(200) NULL,
        created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_NileChat_Notifications_byA_user_id
        ON [dbo].[NileChat_Notifications_byA](user_id, created_at DESC);
    END
  `);
  logger.info('✅ جدول الإشعارات (Notifications) جاهز.');
}

// ===== External Provider Bridge (تكامل شات ووت وأي مصدر خارجي مستقبلًا) =====
// كل الجداول دي جديدة بالكامل، صفر تعديل على أي جدول أو عمود موجود في نايل
// شات. الربط بالموجود بيتم بس عن طريق FK بيقرا (REFERENCES) من الجداول القديمة،
// مفيش ولا ALTER TABLE واحد على حاجة قديمة. عمود nile_contact_id/nile_user_id/
// nile_conversation_id بيفضل NULL افتراضيًا لكل صف جديد جاي من الخارج — وبيتحدد
// بس لما حد يعمل "ميرج" صريح (لعميل أو لإيجنت) لحد موجود بالفعل في نايل شات
// (شوف mergeContactToNileContact/mergeAgentToNileUser في الـ repos بتاعتهم).
async function ensureExternalProviderTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'External_Provider_byA')
    BEGIN
      CREATE TABLE [dbo].[External_Provider_byA] (
        id                     BIGINT IDENTITY(1,1) PRIMARY KEY,
        name                   NVARCHAR(100)  NOT NULL,
        company_id             BIGINT         NOT NULL,
        base_url               NVARCHAR(500)  NOT NULL,
        account_id             NVARCHAR(100)  NOT NULL,
        inbox_id_on_provider   NVARCHAR(100)  NULL,
        api_access_token       NVARCHAR(500)  NOT NULL,
        webhook_secret         NVARCHAR(200)  NULL,
        is_active              BIT            NOT NULL DEFAULT 1,
        created_at             DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT FK_ExternalProvider_Company
          FOREIGN KEY (company_id) REFERENCES [dbo].[NileChat_Companies_byA](id)
      );
      CREATE INDEX IX_ExternalProvider_byA_company_id
        ON [dbo].[External_Provider_byA](company_id);
    END
  `);
  logger.info('✅ جدول External_Provider_byA جاهز.');
}

async function ensureExternalAgentTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'External_Agent_byA')
    BEGIN
      CREATE TABLE [dbo].[External_Agent_byA] (
        id                   BIGINT IDENTITY(1,1) PRIMARY KEY,
        provider_id          BIGINT         NOT NULL,
        external_agent_id    NVARCHAR(100)  NOT NULL,
        nile_user_id         BIGINT         NULL,
        name                 NVARCHAR(200)  NULL,
        created_at           DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT FK_ExternalAgent_Provider
          FOREIGN KEY (provider_id) REFERENCES [dbo].[External_Provider_byA](id),
        CONSTRAINT FK_ExternalAgent_NileUser
          FOREIGN KEY (nile_user_id) REFERENCES [dbo].[NileChat_Users_byA](id),
        CONSTRAINT UQ_ExternalAgent_ProviderExternalId
          UNIQUE (provider_id, external_agent_id)
      );
    END
  `);
  logger.info('✅ جدول External_Agent_byA جاهز.');
}

async function ensureExternalAgentTokenColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.External_Agent_byA') AND name = 'agent_api_access_token'
    )
    BEGIN
      ALTER TABLE [dbo].[External_Agent_byA] ADD agent_api_access_token NVARCHAR(500) NULL;
    END
  `);
  logger.info('✅ عمود agent_api_access_token على External_Agent_byA جاهز.');
}

async function ensureExternalContactsTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'External_Contacts_byA')
    BEGIN
      CREATE TABLE [dbo].[External_Contacts_byA] (
        id                     BIGINT IDENTITY(1,1) PRIMARY KEY,
        provider_id            BIGINT         NOT NULL,
        external_contact_id    NVARCHAR(100)  NOT NULL,
        nile_contact_id        BIGINT         NULL,
        name                   NVARCHAR(200)  NULL,
        phone                  NVARCHAR(50)   NULL,
        raw_json               NVARCHAR(MAX)  NULL,
        created_at             DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at             DATETIME2      NULL,

        CONSTRAINT FK_ExternalContacts_Provider
          FOREIGN KEY (provider_id) REFERENCES [dbo].[External_Provider_byA](id),
        CONSTRAINT FK_ExternalContacts_NileContact
          FOREIGN KEY (nile_contact_id) REFERENCES [dbo].[NileChat_Contacts_byA](id),
        CONSTRAINT UQ_ExternalContacts_ProviderExternalId
          UNIQUE (provider_id, external_contact_id)
      );
      CREATE INDEX IX_ExternalContacts_byA_phone
        ON [dbo].[External_Contacts_byA](phone);
    END
  `);
  logger.info('✅ جدول External_Contacts_byA جاهز.');
}

async function ensureExternalConversationTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'External_Conversation_byA')
    BEGIN
      CREATE TABLE [dbo].[External_Conversation_byA] (
        id                         BIGINT IDENTITY(1,1) PRIMARY KEY,
        provider_id                BIGINT         NOT NULL,
        external_conversation_id   NVARCHAR(100)  NOT NULL,
        nile_conversation_id       BIGINT         NULL,
        external_contact_row_id    BIGINT         NULL,
        status                     NVARCHAR(50)   NULL,
        raw_json                   NVARCHAR(MAX)  NULL,
        created_at                 DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at                 DATETIME2      NULL,

        CONSTRAINT FK_ExternalConversation_Provider
          FOREIGN KEY (provider_id) REFERENCES [dbo].[External_Provider_byA](id),
        CONSTRAINT FK_ExternalConversation_NileConversation
          FOREIGN KEY (nile_conversation_id) REFERENCES [dbo].[NileChat_Conversations_byA](id),
        CONSTRAINT FK_ExternalConversation_ExternalContact
          FOREIGN KEY (external_contact_row_id) REFERENCES [dbo].[External_Contacts_byA](id),
        CONSTRAINT UQ_ExternalConversation_ProviderExternalId
          UNIQUE (provider_id, external_conversation_id)
      );
    END
  `);
  logger.info('✅ جدول External_Conversation_byA جاهز.');
}

async function ensureExternalEventTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'External_Event_byA')
    BEGIN
      CREATE TABLE [dbo].[External_Event_byA] (
        id                   BIGINT IDENTITY(1,1) PRIMARY KEY,
        provider_id          BIGINT         NOT NULL,
        event_type           NVARCHAR(100)  NOT NULL,
        external_event_id    NVARCHAR(200)  NULL,
        payload              NVARCHAR(MAX)  NOT NULL,
        status               NVARCHAR(20)   NOT NULL DEFAULT 'pending',
        retry_count          INT            NOT NULL DEFAULT 0,
        error_message        NVARCHAR(MAX)  NULL,
        created_at           DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        processed_at         DATETIME2      NULL,

        CONSTRAINT FK_ExternalEvent_Provider
          FOREIGN KEY (provider_id) REFERENCES [dbo].[External_Provider_byA](id)
      );
      CREATE UNIQUE INDEX UQ_ExternalEvent_ProviderExternalId
        ON [dbo].[External_Event_byA](provider_id, external_event_id)
        WHERE external_event_id IS NOT NULL;
      CREATE INDEX IX_ExternalEvent_byA_status
        ON [dbo].[External_Event_byA](status);
    END
  `);
  logger.info('✅ جدول External_Event_byA جاهز.');
}

async function ensureExternalMessagesTableExists() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'External_Messages_byA')
    BEGIN
      CREATE TABLE [dbo].[External_Messages_byA] (
        id                            BIGINT IDENTITY(1,1) PRIMARY KEY,
        provider_id                    BIGINT         NOT NULL,
        external_message_id            NVARCHAR(100)  NOT NULL,
        external_conversation_row_id   BIGINT         NOT NULL,
        nile_message_id                 BIGINT        NULL,
        direction                       NVARCHAR(10)  NOT NULL,
        message_type                    NVARCHAR(30)  NULL,
        raw_json                        NVARCHAR(MAX) NULL,
        created_at                      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT FK_ExternalMessages_Provider
          FOREIGN KEY (provider_id) REFERENCES [dbo].[External_Provider_byA](id),
        CONSTRAINT FK_ExternalMessages_ExternalConversation
          FOREIGN KEY (external_conversation_row_id) REFERENCES [dbo].[External_Conversation_byA](id),
        CONSTRAINT UQ_ExternalMessages_ProviderExternalId
          UNIQUE (provider_id, external_message_id)
        -- مفيش FK على nile_message_id لإن اسم جدول الرسايل نفسه ديناميكي (من
        -- env.DB_TABLE_NAME)، الربط بيتعمل على مستوى الـ repository في الكود
      );
      CREATE INDEX IX_ExternalMessages_byA_nile_message_id
        ON [dbo].[External_Messages_byA](nile_message_id);
    END
  `);
  logger.info('✅ جدول External_Messages_byA جاهز.');
}

// ===== Multi-company: كل جدول بيانات رئيسي بيتربط بـ company_id بتاع الشركة
// اللي بيمتلك الصف ده. الهدف: كل بيانات كل شركة تفضل معزولة تمامًا عن أي
// شركة تانية بمجرد ما كل استعلام (SELECT/INSERT/UPDATE) في الـ repositories
// يتفلتر بـ company_id بتاع اليوزر الداخل (شوف middleware/auth.js وطريقة
// استخدام req.companyId في كل repo). لو حبينا نضيف شركة جديدة في المستقبل،
// نفس الجداول دي هتستوعبها من غير أي تعديل تاني — بس نضيف صف في
// NileChat_Companies_byA وكود مختلف، وكل بيانات الشركة الجديدة هتتخزن وتتفلتر
// تلقائيًا بنفس الآلية.
const COMPANY_ID_TABLES = [
  'NileChat_Conversations_byA',
  'NileChat_Contacts_byA',
  'NileChat_Inboxes_byA',
  'NileChat_Devices_byA',
  'NileChat_ScheduledTasks_byA',
  'NileChat_Visits_byA',
  'NileChat_MaintenanceContracts_byA',
  'NileChat_CannedResponses_byA',
  'NileChat_ResolveCategories_byA',
  'NileChat_Labels_byA',
  'NileChat_Teams_byA',
  'NileChat_Notifications_byA',
  'NileChat_ConversationRatings_byA',
  // جداول فرعية/ربط (child/join tables) — طلب المستخدم صراحةً إنها تاخد نفس
  // المعاملة بالظبط، عشان لو شركة جديدة اتضافت تلاقي كل حاجة فاضية تمامًا
  // وتبدأ من الأول على مزاجها في كل جدول من غير أي بيانات قديمة تفضل شايفاها
  'NileChat_ContactBranches_byA',
  'NileChat_ContactModules_byA',
  'NileChat_ContactPhones_byA',
  'NileChat_ConversationLabels_byA',
  'NileChat_ConversationTeams_byA',
  'NileChat_InboxAgents_byA',
  'NileChat_TeamMembers_byA',
  TABLE_NAME, // جدول الرسايل نفسه (وارد اسمه من env.DB_TABLE_NAME)
];

async function ensureCompanyIdColumns() {
  const pool = await getPool();
  for (const table of COMPANY_ID_TABLES) {
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.tables WHERE name = '${table}')
         AND NOT EXISTS (
           SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.${table}') AND name = 'company_id'
         )
      BEGIN
        ALTER TABLE [dbo].[${table}] ADD company_id BIGINT NULL;
      END
    `);
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.tables WHERE name = '${table}')
         AND EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.${table}') AND name = 'company_id')
         AND NOT EXISTS (
           SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.${table}') AND name = 'IX_${table}_company_id'
         )
      BEGIN
        CREATE INDEX IX_${table}_company_id ON [dbo].[${table}](company_id);
      END
    `);
    // عمود company_code جمب company_id مباشرة — نفس عمود code بتاع
    // NileChat_Companies_byA، بس منسوخ هنا كـ نص جاهز للقراءة/الفلترة/التصدير
    // السريع من غير ما تحتاج تعمل JOIN مع جدول الشركات كل مرة. زي company_id
    // بالظبط، بيتضاف فاضي (NULL) من غير أي تعبئة تلقائية.
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.tables WHERE name = '${table}')
         AND NOT EXISTS (
           SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.${table}') AND name = 'company_code'
         )
      BEGIN
        ALTER TABLE [dbo].[${table}] ADD company_code NVARCHAR(50) NULL;
      END
    `);
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.tables WHERE name = '${table}')
         AND EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.${table}') AND name = 'company_code')
         AND NOT EXISTS (
           SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.${table}') AND name = 'IX_${table}_company_code'
         )
      BEGIN
        CREATE INDEX IX_${table}_company_code ON [dbo].[${table}](company_code);
      END
    `);
  }
  logger.info('✅ عمودَي company_id و company_code متاحين (مع إندكس) على كل الجداول الرئيسية.');
}

// أي صف قديم (من قبل ما تتعمل الهجرة دي) لسه ملوش company_id، بنربطه تلقائيًا
// بأول شركة موجودة في النظام — بالظبط نفس فكرة ensureUsersHaveCompanyAssigned
// بس على باقي الجداول كلها. أي صف جديد بعد كده هيتسجل بـ company_id فعلي من
// أول لحظة (شوف كل repo.js بيبعت companyId في الإدراج)
async function ensureExistingRowsHaveCompanyAssigned() {
  const pool = await getPool();
  const firstCompanyResult = await pool.request().query(`
    SELECT TOP 1 id FROM [dbo].[NileChat_Companies_byA] ORDER BY id ASC
  `);
  const firstCompanyId = firstCompanyResult.recordset[0]?.id;
  if (!firstCompanyId) return;

  for (const table of COMPANY_ID_TABLES) {
    await pool
      .request()
      .input('companyId', sql.BigInt, firstCompanyId)
      .query(`
        IF EXISTS (SELECT * FROM sys.tables WHERE name = '${table}')
        BEGIN
          UPDATE [dbo].[${table}] SET company_id = @companyId WHERE company_id IS NULL;
        END
      `);
  }
  logger.info('✅ كل الصفوف القديمة اتربطت بأول شركة في النظام (Backfill company_id).');
}

async function ensureSchema() {
  await ensureTableExists();
  await ensureConversationsTableExists();
  await ensureAgentsTableExists();
  await ensureUsersTableExists();
  await ensureMessagesHaveConversationColumn();
  await ensureMessagesHaveSenderColumns();
  await ensureMessagesHaveMediaColumns();
  await ensureMessagesHavePostResolveColumn();
  await ensureMessagesHaveIndexes();
  await ensureInboxesTableExists();
  await ensureInboxesHaveExtraColumns();
  await ensureInboxAgentsTableExists();
  await ensureConversationsHaveInboxColumn();
  await ensureConversationsHaveResolveColumns();
  await ensureConversationsHaveLockColumn();
  await ensureContactsTableExists();
  // لازم تتنفذ هنا، قبل ensureContactsHaveCustomerCardColumns تحت — لإن الدالة
  // دي بتترحّل بيانات عقود قديمة من عمودين contract_date/maintenance_end_date
  // على الكونتاكت، وensureContactsHaveCustomerCardColumns بتمسح العمودين دول.
  // لو اتنفذت بعدها كانت هتفشل بـ "Invalid column name 'maintenance_end_date'"
  // لإن العمودين مش هيبقوا موجودين وقت التشغيل
  await ensureMaintenanceContractsTableExists();
  await ensureContactsHaveCustomerCardColumns();
  await ensureContactsHaveStatusColumn();
  await ensureContactsHaveVipInactiveColumns();
  await ensureContactPhonesTableExists();
  await ensureContactPhonesHaveLabelColumn();
  await ensureContactModulesTableExists();
  await ensureContactBranchesTableExists();
  await ensureConversationsHaveContactColumn();
  await ensureDevicesTableExists();
  await ensureScheduledTasksTableExists();
  await ensureVisitsTableExists();
  await ensureCannedResponsesTableExists();
  await ensureResolveCategoriesTableExists();
  await ensureLabelsTableExists();
  await ensureConversationLabelsTableExists();
  await ensureCompaniesTableExists();
  await ensureUsersHaveCompanyAssigned();
  await ensureUsersHaveProfileColumns();
  await ensureCompaniesHaveAutomationColumns();
  await ensureConversationRatingsTableExists();
  await ensureTeamsTableExists();
  await ensureTeamMembersTableExists();
  await ensureConversationTeamsTableExists();
  await ensureWebhooksTableExists();
  await ensureNotificationsTableExists();
  await ensureCompanyIdColumns();
  // من غير باك فيل تلقائي بطلب المستخدم — العمود بيتضاف بس فاضي (NULL)، وهو
  // اللي هيملاه بنفسه يدوي. الدالة ensureExistingRowsHaveCompanyAssigned لسه
  // موجودة تحت ومصدّرة لو حبيت تستخدمها بنفسك بعدين وقت ما تحب.

  // External Provider Bridge (شات ووت وأي مصدر خارجي مستقبلًا) — جداول جديدة
  // بالكامل، بيتم إنشاؤها مرة واحدة بس (أول ديبلوي)؛ أي ديبلوي بعد كده الـ
  // IF NOT EXISTS بيلاقيها موجودة خلاص فمش بيعمل حاجة، نفس فلسفة باقي الجداول فوق
  await ensureExternalProviderTableExists();
  await ensureExternalAgentTableExists();
  await ensureExternalAgentTokenColumn();
  await ensureExternalContactsTableExists();
  await ensureExternalConversationTableExists();
  await ensureExternalEventTableExists();
  await ensureExternalMessagesTableExists();
}

module.exports = {
  sql,
  getPool,
  getPoolMetrics,
  ensureTableExists,
  ensureConversationsTableExists,
  ensureAgentsTableExists,
  ensureUsersTableExists,
  ensureMessagesHaveConversationColumn,
  ensureMessagesHaveSenderColumns,
  ensureMessagesHaveIndexes,
  ensureMessagesHaveMediaColumns,
  ensureMessagesHavePostResolveColumn,
  ensureInboxesTableExists,
  ensureInboxesHaveExtraColumns,
  ensureInboxAgentsTableExists,
  ensureConversationsHaveInboxColumn,
  ensureConversationsHaveResolveColumns,
  ensureConversationsHaveLockColumn,
  ensureContactsTableExists,
  ensureContactsHaveCustomerCardColumns,
  ensureContactsHaveStatusColumn,
  ensureContactsHaveVipInactiveColumns,
  ensureContactPhonesTableExists,
  ensureContactPhonesHaveLabelColumn,
  ensureContactBranchesTableExists,
  ensureConversationsHaveContactColumn,
  ensureDevicesTableExists,
  ensureScheduledTasksTableExists,
  ensureVisitsTableExists,
  ensureMaintenanceContractsTableExists,
  ensureCannedResponsesTableExists,
  ensureResolveCategoriesTableExists,
  ensureLabelsTableExists,
  ensureConversationLabelsTableExists,
  ensureCompaniesTableExists,
  ensureUsersHaveCompanyAssigned,
  ensureUsersHaveProfileColumns,
  ensureCompaniesHaveAutomationColumns,
  ensureConversationRatingsTableExists,
  generateCompanyCode,
  ensureTeamsTableExists,
  ensureTeamMembersTableExists,
  ensureConversationTeamsTableExists,
  ensureWebhooksTableExists,
  ensureNotificationsTableExists,
  ensureCompanyIdColumns,
  ensureExistingRowsHaveCompanyAssigned,
  ensureExternalProviderTableExists,
  ensureExternalAgentTableExists,
  ensureExternalAgentTokenColumn,
  ensureExternalContactsTableExists,
  ensureExternalConversationTableExists,
  ensureExternalEventTableExists,
  ensureExternalMessagesTableExists,
  ensureSchema,
  TABLE_NAME,
};
