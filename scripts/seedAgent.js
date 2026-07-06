// سكريبت لإضافة موظف جديد يقدر يسجل دخول على لوحة التحكم
// طريقة الاستخدام:
//   node scripts/seedAgent.js "اسم الموظف" "email@example.com" "password123"
require('dotenv').config();
const { ensureSchema } = require('../src/config/db');
const { createAgent, findAgentByEmail } = require('../legacy/agentsRepo');

async function main() {
  const [name, email, password] = process.argv.slice(2);

  if (!name || !email || !password) {
    console.error('الاستخدام: node scripts/seedAgent.js "الاسم" "email@example.com" "password"');
    process.exit(1);
  }

  await ensureSchema();

  const existing = await findAgentByEmail(email);
  if (existing) {
    console.log(`⚠️  فيه موظف بالفعل بنفس الإيميل: ${email}`);
    process.exit(0);
  }

  const agent = await createAgent({ name, email, password });
  console.log('✅ تم إنشاء الموظف بنجاح:', agent);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ فشل إنشاء الموظف:', err.message);
  process.exit(1);
});
