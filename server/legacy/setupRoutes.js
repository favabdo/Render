const express = require('express');
const router = express.Router();
const { countUsers, createUser, findUserByEmail } = require('./usersRepo');

router.post('/api/setup/first-user', async (req, res) => {
  try {
    const providedSecret = req.headers['x-setup-secret'];
    const expectedSecret = process.env.SETUP_SECRET;

    if (!expectedSecret) {
      return res.status(500).json({ error: 'SETUP_SECRET مش متظبط في إعدادات السيرفر' });
    }
    if (!providedSecret || providedSecret !== expectedSecret) {
      return res.status(403).json({ error: 'المفتاح السري غلط' });
    }

    const existingCount = await countUsers();
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

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'فيه يوزر بنفس الإيميل ده بالفعل' });
    }

    const user = await createUser({ email, password, role, status: 'active' });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
