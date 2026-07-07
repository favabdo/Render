const sql = require('mssql');
const env = require('./env');
const logger = require('../utils/logger');

const TABLE_NAME = env.DB_TABLE_NAME;

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
    max: 10,
    min: 1, // فضّينا كونكشن واحد سخن دايمًا، عشان أول ريكوست بعد فترة سكون معملهاش
            // reconnect جديد لـ SQL Server (كان بيضيف مئات المللي ثانية زيادة)
    idleTimeoutMillis: 30000,
  },
};

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        logger.info('✅ متصل بنجاح بقاعدة بيانات SQL Server:', env.DB.database);
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
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
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

// لو رقم العميل بقى ليه أكتر من رقم على نفس الكونتاكت، بنسمح للإيجنت يحط "ليبل"
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
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
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
        created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);
  logger.info('✅ جدول Resolve Categories جاهز.');
}

async function ensureSchema() {
  await ensureTableExists();
  await ensureConversationsTableExists();
  await ensureAgentsTableExists();
  await ensureUsersTableExists();
  await ensureMessagesHaveConversationColumn();
  await ensureMessagesHaveSenderColumns();
  await ensureInboxesTableExists();
  await ensureInboxesHaveExtraColumns();
  await ensureInboxAgentsTableExists();
  await ensureConversationsHaveInboxColumn();
  await ensureConversationsHaveResolveColumns();
  await ensureContactsTableExists();
  await ensureContactPhonesTableExists();
  await ensureContactPhonesHaveLabelColumn();
  await ensureConversationsHaveContactColumn();
  await ensureCannedResponsesTableExists();
  await ensureResolveCategoriesTableExists();
}

module.exports = {
  sql,
  getPool,
  ensureTableExists,
  ensureConversationsTableExists,
  ensureAgentsTableExists,
  ensureUsersTableExists,
  ensureMessagesHaveConversationColumn,
  ensureMessagesHaveSenderColumns,
  ensureInboxesTableExists,
  ensureInboxesHaveExtraColumns,
  ensureInboxAgentsTableExists,
  ensureConversationsHaveInboxColumn,
  ensureConversationsHaveResolveColumns,
  ensureContactsTableExists,
  ensureContactPhonesTableExists,
  ensureContactPhonesHaveLabelColumn,
  ensureConversationsHaveContactColumn,
  ensureCannedResponsesTableExists,
  ensureResolveCategoriesTableExists,
  ensureSchema,
  TABLE_NAME,
};
