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
      WHERE object_id = OBJECT_ID('dbo.NileChat_Contacts_byA') AND name = 'contract_date'
    )
    BEGIN
      ALTER TABLE [dbo].[NileChat_Contacts_byA] DROP COLUMN contract_date;
    END

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
      -- (عمودين contract_date/maintenance_end_date على الكونتاكت) بياخد أول صف
      -- في سجل العقود الجديد، عشان تاريخه القديم ميتلغيش
      INSERT INTO [dbo].[NileChat_MaintenanceContracts_byA] (contact_id, start_date, end_date, notes)
      SELECT id, contract_date, maintenance_end_date, N'تم ترحيله تلقائيًا من بيانات العميل القديمة'
      FROM [dbo].[NileChat_Contacts_byA]
      WHERE contract_date IS NOT NULL AND maintenance_end_date IS NOT NULL;
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

async function ensureSchema() {
  await ensureTableExists();
  await ensureConversationsTableExists();
  await ensureAgentsTableExists();
  await ensureUsersTableExists();
  await ensureMessagesHaveConversationColumn();
  await ensureMessagesHaveSenderColumns();
  await ensureMessagesHaveMediaColumns();
  await ensureInboxesTableExists();
  await ensureInboxesHaveExtraColumns();
  await ensureInboxAgentsTableExists();
  await ensureConversationsHaveInboxColumn();
  await ensureConversationsHaveResolveColumns();
  await ensureConversationsHaveLockColumn();
  await ensureContactsTableExists();
  await ensureContactsHaveCustomerCardColumns();
  await ensureContactPhonesTableExists();
  await ensureContactPhonesHaveLabelColumn();
  await ensureConversationsHaveContactColumn();
  await ensureDevicesTableExists();
  await ensureScheduledTasksTableExists();
  await ensureVisitsTableExists();
  await ensureMaintenanceContractsTableExists();
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
  ensureMessagesHaveMediaColumns,
  ensureInboxesTableExists,
  ensureInboxesHaveExtraColumns,
  ensureInboxAgentsTableExists,
  ensureConversationsHaveInboxColumn,
  ensureConversationsHaveResolveColumns,
  ensureConversationsHaveLockColumn,
  ensureContactsTableExists,
  ensureContactsHaveCustomerCardColumns,
  ensureContactPhonesTableExists,
  ensureContactPhonesHaveLabelColumn,
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
  ensureSchema,
  TABLE_NAME,
};
