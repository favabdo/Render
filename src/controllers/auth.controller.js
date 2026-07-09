// controllers/auth.controller.js
// تسجيل الدخول، إنشاء أول موظف، البروفايل الشخصي، وإدارة المستخدمين (admin)

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');
const userRepo = require('../repositories/user.repo');
const companyRepo = require('../repositories/company.repo');
const mailer = require('../services/mailer.service');
const { invalidateUserStatusCache } = require('../middlewares/auth');

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // الدعوة صالحة لمدة 7 أيام

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'لازم تبعت email و password' });
  }

  const user = await userRepo.findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'بيانات الدخول غلط' });
  }

  if (user.status === 'invited') {
    return res.status(403).json({ error: 'الحساب لسه مش مفعّل، افتح لينك الدعوة اللي جالك بالإيميل عشان تحدد كلمة السر أولاً' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'الحساب موقوف، تواصل مع الإدارة' });
  }

  const valid = await userRepo.verifyPassword(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'بيانات الدخول غلط' });
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      display_name: userRepo.resolveDisplayName(user),
    },
  });
}

// إنشاء أول موظف/أدمن (مرة واحدة بس، بمفتاح سري من إعدادات السيرفر)
async function createFirstUser(req, res) {
  const providedSecret = req.headers['x-setup-secret'];
  const expectedSecret = env.SETUP_SECRET;

  if (!expectedSecret) {
    return res.status(500).json({ error: 'SETUP_SECRET مش متظبط في إعدادات السيرفر' });
  }
  if (!providedSecret || providedSecret !== expectedSecret) {
    return res.status(403).json({ error: 'المفتاح السري غلط' });
  }

  const existingCount = await userRepo.countUsers();
  if (existingCount > 0) {
    return res.status(409).json({ error: 'فيه يوزرز بالفعل، استخدم لوحة التحكم لإضافة يوزرز جدد' });
  }

  const { email, password, role = 'admin' } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'لازم تبعت email و password' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور لازم تكون 6 حروف على الأقل' });
  }

  const existing = await userRepo.findUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'فيه يوزر بنفس الإيميل ده بالفعل' });
  }

  // بنربطه تلقائيًا بأول شركة موجودة في النظام (Nile Techno Support) — كل الإيجنتس
  // اللي هيتضافوا بعد كده هيتربطوا بنفس الشركة دي (لحد ما يتعمل فعليًا اختيار
  // شركة مختلفة وقت التسجيل)
  const company = await companyRepo.getFirstCompany();
  const user = await userRepo.createUser({
    email,
    password,
    role,
    status: 'active',
    company_id: company ? company.id : null,
    company_code: company ? company.code : null,
  });
  res.status(201).json({ ok: true, user });
}

async function getMe(req, res) {
  const user = await userRepo.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'اليوزر مش موجود' });
  res.json({ ...user, display_name: userRepo.resolveDisplayName(user) });
}

// الإيجنت بيغيّر الاسم اللي بيتعرض بيه هو بس (بدل ما يفضل الإيميل ظاهر)
async function updateMe(req, res) {
  const { display_name } = req.body || {};
  const trimmed = (display_name || '').trim();

  if (!trimmed) {
    return res.status(400).json({ error: 'لازم تكتب اسم' });
  }
  if (trimmed.length < 2 || trimmed.length > 100) {
    return res.status(400).json({ error: 'الاسم لازم يكون بين 2 و 100 حرف' });
  }

  const user = await userRepo.updateDisplayName(req.user.userId, trimmed);
  if (!user) return res.status(404).json({ error: 'اليوزر مش موجود' });
  res.json({ ok: true, user: { ...user, display_name: userRepo.resolveDisplayName(user) } });
}

// قايمة الإيجنتس الحقيقيين المسجلين — متاحة لأي إيجنت مسجل دخول (مش admin بس)
async function listAgents(req, res) {
  const users = await userRepo.listUsers();
  res.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      display_name: userRepo.resolveDisplayName(u),
    }))
  );
}

// ===== إدارة المستخدمين (admin فقط) =====

async function listUsers(req, res) {
  const users = await userRepo.listUsers();
  res.json(users);
}

// الأدمن بيضيف إيميل الإيجنت والرول بس — من غير كلمة سر.
// بنبعت للإيجنت إيميل فيه لينك دعوة (Resend) يدخل بيه يحدد كلمة السر بنفسه ويفعّل حسابه.
async function createUserAccount(req, res) {
  const { email, role = 2 } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'لازم تبعت email' });
  }

  const existing = await userRepo.findUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'فيه يوزر بنفس الإيميل ده بالفعل' });
  }

  // بنربط الإيجنت الجديد بنفس شركة الأدمن اللي بيدعوه (كل الإيجنتس على نفس
  // الشركة بيشوفوا نفس اسم الحساب في صفحة الإعدادات)
  const actingAdmin = await userRepo.findUserById(req.user.userId);
  const company = await companyRepo.getCompanyForUser(actingAdmin);

  // باسورد وهمي مؤقت، مفيش حد يعرفه — الإيجنت هيحدد كلمة سره الحقيقية من لينك الدعوة
  const placeholderPassword = crypto.randomBytes(24).toString('hex');
  const user = await userRepo.createUser({
    email,
    password: placeholderPassword,
    role,
    status: 'invited',
    company_id: company ? company.id : null,
    company_code: company ? company.code : null,
  });

  const inviteToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);
  await userRepo.setInviteToken(user.id, inviteToken, expiresAt);

  // بنستخدم APP_URL الثابت من الإعدادات (دومينك بتاعك) بدل ما نبني الرابط من الـ request
  // لأن على Vercel، req.get('host') بيرجع دومين الـ vercel.app الداخلي مش دومينك،
  // وده كان بيخلي لينك الإيميل واللوجو على دومين مختلف عن دومين الإرسال في Resend
  // (السبب الأساسي في إن الإيميل كان بيروح السبام والصورة متظهرش)
  const baseUrl = env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const inviteUrl = `${baseUrl}/set-password.html?token=${inviteToken}`;
  const logoUrl = `${baseUrl}/assets/logo.png`;

  const mailResult = await mailer.sendInviteEmail({ to: email, inviteUrl, logoUrl });

  res.status(201).json({
    ok: true,
    user: { ...user, status: 'invited' },
    email_sent: mailResult.sent,
    // بنرجّع اللينك دايمًا (مش بس لو الإيميل فشل) عشان الأدمن يقدر ياخده
    // ويبعته يدويًا للإيجنت لو الإيميل راح للسبام أو اتأخر
    invite_link: inviteUrl,
  });
}

// بيتأكد إن لينك الدعوة صحيح ولسه صالح قبل ما يعرض فورم تحديد كلمة السر
async function getInviteInfo(req, res) {
  const { token } = req.params;
  const user = await userRepo.findUserByInviteToken(token);

  if (!user) {
    return res.status(404).json({ error: 'رابط الدعوة غير صحيح' });
  }
  if (!user.invite_token_expires || new Date(user.invite_token_expires) < new Date()) {
    return res.status(410).json({ error: 'رابط الدعوة انتهت صلاحيته، اطلب من الأدمن يبعت لك دعوة جديدة' });
  }

  res.json({ email: user.email });
}

// الإيجنت بيحدد كلمة سره لأول مرة عن طريق لينك الدعوة، وبعدها الحساب يبقى Active
async function acceptInvite(req, res) {
  const { token } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور لازم تكون 6 حروف على الأقل' });
  }

  const user = await userRepo.findUserByInviteToken(token);
  if (!user) {
    return res.status(404).json({ error: 'رابط الدعوة غير صحيح' });
  }
  if (!user.invite_token_expires || new Date(user.invite_token_expires) < new Date()) {
    return res.status(410).json({ error: 'رابط الدعوة انتهت صلاحيته، اطلب من الأدمن يبعت لك دعوة جديدة' });
  }

  await userRepo.completeInvite(user.id, password);
  res.json({ ok: true });
}

async function updateUserAccount(req, res) {
  const { role, status, password, display_name } = req.body;
  const user = await userRepo.updateUser(req.params.id, { role, status, password, display_name });
  if (!user) return res.status(404).json({ error: 'اليوزر مش موجود' });

  // لو الإيجنت ده اتعمله deactivate (أو أي حالة غير active)، نمسح الكاش بتاعه عشان
  // أي API request جاي منه يترفض فورًا (requireAuth)، وكمان نبعتله realtime event
  // يقفل الداشبورد عنده على طول لو فاتحه دلوقتي من غير ما يعمل أي حاجة (شوف socket.js)
  if (status !== undefined && status !== 'active') {
    invalidateUserStatusCache(user.id);
    const io = req.app.get('io');
    if (io) io.emit('agent_status_changed', { userId: user.id, status: user.status, reason: 'deactivated' });
  }

  res.json({ ok: true, user });
}

// مسح إيجنت نهائيًا — لازم الأدمن اللي بيمسح يأكد بكلمة سره الشخصية (مش كلمة سر الإيجنت المحذوف)
async function deleteUserAccount(req, res) {
  const { password } = req.body;
  const targetId = req.params.id;

  if (!password) {
    return res.status(400).json({ error: 'لازم تأكد بكلمة سرك الشخصية عشان تمسح الإيجنت ده' });
  }

  if (String(targetId) === String(req.user.userId)) {
    return res.status(400).json({ error: 'مش تقدر تمسح حسابك بنفسك من هنا' });
  }

  // بنجيب بيانات الأدمن اللي طالب المسح (مش الإيجنت المستهدف) عشان نتحقق من كلمة سره
  const actingUser = await userRepo.findUserByEmail(req.user.email);
  if (!actingUser) {
    return res.status(401).json({ error: 'الجلسة غير صالحة، سجل دخول تاني' });
  }

  const validPassword = await userRepo.verifyPassword(password, actingUser.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'كلمة السر غلط' });
  }

  const deleted = await userRepo.deleteUser(targetId);
  if (!deleted) {
    return res.status(404).json({ error: 'الإيجنت مش موجود أو تم مسحه بالفعل' });
  }

  // زي الـ deactivate بالظبط: نمسح الكاش ونبعت realtime event عشان لو الإيجنت
  // المحذوف فاتح الداشبورد دلوقتي يتقفل عنده فورًا من غير ما يعمل أي حاجة
  invalidateUserStatusCache(deleted.id);
  const io = req.app.get('io');
  if (io) io.emit('agent_status_changed', { userId: deleted.id, status: 'deleted', reason: 'deleted' });

  res.json({ ok: true });
}

module.exports = {
  login,
  createFirstUser,
  getMe,
  updateMe,
  listAgents,
  listUsers,
  createUserAccount,
  updateUserAccount,
  deleteUserAccount,
  getInviteInfo,
  acceptInvite,
};
